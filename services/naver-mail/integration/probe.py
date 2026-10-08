"""Verified HTTPS MCP probe; never prints tokens or message contents."""
import argparse
import asyncio
import base64
import json
import logging
import ssl
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from naver_mail.server import TOOLS


def endpoint(value):
    url = urlsplit(value)
    if (url.scheme != 'https' or not url.hostname or url.username is not None or url.password is not None
            or url.query or url.fragment or url.path != '/mcp'
            or any(c.isspace() or ord(c) < 32 for c in value)):
        raise ValueError('https_mcp_url_required')
    if url.port is not None and not 1 <= url.port <= 65535:
        raise ValueError('invalid_port')
    return value


def scope(tool, arguments):
    return base64.urlsafe_b64encode(json.dumps({'tool': tool, 'arguments': arguments}).encode()).decode().rstrip('=')


def context(ca_file=None):
    return ssl.create_default_context(cafile=str(ca_file) if ca_file else None)


async def probe(url, token_file, ca_file=None, canary=False):
    endpoint(url)
    url_parts = urlsplit(url)
    if canary and url_parts.hostname not in {'127.0.0.1', 'localhost'}:
        raise ValueError('canary_calls_require_loopback')
    token = Path(token_file).read_text().strip()
    if not 32 <= len(token) <= 256 or any(c.isspace() for c in token):
        raise ValueError('invalid_token_file')
    base = f'{url_parts.scheme}://{url_parts.netloc}'
    checks = {}
    args = {'folder': 'INBOX', 'limit': 1, 'offset': 0}
    headers = {'Authorization': f'Bearer {token}'}
    if canary:
        headers['X-Naver-Mail-Scope'] = scope('mail_list_recent', args)
    async with httpx.AsyncClient(verify=context(ca_file), trust_env=False,
                                 timeout=15, follow_redirects=False) as http:
        for name, supplied in [('anonymous_rejected', {}),
                               ('invalid_token_rejected', {'Authorization': 'Bearer ' + 'invalid-'*8})]:
            if canary:
                response = await http.get(base+'/health', headers=supplied)
                if response.status_code != 401:
                    raise ValueError(name)
            response = await http.post(url, headers={**supplied,
                'Accept': 'application/json, text/event-stream'},
                json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {}})
            if response.status_code != 401:
                raise ValueError(name)
            checks[name] = True
        if canary:
            response = await http.get(base+'/health', headers=headers)
            if response.status_code != 200 or response.json().get('imap_checked') is not False:
                raise ValueError('authenticated_health_failed')
            checks['authenticated_health'] = True
    async with httpx.AsyncClient(verify=context(ca_file), trust_env=False, timeout=15,
                                 headers=headers, follow_redirects=False) as http:
        async with streamable_http_client(url, http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                initialized = await session.initialize()
                tools = await session.list_tools()
                if {t.name for t in tools.tools} != set(TOOLS) or not all(
                    t.annotations and t.annotations.readOnlyHint is True
                    and t.annotations.destructiveHint is False for t in tools.tools):
                    raise ValueError('readonly_tool_inventory_failed')
                checks['protocol'] = initialized.protocolVersion
                checks['readonly_tools'] = len(tools.tools)
                if canary:
                    result = await session.call_tool('mail_list_recent', args)
                    data = result.structuredContent or {}
                    if result.isError or data.get('canary') is not True or len(data.get('items', [])) != 1:
                        raise ValueError('synthetic_canary_failed')
                    checks['synthetic_list'] = True
    return {'status': 'passed', 'mail_reads': 'synthetic-only' if canary else 'none',
            'checks': checks, 'grok_web_verified': False, 'xai_verified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--token-file', required=True)
    parser.add_argument('--ca-file')
    parser.add_argument('--canary', action='store_true',
                        help='Call a synthetic canary only; never enable against a real mailbox.')
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    try:
        result = asyncio.run(probe(args.url, args.token_file, args.ca_file, args.canary))
    except Exception:
        raise SystemExit('MCP probe failed; check TLS, authentication, endpoint and tool compatibility. Private details suppressed.') from None
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
