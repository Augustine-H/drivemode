"""Persistent SDK OAuth against the real read-only tools with synthetic IMAP."""
import asyncio
import base64
import concurrent.futures
import hashlib
import json
import re
from urllib.parse import parse_qs,urlsplit
import pytest
from starlette.testclient import TestClient
from mcp.server.auth.provider import TokenError
from naver_mail.oauth_provider import Provider,SCOPE
from naver_mail.oauth_server import create_oauth_app
from naver_mail.oauth_store import digest,Store
from conftest import approved

ISSUER='https://mail.example.test'
REDIRECT='https://grok.com/oauth/callback'
PHRASE='synthetic-production-owner-phrase'
VERIFIER='synthetic-pkce-'+'a'*43
VOICE='synthetic-voice-token-'+'v'*32
STATIC_WEB='synthetic-static-web-'+'w'*32


@pytest.fixture
def deployment(tmp_path,mail):
    state=tmp_path/'state';state.mkdir(mode=0o700)
    registry=tmp_path/'tokens.json'
    registry.write_text(json.dumps({'tokens':[{'client':'voice','sha256':digest(VOICE)},
        {'client':'grok_web','sha256':digest(STATIC_WEB)}]}))
    salt=bytes(16)
    owner={'salt':salt.hex(),'hash':hashlib.scrypt(PHRASE.encode(),salt=salt,n=16384,r=8,p=1).hex()}
    key=bytes(range(32))
    config={'token_file':str(registry),'allowed_hosts':['mail.example.test'],
        'allowed_origins':[ISSUER,'https://grok.com'],'requests_per_minute':120,'web_auth_verified':False}
    def fresh(owner_override=None):
        provider=Provider(ISSUER,owner_override or owner,state,key)
        app=create_oauth_app(mail,config,provider,digest('synthetic-health-token'),validation=True)
        return TestClient(app,base_url=ISSUER,follow_redirects=False),provider
    return fresh,state,owner,key,registry


def grant(client,method='none',phrase=PHRASE,validation=True):
    reg=client.post('/register',json={'redirect_uris':[REDIRECT],
        'token_endpoint_auth_method':method,'grant_types':['authorization_code','refresh_token'],
        'response_types':['code'],'scope':SCOPE})
    assert reg.status_code==201,reg.text
    registration=reg.json()
    challenge=base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip('=')
    auth=client.get('/authorize',params={'client_id':registration['client_id'],'response_type':'code',
        'redirect_uri':REDIRECT,'code_challenge':challenge,'code_challenge_method':'S256',
        'scope':SCOPE,'resource':ISSUER+'/mcp','state':'synthetic-state'})
    assert auth.status_code==302
    page=client.get(auth.headers['location']);assert page.status_code==200
    assert 'xAI' in page.text
    assert ('합성 검증 모드' in page.text)==validation
    csrf=re.search(r'name="csrf" type="hidden" value="([^"]+)"',page.text)[1]
    if not validation:
        rejected=client.post(auth.headers['location'],data={'csrf':csrf,'phrase':phrase},headers={'Origin':ISSUER})
        assert rejected.status_code==403 and 'data_policy' in rejected.text
    consent=client.post(auth.headers['location'],data={'csrf':csrf,'phrase':phrase,
        **({} if validation else {'acknowledge_xai':'yes'})},headers={'Origin':ISSUER})
    assert consent.status_code==303,consent.text
    query=parse_qs(urlsplit(consent.headers['location']).query)
    assert query['state']==['synthetic-state']
    data={'grant_type':'authorization_code','client_id':registration['client_id'],
        'code':query['code'][0],'redirect_uri':REDIRECT,'code_verifier':VERIFIER}
    if method=='client_secret_post':data['client_secret']=registration['client_secret']
    return data,registration


def exchange(client,method='none'):
    data,reg=grant(client,method)
    headers={}
    if method=='client_secret_basic':
        data.pop('client_id')
        headers={'Authorization':'Basic '+base64.b64encode((reg['client_id']+':'+reg['client_secret']).encode()).decode()}
    response=client.post('/token',data=data,headers=headers)
    assert response.status_code==200,response.text
    return response.json(),reg


def call(client,token,name='mail_list_recent',args=None,extra=None):
    headers={'Authorization':'Bearer '+token,'Accept':'application/json, text/event-stream',
             'MCP-Protocol-Version':'2025-11-25',**(extra or {})}
    return client.post('/mcp',headers=headers,json={'jsonrpc':'2.0','id':1,'method':'tools/call',
        'params':{'name':name,'arguments':args or {}}})


