"""Loopback HTTPS MCP canary. No IMAP credentials, sockets or real messages."""
import argparse
import datetime as dt
import ipaddress
import json
import logging
from pathlib import Path

import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from naver_mail.mail import MailError, page_values, positive
from naver_mail.manage_tokens import add_token, write_private
from naver_mail.server import create_app


class SyntheticMail:
    """Deterministic dataset, with no connection to any mail provider."""
    BODY = '합성 테스트 메일입니다. 회의는 2026년 10월 9일입니다.'
    ITEM = {'folder': 'INBOX', 'uid': 1, 'uidvalidity': 77,
            'from': '테스트 <canary@example.test>', 'subject': '[CANARY] 한국어 안내',
            'date': '2026-10-08T09:00:00+09:00', 'flags': [], 'size': 160}

    def page(self, items, limit, offset):
        page_values(limit, offset)
        return {'canary': True, 'items': items[offset:offset+limit],
                'next_offset': offset+limit if offset+limit < len(items) else None}

    def folders(self, limit=10, offset=0):
        return self.page([{'folder': 'INBOX', 'selectable': True}], limit, offset)

    def search(self, folder='INBOX', limit=10, offset=0, sender='', subject='',
               since='', before='', body='', unread=False):
        self.folder(folder)
        date = dt.date(2026, 10, 8)
        try:
            matches = ((not since or date >= dt.date.fromisoformat(since))
                       and (not before or date < dt.date.fromisoformat(before))
                       and sender.casefold() in self.ITEM['from'].casefold()
                       and subject.casefold() in self.ITEM['subject'].casefold()
                       and body.casefold() in self.BODY.casefold())
        except ValueError:
            raise MailError('invalid_input') from None
        return self.page([dict(self.ITEM)] if matches else [], limit, offset)

    def folder(self, folder):
        if folder != 'INBOX':
            raise MailError('mailbox_unavailable')

    def identity(self, folder, uid, uidvalidity):
        self.folder(folder)
        positive(uid); positive(uidvalidity)
        if uidvalidity != 77:
            raise MailError('uidvalidity_changed')
        if uid != 1:
            raise MailError('message_not_found')

    def message(self, folder, uid, uidvalidity, body_chars=4000, body_offset=0):
        self.identity(folder, uid, uidvalidity)
        if not 1 <= body_chars <= 8000 or not 0 <= body_offset <= 16000:
            raise MailError('invalid_input')
        end = body_offset + body_chars
        return {**self.ITEM, 'canary': True, 'body': self.BODY[body_offset:end],
                'untrusted_content': True, 'truncated': end < len(self.BODY),
                'next_body_offset': end if end < len(self.BODY) else None}

    def attachments(self, folder, uid, uidvalidity, limit=10, offset=0):
        self.identity(folder, uid, uidvalidity)
        return self.page([{'name': '합성.pdf', 'size': 128, 'mime_type': 'application/pdf'}], limit, offset)

    def thread(self, folder, uid, uidvalidity, limit=10, offset=0):
        self.identity(folder, uid, uidvalidity)
        return {**self.page([dict(self.ITEM)], limit, offset), 'supported': True}


def prepare(directory, port=3443):
    directory = Path(directory).resolve()
    if not 1024 <= port <= 65535:
        raise ValueError('invalid_port')
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Account-free MCP canary')])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now-dt.timedelta(minutes=1)).not_valid_after(now+dt.timedelta(days=2))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),
                x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))
    write_private(directory/'ca.pem', cert.public_bytes(serialization.Encoding.PEM).decode())
    write_private(directory/'key.pem', key.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode())
    add_token(directory/'tokens.json', directory/'voice.token', 'voice', 'voice-v1')
    add_token(directory/'tokens.json', directory/'web.token', 'grok_web', 'web-v1')
    config = {'token_file': str(directory/'tokens.json'),
              'allowed_hosts': [f'127.0.0.1:{port}', f'localhost:{port}'],
              'allowed_origins': ['https://grok.com'], 'trusted_proxies': [],
              'web_auth_verified': False, 'requests_per_minute': 120}
    write_private(directory/'config.json', json.dumps(config, indent=2))
    return directory


def serve(directory, port):
    directory = Path(directory).resolve()
    config = json.loads((directory/'config.json').read_text())
    if f'127.0.0.1:{port}' not in config['allowed_hosts']:
        raise ValueError('port_mismatch')
    logging.disable(logging.CRITICAL)
    uvicorn.run(create_app(SyntheticMail(), config), host='127.0.0.1', port=port,
                ssl_certfile=str(directory/'ca.pem'), ssl_keyfile=str(directory/'key.pem'),
                proxy_headers=False, access_log=False, log_level='critical')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['prepare', 'serve'])
    parser.add_argument('--directory', required=True)
    parser.add_argument('--port', type=int, default=3443)
    args = parser.parse_args()
    try:
        if args.operation == 'prepare':
            prepare(args.directory, args.port)
            print('Canary prepared; private values were not printed. Certificate expires in two days.')
        else:
            serve(args.directory, args.port)
    except Exception:
        raise SystemExit('Canary operation failed; check paths, port and private configuration.') from None


if __name__ == '__main__':
    main()
