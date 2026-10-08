"""SDK OAuth flow with synthetic-only data; never contacts Grok or IMAP."""
import base64
import hashlib
import re
import time
from urllib.parse import parse_qs, urlsplit

import pytest
from starlette.testclient import TestClient

from integration.oauth_canary import create_canary, digest

ISSUER='https://canary.example.test'
REDIRECT='https://grok.com/oauth/callback'
PHRASE='synthetic-canary-owner-passphrase'
VERIFIER='synthetic-pkce-verifier-'+'a'*43


@pytest.fixture
def flow():
    salt=bytes(16)
    owner={'salt':salt.hex(),'hash':hashlib.scrypt(PHRASE.encode(),salt=salt,n=16384,r=8,p=1).hex()}
    app,provider=create_canary(ISSUER,owner,['https://grok.com'],digest('synthetic-health-token'))
    with TestClient(app,base_url=ISSUER,follow_redirects=False) as client:
        yield client,provider


def register(client, **overrides):
    data={'redirect_uris':[REDIRECT],'token_endpoint_auth_method':'none',
          'grant_types':['authorization_code','refresh_token'],'response_types':['code'],'scope':'canary.read'}
    data.update(overrides)
    return client.post('/register',json=data)


def pending(client, client_id, **overrides):
    challenge=base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip('=')
    data={'response_type':'code','client_id':client_id,'redirect_uri':REDIRECT,
          'scope':'canary.read','code_challenge':challenge,'code_challenge_method':'S256',
          'state':'synthetic-state','resource':ISSUER+'/mcp'}
    data.update(overrides)
    return client.get('/authorize',params={k:v for k,v in data.items() if v is not None})


def consent(client, location, *, phrase=PHRASE, origin=ISSUER, cookie=True):
    page=client.get(location)
    assert page.status_code==200
    csrf=re.search(r'name="csrf" type="hidden" value="([^"]+)"',page.text).group(1)
    if not cookie:
        client.cookies.clear()
    return client.post(location,data={'csrf':csrf,'phrase':phrase},headers={'Origin':origin})


def grant(client, method='none', registration_out=None):
    registration=register(client,token_endpoint_auth_method=method)
    assert registration.status_code==201, registration.text
    client_id=registration.json()['client_id']
    if registration_out is not None:
        registration_out.update(registration.json())
    authorization=pending(client,client_id)
    assert authorization.status_code==302
    approved=consent(client,authorization.headers['location'])
    assert approved.status_code==303
    url=urlsplit(approved.headers['location'])
    assert url.scheme=='https' and url.hostname=='grok.com'
    query=parse_qs(url.query)
    assert query['state']==['synthetic-state']
    return {'grant_type':'authorization_code','client_id':client_id,
            'code':query['code'][0],'code_verifier':VERIFIER,'redirect_uri':REDIRECT}


def test_metadata_and_unauthenticated_mcp(flow):
    client,_=flow
    protected=client.get('/.well-known/oauth-protected-resource/mcp')
    assert protected.status_code==200
    assert protected.json()['resource']==ISSUER+'/mcp'
    metadata=client.get('/.well-known/oauth-authorization-server').json()
    assert metadata['code_challenge_methods_supported']==['S256']
    assert metadata['registration_endpoint']==ISSUER+'/register'
    response=client.get('/mcp')
    assert response.status_code==401 and 'resource_metadata=' in response.headers['www-authenticate']


@pytest.mark.parametrize('uri',[
    'http://grok.com/callback','https://grok.com.evil.test/callback',
    'https://grok.com@evil.test/callback','https://evil.test/callback',
    'https://grok.com:8443/callback','https://grok.com/callback#secret',
])
def test_registration_redirect_allowlist(flow,uri):
    client,provider=flow
    response=register(client,redirect_uris=[uri])
    assert response.status_code==400 and not provider.clients


@pytest.mark.parametrize('changes',[
    {'resource':'https://mail.example.test/mcp'}, {'scope':'mail.read'},
    {'code_challenge_method':'plain'}, {'code_challenge':'too-short'},
])
def test_authorization_resource_scope_pkce(flow,changes):
    client,provider=flow
    client_id=register(client).json()['client_id']
    response=pending(client,client_id,**changes)
    assert response.status_code in {302,400}
    assert not provider.pending and not provider.codes and not provider.access


@pytest.mark.parametrize('changes',[
    {'phrase':'wrong-synthetic-passphrase'}, {'origin':'https://evil.test'}, {'cookie':False},
])
def test_owner_consent_required(flow,changes):
    client,provider=flow
    client_id=register(client).json()['client_id']
    location=pending(client,client_id).headers['location']
    assert consent(client,location,**changes).status_code==403
    assert not provider.codes and not provider.access


def test_pkce_and_one_use_code(flow):
    client,provider=flow
    data=grant(client)
    assert client.post('/token',data={**data,'code_verifier':'wrong-verifier-'+'b'*43}).status_code==400
    assert not provider.access
    reply=client.post('/token',data=data)
    assert reply.status_code==200
    assert client.post('/token',data=data).status_code==400
    assert not provider.codes