@pytest.mark.parametrize('method',['none','client_secret_post','client_secret_basic'])
def test_sdk_authentication_persistence_and_encryption(deployment,fake,method):
    fresh,state,_,_,_=deployment
    client,provider=fresh()
    with client:
        tokens,reg=exchange(client,method)
        before={k:set(v) for k,v in fake.flags.items()}
        result=call(client,tokens['access_token'],'mail_get_message',{'folder':'INBOX','uid':1,'uidvalidity':77})
        assert result.status_code==200
        content=result.json()['result']['structuredContent']
        assert '한국어 본문' in content['body'] and content['untrusted_content'] is True
        assert before==fake.flags
        headers={'Authorization':'Bearer '+tokens['access_token'],'Accept':'application/json, text/event-stream'}
        listed=client.post('/mcp',headers=headers,json={'jsonrpc':'2.0','id':2,'method':'tools/list'})
        assert len(listed.json()['result']['tools'])==7
    raw=(state/'oauth.db').read_bytes()
    for secret in [PHRASE,tokens['access_token'],tokens['refresh_token'],reg.get('client_secret','secret-marker')]:
        assert secret.encode() not in raw
    client,new=fresh()
    with client:
        assert call(client,tokens['access_token']).status_code==200
        assert asyncio.run(new.get_client(reg['client_id'])) is not None
    assert provider is not new


def test_voice_scope_rotation_and_static_web_rejection(deployment):
    fresh,_,_,_,registry=deployment
    client,_=fresh()
    args={'folder':'INBOX','limit':1,'offset':0}
    scope=approved('mail_list_recent',args)
    with client:
        assert call(client,VOICE,args=args).json()['result']['structuredContent']['error']=='scope_denied'
        assert call(client,VOICE,args=args,extra={'X-Naver-Mail-Scope':scope}).json()['result']['structuredContent']['items']
        assert call(client,STATIC_WEB).status_code==401
        tokens,_=exchange(client)
        assert call(client,tokens['access_token'],extra={'X-Naver-Mail-Scope':'forged'}).json()['result']['structuredContent']['items']
        rows=json.loads(registry.read_text());rows['tokens'][0]['enabled']=False;registry.write_text(json.dumps(rows))
        assert call(client,VOICE,args=args,extra={'X-Naver-Mail-Scope':scope}).status_code==401


def test_refresh_restart_replay_and_revocation(deployment):
    fresh,*_=deployment
    client,_=fresh()
    with client:tokens,reg=exchange(client)
    client,provider=fresh()
    with client:
        data={'grant_type':'refresh_token','client_id':reg['client_id'],'refresh_token':tokens['refresh_token']}
        reply=client.post('/token',data=data);assert reply.status_code==200
        new=reply.json()
        assert call(client,tokens['access_token']).status_code==401
        assert call(client,new['access_token']).status_code==200
        assert client.post('/token',data=data).status_code==400
        assert call(client,new['access_token']).status_code==401
        tokens,reg=exchange(client)
        assert client.post('/revoke',data={'client_id':reg['client_id'],'token':tokens['access_token']}).status_code==200
        assert call(client,tokens['access_token']).status_code==401


def test_concurrent_code_exchange_only_one_grant(deployment):
    fresh,*_=deployment
    client,provider=fresh()
    with client:
        data,reg=grant(client)
        account=asyncio.run(provider.get_client(reg['client_id']))
        code=asyncio.run(provider.load_authorization_code(account,data['code']))
        def redeem():
            try:return asyncio.run(provider.exchange_authorization_code(account,code))
            except TokenError:return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:redeem(),range(2)))
        assert sum(r is not None for r in results)==1
        assert provider.diagnostic()['active_grants']==1


def test_owner_rotation_and_admin_revoke_all(deployment):
    fresh,_,owner,_,_=deployment
    client,provider=fresh()
    with client:
        tokens,_=exchange(client)
        provider.store.revoke_all()
        assert call(client,tokens['access_token']).status_code==401
        tokens,_=exchange(client)
    changed={**owner,'hash':hashlib.scrypt(b'synthetic-new-owner-phrase',salt=bytes.fromhex(owner['salt']),n=16384,r=8,p=1).hex()}
    client,_=fresh(changed)
    with client:assert call(client,tokens['access_token']).status_code==401


