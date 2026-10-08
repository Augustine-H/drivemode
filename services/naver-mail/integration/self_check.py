"""One-command account-free HTTPS/restart/token-rotation integration check."""
import asyncio
import contextlib
import json
import logging
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from naver_mail.manage_tokens import add_token, revoke_token
from .https_canary import prepare
from .probe import context, probe, scope


@contextlib.contextmanager
def running(directory, port):
    process = subprocess.Popen([sys.executable, '-m', 'integration.https_canary', 'serve',
        '--directory', str(directory), '--port', str(port)],
        cwd=Path(__file__).resolve().parents[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 10
        with httpx.Client(verify=context(directory/'ca.pem'), trust_env=False, timeout=0.5) as http:
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('canary_start_failed')
                try:
                    if http.get(f'https://127.0.0.1:{port}/health').status_code == 401:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(0.05)
            else:
                raise RuntimeError('canary_start_timeout')
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)


async def transport_checks(url, directory):
    token = (directory/'voice.token').read_text().strip()
    headers = {'Authorization': f'Bearer {token}'}
    async with httpx.AsyncClient(verify=context(directory/'ca.pem'), trust_env=False, timeout=5) as http:
        for extra in [{'Origin': 'https://evil.example'}, {'Host': 'evil.example'}]:
            if (await http.get(url.replace('/mcp', '/health'), headers={**headers, **extra})).status_code != 403:
                raise RuntimeError('origin_or_host_guard_failed')
        web = (directory/'web.token').read_text().strip()
        if (await http.get(url.replace('/mcp', '/health'), headers={'Authorization': f'Bearer {web}'})).status_code != 401:
            raise RuntimeError('unverified_web_token_not_blocked')
    # A caller without the generated trust anchor must reject the certificate.
    async with httpx.AsyncClient(trust_env=False, timeout=5) as http:
        try:
            await http.get(url.replace('/mcp', '/health'))
        except httpx.ConnectError:
            pass
        else:
            raise RuntimeError('untrusted_certificate_accepted')
    async with httpx.AsyncClient(verify=context(directory/'ca.pem'), trust_env=False,
                                 headers=headers, timeout=5) as http:
        async with streamable_http_client(url, http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool('mail_list_recent', {'folder': 'INBOX', 'limit': 1, 'offset': 0})
                if (result.structuredContent or {}).get('error') != 'scope_denied':
                    raise RuntimeError('missing_scope_not_rejected')
    args = {'folder': 'INBOX', 'uid': 1, 'uidvalidity': 77, 'body_chars': 80, 'body_offset': 0}
    async with httpx.AsyncClient(verify=context(directory/'ca.pem'), trust_env=False,
            headers={**headers, 'X-Naver-Mail-Scope': scope('mail_get_message', args)}, timeout=5) as http:
        async with streamable_http_client(url, http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool('mail_get_message', args)
                data = result.structuredContent or {}
                if data.get('canary') is not True or '합성 테스트' not in data.get('body', '') or not data.get('untrusted_content'):
                    raise RuntimeError('synthetic_detail_failed')
                changed = {**args, 'uid': 2}
                result = await session.call_tool('mail_get_message', changed)
                if (result.structuredContent or {}).get('error') != 'scope_denied':
                    raise RuntimeError('expanded_scope_not_rejected')


def run():
    with tempfile.TemporaryDirectory(prefix='naver-https-check-') as temporary:
        with socket.socket() as selection:
            selection.bind(('127.0.0.1', 0)); port = selection.getsockname()[1]
        directory = prepare(Path(temporary)/'private', port)
        url = f'https://127.0.0.1:{port}/mcp'
        with running(directory, port):
            initial = asyncio.run(probe(url, directory/'voice.token', directory/'ca.pem', canary=True))
            asyncio.run(transport_checks(url, directory))
            add_token(directory/'tokens.json', directory/'voice-v2.token', 'voice', 'voice-v2')
            asyncio.run(probe(url, directory/'voice-v2.token', directory/'ca.pem', canary=True))
            # The old token still works until explicitly revoked.
            asyncio.run(probe(url, directory/'voice.token', directory/'ca.pem'))
            revoke_token(directory/'tokens.json', 'voice-v1')
            old = (directory/'voice.token').read_text().strip()
            with httpx.Client(verify=context(directory/'ca.pem'), trust_env=False) as http:
                if http.get(url.replace('/mcp', '/health'), headers={'Authorization': f'Bearer {old}'}).status_code != 401:
                    raise RuntimeError('revocation_failed')
            asyncio.run(probe(url, directory/'voice-v2.token', directory/'ca.pem', canary=True))
        with running(directory, port):
            asyncio.run(probe(url, directory/'voice-v2.token', directory/'ca.pem', canary=True))
            with httpx.Client(verify=context(directory/'ca.pem'), trust_env=False) as http:
                if http.get(url.replace('/mcp', '/health'), headers={'Authorization': f'Bearer {old}'}).status_code != 401:
                    raise RuntimeError('revocation_lost_after_restart')
        return {**initial, 'checks': {**initial['checks'], 'tls_trust_required': True,
            'host_origin_guard': True, 'unverified_web_token_blocked': True,
            'scope_enforced': True, 'synthetic_detail': True, 'rotation_overlap': True,
            'revocation_immediate': True, 'restart_recovery': True}, 'private_files_removed': True}


def main():
    logging.disable(logging.CRITICAL)
    try:
        result = run()
    except Exception:
        raise SystemExit('HTTPS self-check failed; private details suppressed.') from None
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
