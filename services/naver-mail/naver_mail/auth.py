"""ASGI security boundary. Token registry is reread for every request."""
import hashlib
import asyncio
import hmac
import ipaddress
import json
import time
from collections import OrderedDict
from pathlib import Path
from starlette.responses import JSONResponse


class Security:
    def __init__(self, app, config):
        self.app, self.config = app, config
        self.buckets = OrderedDict()
        self.active = 0

    def tokens(self):
        value = json.loads(Path(self.config['token_file']).read_text())
        rows = value.get('tokens', [])
        if not 1 <= len(rows) <= 32:
            raise ValueError('invalid_registry')
        for row in rows:
            if row.get('client') not in {'voice', 'grok_web'} or not isinstance(row.get('sha256'), str) or len(row['sha256']) != 64:
                raise ValueError('invalid_registry')
        return rows

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope['headers']}
        async def reject(code, status):
            response = JSONResponse({'error': code}, status_code=status, headers={'cache-control': 'no-store', **({'www-authenticate': 'Bearer realm="naver-mail"'} if status == 401 else {})})
            await response(scope, receive, send)
        host = headers.get('host', '')
        if host not in self.config['allowed_hosts']:
            return await reject('invalid_host', 403)
        origin = headers.get('origin')
        if origin and origin not in self.config['allowed_origins']:
            return await reject('invalid_origin', 403)
        peer = (scope.get('client') or ('', 0))[0]
        try:
            trusted_proxy = any(ipaddress.ip_address(peer) in ipaddress.ip_network(cidr) for cidr in self.config.get('trusted_proxies', []))
        except ValueError:
            trusted_proxy = False
        forwarded = headers.get('x-forwarded-proto')
        if scope.get('scheme') != 'https' and not (trusted_proxy and forwarded == 'https'):
            # Only health checks and explicit fixture tests may use local HTTP.
            if not (scope['path'] == '/health' and peer in {'127.0.0.1', '::1'}) and not self.config.get('test_http', False):
                return await reject('https_required', 403)
        auth = headers.get('authorization', '')
        if not auth.startswith('Bearer ') or not 32 <= len(auth[7:]) <= 256:
            return await reject('unauthorized', 401)
        digest = hashlib.sha256(auth[7:].encode()).hexdigest()
        try:
            match = next((row for row in self.tokens() if row.get('enabled', True) and hmac.compare_digest(row['sha256'], digest)), None)
        except (OSError, ValueError, KeyError, TypeError):
            return await reject('auth_configuration_unavailable', 503)
        if not match or (match['client'] == 'grok_web' and not self.config.get('web_auth_verified', False)):
            return await reject('unauthorized', 401)
        if headers.get('content-length'):
            try:
                if not 0 <= int(headers['content-length']) <= 16384:
                    return await reject('request_too_large', 413)
            except ValueError:
                return await reject('invalid_length', 400)
        now = time.monotonic()
        # Bounded token-based buckets, so spoofed IPs cannot bypass limits.
        current = self.buckets.get(digest, (now, 0))
        start, count = current if now - current[0] < 60 else (now, 0)
        if count >= self.config.get('requests_per_minute', 60) or self.active >= 4:
            return await reject('rate_limited', 429)
        self.buckets[digest] = (start, count + 1)
        if len(self.buckets) > 64:
            self.buckets.popitem(last=False)
        # Buffer only a bounded request, including chunked bodies. Credentials
        # are never written to logs, mail data never to persistent storage.
        body = bytearray()
        while True:
            try:
                event = await asyncio.wait_for(receive(), timeout=5)
            except asyncio.TimeoutError:
                return await reject('request_timeout', 408)
            if event['type'] == 'http.disconnect':
                return
            body.extend(event.get('body', b''))
            if len(body) > 16384:
                return await reject('request_too_large', 413)
            if not event.get('more_body', False):
                break
        scope.setdefault('state', {})['mail_client'] = match['client']
        sent = False
        async def buffered_receive():
            nonlocal sent
            if not sent:
                sent = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        async def safe_send(event):
            if event['type'] == 'http.response.start':
                event['headers'] = list(event.get('headers', [])) + [(b'cache-control', b'no-store'), (b'x-content-type-options', b'nosniff')]
            await send(event)
        self.active += 1
        try:
            await self.app(scope, buffered_receive, safe_send)
        finally:
            self.active -= 1