def test_crypto_wrong_key_and_tampered_database_fail_closed(deployment):
    fresh,state,owner,key,_=deployment
    client,provider=fresh()
    with client:tokens,_=exchange(client)
    with pytest.raises(Exception):Provider(ISSUER,owner,state,bytes(reversed(key)))
    with provider.store.transaction() as db:
        db.execute("UPDATE state SET payload=? WHERE kind='access'",(b'corrupt-encrypted-row',))
    with pytest.raises(Exception):asyncio.run(provider.load_access_token(tokens['access_token']))


def test_boundaries_and_default_closed_access(deployment):
    fresh,*_=deployment
    client,provider=fresh()
    with client:
        assert client.get('/mcp').status_code==401
        assert client.get('/health').status_code==401
        assert client.get('/health',headers={'Authorization':'Bearer synthetic-health-token'}).status_code==200
        assert client.get('http://mail.example.test/mcp').status_code==403
        assert client.get('/mcp',headers={'Origin':'https://evil.test'}).status_code==403
        assert client.post('/register',content=b'x'*16385).status_code==413
        reg=client.post('/register',json={'redirect_uris':['https://evil.test/callback']})
        assert reg.status_code==400 and provider.diagnostic()['registered_clients']==0


def test_real_mode_revokes_validation_grants_and_requires_policy(deployment,mail):
    fresh,state,owner,key,registry=deployment
    client,_=fresh()
    with client:tokens,reg=exchange(client)
    provider=Provider(ISSUER,owner,state,key,deployment_tag='real-mail:synthetic-account-hash')
    config={'token_file':str(registry),'allowed_hosts':['mail.example.test'],
        'allowed_origins':[ISSUER,'https://grok.com'],'web_auth_verified':False}
    app=create_oauth_app(mail,config,provider,digest('synthetic-health-token'),validation=False)
    with TestClient(app,base_url=ISSUER,follow_redirects=False) as client:
        assert call(client,tokens['access_token']).status_code==401
        data,_=grant(client,validation=False)
        assert client.post('/token',data=data).status_code==200


def test_expired_access_and_registration_limits(deployment):
    fresh,*_=deployment
    client,provider=fresh()
    with client:
        tokens,_=exchange(client)
        with provider.store.transaction() as db:
            db.execute("UPDATE state SET expires=0 WHERE kind='access'")
        assert call(client,tokens['access_token']).status_code==401
        for _ in range(31):
            assert client.post('/register',json={'redirect_uris':[REDIRECT]}).status_code==201
        assert client.post('/register',json={'redirect_uris':[REDIRECT]}).status_code==400


def test_sdk_errors_do_not_echo_submitted_secrets(deployment):
    fresh,*_=deployment
    client,_=fresh()
    marker='synthetic-secret-that-must-not-be-reflected'
    with client:
        reg=client.post('/register',json={'redirect_uris':[REDIRECT],'token_endpoint_auth_method':'none'}).json()
        response=client.post('/token',data={'client_id':reg['client_id'],'grant_type':marker,'client_secret':marker})
        assert response.status_code in {400,401} and marker not in response.text


def test_persistent_owner_lockout_and_csrf(deployment):
    fresh,*_=deployment
    client,provider=fresh()
    with client:
        reg=client.post('/register',json={'redirect_uris':[REDIRECT],'token_endpoint_auth_method':'none'}).json()
        # Obtain a valid challenge through the same SDK request as the grant helper.
        challenge=base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip('=')
        auth=client.get('/authorize',params={'client_id':reg['client_id'],'response_type':'code',
            'redirect_uri':REDIRECT,'code_challenge':challenge,'code_challenge_method':'S256','scope':SCOPE})
        location=auth.headers['location'];page=client.get(location)
        csrf=re.search(r'name="csrf" type="hidden" value="([^"]+)"',page.text)[1]
        assert client.post(location,data={'csrf':csrf,'phrase':PHRASE},headers={'Origin':'https://evil.test'}).status_code==403
        assert client.post(location,data={'csrf':'wrong','phrase':PHRASE},headers={'Origin':ISSUER}).status_code==403
        request_key=parse_qs(urlsplit(location).query)['request'][0]
        for _ in range(5):
            with pytest.raises(ValueError):provider.consent(request_key,csrf,'synthetic-wrong-owner-phrase')
    client,provider=fresh()
    with client:
        provider.set_csrf(request_key,'synthetic-new-csrf')
        with pytest.raises(ValueError):provider.consent(request_key,'synthetic-new-csrf',PHRASE)
        assert provider.diagnostic()['active_grants']==0
