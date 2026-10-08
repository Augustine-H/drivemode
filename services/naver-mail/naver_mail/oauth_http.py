"""Bounded HTTPS boundary and SDK 1.30 form compatibility for OAuth routes."""
import base64
import hmac
import time
from urllib.parse import parse_qs,unquote,urlencode,urlsplit
from starlette.responses import JSONResponse
from .oauth_store import digest

class Boundary:
    def __init__(self, app, issuer, health_hash):
        self.app, self.host = app, urlsplit(issuer).netloc
        self.allowed_origins = {issuer,'https://grok.com'}
        self.health_hash = health_hash
        self.window, self.count, self.active = time.monotonic(), 0, 0

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope,receive,send)
        headers = {k.decode().lower():v.decode() for k,v in scope.get('headers',[])}
        peer = (scope.get('client') or ('',0))[0]
        health = scope['path'] in {'/health','/diagnostic'} and peer in {'127.0.0.1','::1'}
        async def reject(status):
            return await JSONResponse({'error':'request_rejected'},status_code=status,
                                      headers={'Cache-Control':'no-store'})(scope,receive,send)
        if headers.get('host') not in {self.host,'127.0.0.1:3001','localhost:3001'}:
            return await reject(421)
        if not health and (scope.get('scheme')!='https' or headers.get('host')!=self.host):
            return await reject(403)
        if headers.get('origin') and headers['origin'] not in self.allowed_origins:
            return await reject(403)
        if scope['path'] in {'/health','/diagnostic'}:
            auth = headers.get('authorization','')
            if not auth.startswith('Bearer ') or not hmac.compare_digest(digest(auth[7:]),self.health_hash):
                return await reject(401)
        if time.monotonic()-self.window >= 60:
            self.window,self.count = time.monotonic(),0
        self.count += 1
        if self.count>120 or self.active>=4:
            return await reject(429)
        import asyncio
        body = bytearray()
        while True:
            try:
                event = await asyncio.wait_for(receive(),5)
            except asyncio.TimeoutError:
                return await reject(408)
            if event['type']=='http.disconnect':
                return
            body.extend(event.get('body',b''))
            if len(body)>16384:
                return await reject(413)
            if not event.get('more_body',False):
                break
        # SDK 1.30 requires form client_id even for Basic auth, and its revoke
        # model requires client_secret even for public/Basic clients. Normalize
        # these optional fields without relaxing the SDK's client authentication.
        if scope['path'] in {'/token','/revoke'} and headers.get('content-type','').startswith('application/x-www-form-urlencoded'):
            try:
                fields = parse_qs(body.decode(),keep_blank_values=True,max_num_fields=32)
            except (ValueError,UnicodeError):
                return await reject(400)
            changed = False
            auth = headers.get('authorization','')
            if 'client_id' not in fields and auth.startswith('Basic '):
                try:
                    if len(auth)>4096: raise ValueError()
                    credentials = base64.b64decode(auth[6:],validate=True).decode()
                    basic_id,_ = credentials.split(':',1)
                    body.extend(('&'+urlencode({'client_id':unquote(basic_id)})).encode())
                    changed=True
                except (ValueError,UnicodeError):
                    return await reject(401)
            if scope['path']=='/revoke' and 'client_secret' not in fields:
                body.extend(b'&client_secret=')
                changed=True
            if changed:
                if len(body)>16384:
                    return await reject(413)
                scope['headers']=[(k,v) for k,v in scope.get('headers',[]) if k.lower()!=b'content-length']+[(b'content-length',str(len(body)).encode())]
        sent = False
        async def replay():
            nonlocal sent
            if not sent:
                sent=True
                return {'type':'http.request','body':bytes(body),'more_body':False}
            return await receive()
        started = False
        error_response = False
        async def safe_send(event):
            nonlocal started,error_response
            if event['type']=='http.response.start':
                started = True
                error_response = event['status']>=400 and scope['path'] in {'/token','/register','/authorize','/revoke'}
                if error_response:
                    event['headers']=[(k,v) for k,v in event.get('headers',[]) if k.lower()!=b'content-length']
                event['headers']=list(event.get('headers',[]))+[
                    (b'cache-control',b'no-store'),(b'x-content-type-options',b'nosniff'),
                    (b'referrer-policy',b'same-origin'),
                    (b'content-security-policy',b"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")]
            if event['type']=='http.response.body' and error_response:
                # SDK validation descriptions can echo submitted secret fields.
                import json
                try:
                    code=json.loads(event.get('body',b'{}')).get('error','invalid_request')
                except Exception:
                    code='invalid_request'
                allowed={'invalid_request','invalid_grant','invalid_scope','invalid_client',
                         'unauthorized_client','unsupported_grant_type','invalid_redirect_uri',
                         'invalid_client_metadata','server_error'}
                event={**event,'body':json.dumps({'error':code if code in allowed else 'invalid_request'}).encode()}
            await send(event)
        self.active+=1
        try:
            await self.app(scope,replay,safe_send)
        except Exception:
            if started:
                raise
            await reject(503)
        finally:
            self.active-=1