def test_omitted_resource_uses_only_canary_audience(flow):
    client,provider=flow
    client_id=register(client).json()['client_id']
    response=pending(client,client_id,resource=None)
    assert response.status_code==302
    approved=consent(client,response.headers['location'])
    assert approved.status_code==303
    code=parse_qs(urlsplit(approved.headers['location']).query)['code'][0]
    assert provider.codes[digest(code)]['model'].resource==ISSUER+'/mcp'


@pytest.mark.parametrize('method',['client_secret_post','client_secret_basic'])
def test_confidential_client_authentication_and_revocation(flow,method):
    client,provider=flow
    registration={}
    data=grant(client,method,registration)
    secret=registration['client_secret']
    headers={}
    if method=='client_secret_basic':
        data.pop('client_id')
        encoded=base64.b64encode((registration['client_id']+':'+secret).encode()).decode()
        headers={'Authorization':'Basic '+encoded}
        wrong={'Authorization':'Basic '+base64.b64encode((registration['client_id']+':wrong').encode()).decode()}
        assert client.post('/token',data=data,headers=wrong).status_code==401
    else:
        assert client.post('/token',data={**data,'client_secret':'wrong'}).status_code==401
        data['client_secret']=secret
    response=client.post('/token',data=data,headers=headers)
    assert response.status_code==200
    revoke={'token':response.json()['access_token'],'token_type_hint':'access_token'}
    if method=='client_secret_post':
        revoke.update(client_id=registration['client_id'],client_secret=secret)
    assert client.post('/revoke',data=revoke,headers=headers).status_code==200
    assert not provider.access and not provider.refresh


def test_refresh_rotation_replay_and_revocation(flow):
    client,provider=flow
    data=grant(client)
    first=client.post('/token',data=data).json()
    refresh_data={'grant_type':'refresh_token','client_id':data['client_id'],'refresh_token':first['refresh_token']}
    second=client.post('/token',data=refresh_data)
    assert second.status_code==200
    assert digest(first['access_token']) not in provider.access
    assert client.post('/token',data=refresh_data).status_code==400
    assert not provider.access and not provider.refresh
    # A separate grant remains revocable without printing raw token values.
    data=grant(client)
    fresh=client.post('/token',data=data).json()
    response=client.post('/revoke',data={'client_id':data['client_id'],'token':fresh['access_token'],'token_type_hint':'access_token'})
    assert response.status_code==200 and not provider.access and not provider.refresh


def test_authenticated_tools_are_only_synthetic(flow):
    client,_=flow
    token=client.post('/token',data=grant(client)).json()['access_token']
    headers={'Authorization':'Bearer '+token,'Accept':'application/json, text/event-stream',
             'MCP-Protocol-Version':'2025-11-25'}
    listed=client.post('/mcp',headers=headers,json={'jsonrpc':'2.0','id':1,'method':'tools/list','params':{}})
    assert listed.status_code==200
    tools=listed.json()['result']['tools']
    assert len(tools)==7 and all(t['annotations']['readOnlyHint'] for t in tools)
    message=client.post('/mcp',headers=headers,json={'jsonrpc':'2.0','id':2,'method':'tools/call',
        'params':{'name':'mail_get_message','arguments':{'folder':'INBOX','uid':1,'uidvalidity':77}}})
    assert message.status_code==200
    body=message.json()['result']['structuredContent']
    assert body['canary'] is True and body['untrusted_content'] is True
    assert '합성 테스트 메일' in body['body']
    invalid=client.post('/mcp',headers=headers,json={'jsonrpc':'2.0','id':3,'method':'tools/call',
        'params':{'name':'mail_list_recent','arguments':{'limit':True}}})
    assert invalid.json()['result']['isError'] is True


def test_expired_grants_and_memory_only_restart(flow):
    client,provider=flow
    token=client.post('/token',data=grant(client)).json()['access_token']
    provider.access[digest(token)]['expires']=time.time()-1
    provider.prune()
    assert not provider.access
    _,new=create_canary(ISSUER,provider.owner,['https://grok.com'],digest('synthetic-health-token'))
    assert not new.clients and not new.access and not new.refresh


def test_https_host_origin_size_and_rate_boundaries(flow):
    client,_=flow
    assert client.get('http://canary.example.test/.well-known/oauth-authorization-server').status_code==403
    assert client.get('/.well-known/oauth-authorization-server',headers={'Host':'evil.test'}).status_code==421
    assert client.get('/.well-known/oauth-authorization-server',headers={'Origin':'https://evil.test'}).status_code==403
    assert client.post('/register',content=b'x'*16385).status_code==413
    assert client.get('/health').status_code==401
    assert client.get('/health',headers={'Authorization':'Bearer synthetic-health-token'}).status_code==200
    for _ in range(120):
        response=client.get('/.well-known/oauth-authorization-server')
    assert response.status_code==429
