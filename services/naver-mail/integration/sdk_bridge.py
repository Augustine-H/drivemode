"""Internal synthetic-only SDK bridge for the Voice Grok flow harness."""
import asyncio
import json
import logging
import sys
from urllib.parse import urlsplit

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from naver_mail.server import TOOLS
from .probe import context, endpoint


async def call(packet):
    url = endpoint(packet['url'])
    if urlsplit(url).hostname != '127.0.0.1' or packet['tool'] not in TOOLS:
        raise ValueError('synthetic_loopback_only')
    headers = packet['headers']
    if set(headers) != {'Authorization', 'X-Naver-Mail-Scope'}:
        raise ValueError('unexpected_headers')
    async with httpx.AsyncClient(verify=context(packet['ca_file']), trust_env=False,
                                 timeout=10, headers=headers, follow_redirects=False) as http:
        async with streamable_http_client(url, http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(packet['tool'], packet['arguments'])
                return result.model_dump(mode='json')


def main():
    logging.disable(logging.CRITICAL)
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise ValueError('request_too_large')
        result = asyncio.run(call(json.loads(raw)))
    except Exception:
        raise SystemExit('Synthetic SDK bridge failed; private diagnostics suppressed.') from None
    # This pipe is consumed inside the harness, never printed in its report.
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
