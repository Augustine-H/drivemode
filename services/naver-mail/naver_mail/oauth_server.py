"""Optional dual OAuth/web and scoped Bearer/Voice server, same read-only tools."""
import argparse
import hmac
import json
import logging
import os
import stat
from contextlib import AsyncExitStack,asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit
from mcp.server.auth.settings import AuthSettings,ClientRegistrationOptions,RevocationOptions
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount
from .auth import Security
from .mail import ReadOnlyMail,text
from .server import create_mcp
from .oauth_consent import add_consent_routes
from .oauth_http import Boundary
from .oauth_provider import Provider,SCOPE,origin
from .oauth_store import digest


def create_oauth_app(mail, config, provider, health_hash, *, validation=True):
    voice = create_mcp(mail,config).streamable_http_app()
    voice_security = Security(voice,config)
    web_mcp = create_mcp(mail,config,auth_server_provider=provider,
        auth=AuthSettings(issuer_url=provider.issuer,resource_server_url=provider.resource,
            validate_token_resource=True,required_scopes=[SCOPE],
            client_registration_options=ClientRegistrationOptions(enabled=True,
                valid_scopes=[SCOPE],default_scopes=[SCOPE]),revocation_options=RevocationOptions(enabled=True)))
    add_consent_routes(web_mcp,provider,validation)

    @web_mcp.custom_route('/diagnostic',methods=['GET'])
    async def diagnostic(_request):
        return JSONResponse({**provider.diagnostic(),'mode':'validation' if validation else 'real-mail',
                             'real_mail_account_connected':not validation})

    web = web_mcp.streamable_http_app()
    async def dispatch(scope,receive,send):
        # Only enabled *voice* registry tokens select the existing scoped path.
        # Static web tokens and OAuth tokens can never become Voice identities.
        auth = dict(scope.get('headers',[])).get(b'authorization',b'').decode()
        is_voice = False
        if scope['path']=='/mcp' and auth.startswith('Bearer '):
            try:
                match = next((r for r in voice_security.tokens() if r.get('enabled',True)
                    and hmac.compare_digest(r['sha256'],digest(auth[7:]))),None)
                is_voice = bool(match and match['client']=='voice')
            except Exception:
                return await JSONResponse({'error':'auth_configuration_unavailable'},status_code=503)(scope,receive,send)
        if is_voice:
            return await voice_security(scope,receive,send)
        scope.setdefault('state',{})['mail_client']='grok_web'
        return await web(scope,receive,send)

    @asynccontextmanager
    async def lifespan(_app):
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(voice.router.lifespan_context(voice))
            await stack.enter_async_context(web.router.lifespan_context(web))
            yield
    root = Starlette(routes=[Mount('/',app=dispatch)],lifespan=lifespan)
    return Boundary(root,provider.issuer,health_hash)


def load_runtime(private,state):
    private = Path(private)
    info=private.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_gid!=10001
            or stat.S_IMODE(info.st_mode)!=0o750):
        raise ValueError('private_directory_permissions')
    for name in ['config.json','owner.json','state-key','health-token']:
        info=(private/name).lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=10001
                or stat.S_IMODE(info.st_mode)!=0o440 or info.st_size>16384):
            raise ValueError('private_file_permissions')
    config = json.loads((private/'config.json').read_text())
    if set(config)!= {'mode','issuer','trusted_proxy'} or config['mode'] not in {'validation','real-mail'}:
        raise ValueError('explicit_mode_required')
    import ipaddress
    proxy = ipaddress.ip_address(config['trusted_proxy'])
    if not proxy.is_private or proxy.is_unspecified or config['issuer']!=origin(config['issuer']):
        raise ValueError('invalid_proxy_or_issuer')
    validation = config['mode']=='validation'
    if validation:
        from .validation_mail import SyntheticMail
        if Path('/run/mail-private/imap.json').exists():
            raise ValueError('real_credentials_forbidden_in_validation')
        mail = SyntheticMail()
        registry = private/'validation-tokens.json'
    else:
        gate = json.loads((private/'read-only-approval.json').read_text())
        if gate!={'read_only_audit_passed':True,'xai_data_policy_acknowledged':True}:
            raise ValueError('read_only_approval_required')
        credentials = json.loads(Path('/run/mail-private/imap.json').read_text())
        mail = ReadOnlyMail(text(credentials['username'],254),text(credentials['password'],256))
        registry = Path('/run/mail-private/tokens.json')
    owner = json.loads((private/'owner.json').read_text())
    key = bytes.fromhex((private/'state-key').read_text().strip())
    tag='validation' if validation else 'real-mail:'+digest(credentials['username'])
    provider = Provider(config['issuer'],owner,state,key,deployment_tag=tag)
    security = {'token_file':str(registry),'allowed_hosts':[urlsplit(config['issuer']).netloc],
                'allowed_origins':[config['issuer'],'https://grok.com'],
                'trusted_proxies':[str(proxy)],'requests_per_minute':60,'web_auth_verified':False}
    app = create_oauth_app(mail,security,provider,digest((private/'health-token').read_text().strip()),validation=validation)
    return app,str(proxy)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private',default='/oauth-private')
    parser.add_argument('--state',default='/oauth-state')
    args=parser.parse_args()
    os.umask(0o077)
    logging.disable(logging.CRITICAL)
    try:
        app,proxy=load_runtime(args.private,args.state)
    except Exception:
        raise SystemExit('OAuth private configuration/state invalid; values suppressed') from None
    import uvicorn
    uvicorn.run(app,host='0.0.0.0',port=3001,proxy_headers=True,forwarded_allow_ips=proxy,
                access_log=False,log_level='critical')


if __name__=='__main__':
    main()
