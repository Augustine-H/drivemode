"""Real TLS/socket transport against synthetic services, never Naver or xAI."""
import contextlib
import datetime
import hashlib
import ipaddress
import json
import re
import socket
import socketserver
import ssl
import threading
import time
from pathlib import Path
import httpx
import pytest
import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from naver_mail.mail import BoundedIMAP, MailError, ReadOnlyMail
from naver_mail.server import create_app, TOOLS
from conftest import approved
from test_mcp import config, TOKEN


@pytest.fixture
def certificate(tmp_path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost test certificate')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1))
            .not_valid_after(now+datetime.timedelta(hours=1))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(key, hashes.SHA256()))
    cert_path, key_path = tmp_path/'cert.pem', tmp_path/'key.pem'
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return cert_path, key_path


def test_imap_tls_login_examined_mail_and_search_literals(certificate):
    cert, key = certificate
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    commands, literal_values = [], []
    class Handler(socketserver.StreamRequestHandler):
        def setup(self):
            self.request = context.wrap_socket(self.request, server_side=True)
            super().setup()
        def handle(self):
            self.wfile.write(b'* OK synthetic IMAP server\r\n'); self.wfile.flush()
            while line := self.rfile.readline():
                tag, command, arguments = line.decode().strip().split(' ', 2) if line.count(b' ') >= 2 else (*line.decode().strip().split(' ', 1), '')
                command = command.upper(); commands.append((command, arguments))
                if command == 'CAPABILITY':
                    self.wfile.write(b'* CAPABILITY IMAP4rev1\r\n')
                elif command == 'LOGIN':
                    if 'wrong' in arguments:
                        self.wfile.write(f'{tag} NO invalid credentials\r\n'.encode());self.wfile.flush();continue
                elif command == 'EXAMINE':
                    self.wfile.write(b'* 1 EXISTS\r\n* OK [UIDVALIDITY 77] valid\r\n')
                elif command == 'UID' and arguments.startswith('SEARCH'):
                    match = re.search(r'\{(\d+)\}$', arguments)
                    if match:
                        self.wfile.write(b'+ continue\r\n');self.wfile.flush()
                        literal_values.append(self.rfile.read(int(match[1])));self.rfile.readline()
                    self.wfile.write(b'* SEARCH 1\r\n')
                elif command == 'UID' and arguments.startswith('FETCH'):
                    body = 'Subject: =?UTF-8?B?7ZWc6riA?=\r\nFrom: test@example.test\r\n\r\n'.encode()
                    self.wfile.write(f'* 1 FETCH (UID 1 RFC822.SIZE 100 FLAGS (\\Flagged) BODY[HEADER.FIELDS (SUBJECT FROM)] {{{len(body)}}}\r\n'.encode()+body+b')\r\n')
                else:
                    raise AssertionError(f'Unexpected command: {command}')
                self.wfile.write(f'{tag} OK completed\r\n'.encode());self.wfile.flush()
    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True
    with Server(('127.0.0.1', 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
        trusted = ssl.create_default_context(cafile=str(cert))
        make = lambda: BoundedIMAP('127.0.0.1', server.server_address[1], ssl_context=trusted, timeout=2)
        mail = ReadOnlyMail('fixture', 'fixture-password', factory=make)
        try:
            result = mail.search(subject='한글')
            assert result['items'][0]['subject'] == '한글'
            assert literal_values == ['한글'.encode()]
            assert any(command == 'EXAMINE' for command, _ in commands)
            assert not any(command in {'SELECT', 'STORE', 'APPEND', 'EXPUNGE'} for command, _ in commands)
            bad = ReadOnlyMail('fixture', 'wrong', factory=make)
            with pytest.raises(MailError, match='imap_auth_failed'):
                bad.search()
        finally:
            mail.close();server.shutdown();thread.join(timeout=2)


@pytest.mark.asyncio
async def test_official_sdk_streamable_http_over_verified_tls(mail, config, certificate):
    cert, key = certificate
    args = {'folder': 'INBOX', 'limit': 5, 'offset': 0}
    # Pre-bind a socket to avoid a race between port selection and server start.
    listener = socket.socket();listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    config['allowed_hosts'].append(f'127.0.0.1:{port}')
    server = uvicorn.Server(uvicorn.Config(create_app(mail, config), ssl_certfile=str(cert), ssl_keyfile=str(key), log_level='critical', access_log=False))
    thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True);thread.start()
    deadline = time.monotonic() + 5
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert server.started
    context = ssl.create_default_context(cafile=str(cert))
    try:
        async with httpx.AsyncClient(verify=context, trust_env=False, headers={'Authorization': f'Bearer {TOKEN}', 'X-Naver-Mail-Scope': approved('mail_list_recent', args)}) as http:
            async with streamable_http_client(f'https://127.0.0.1:{port}/mcp', http_client=http) as (read, write, _):
                async with ClientSession(read, write) as session:
                    initialized = await session.initialize()
                    assert initialized.protocolVersion == '2025-11-25'
                    tools = await session.list_tools()
                    assert {t.name for t in tools.tools} == set(TOOLS)
                    result = await session.call_tool('mail_list_recent', args)
                    assert result.structuredContent['items'][0]['subject'] == '한국어 안내'
    finally:
        server.should_exit = True;thread.join(timeout=5)
        listener.close()
