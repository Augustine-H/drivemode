"""Owner-approved mail.read grants with encrypted, transactional persistence."""
import hashlib
import hmac
import re
import secrets
import time
from urllib.parse import urlsplit
from mcp.server.auth.provider import (
    AccessToken, AuthorizationCode, AuthorizationParams, AuthorizeError,
    RefreshToken, RegistrationError, TokenError, construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from .oauth_store import Store, digest

SCOPE = 'mail.read'


def origin(url):
    p = urlsplit(url)
    if (p.scheme!='https' or not p.hostname or p.username is not None
            or p.password is not None or p.fragment or any(c.isspace() for c in url)):
        raise ValueError('invalid_https_url')
    return 'https://'+p.hostname+(f':{p.port}' if p.port not in {None,443} else '')


class Provider:
    def __init__(self, issuer, owner, directory, key, redirect_origins=('https://grok.com',), deployment_tag='validation'):
        self.issuer = origin(issuer)
        if self.issuer != issuer:
            raise ValueError('issuer_must_be_an_origin')
        self.resource = issuer+'/mcp'
        self.owner = owner
        if len(bytes.fromhex(owner['salt']))!=16 or len(bytes.fromhex(owner['hash']))!=64:
            raise ValueError('invalid_owner_hash')
        self.redirect_origins = set(redirect_origins)
        if self.redirect_origins != {'https://grok.com'}:
            raise ValueError('verified_grok_origin_required')
        self.store = Store(directory,key)
        self.denied_redirect_origins = set()
        with self.store.transaction() as db:
            old = self.store.get(db,'meta','deployment')
            current = {'issuer':issuer,'owner':digest(owner['hash']),'deployment':deployment_tag}
            if old and old['issuer']!=issuer:
                raise ValueError('state_issuer_mismatch')
            if old and (old['owner']!=current['owner'] or old.get('deployment')!=deployment_tag):
                db.execute("DELETE FROM state WHERE kind IN ('pending','code','access','refresh','spent')")
            self.store.put(db,'meta','deployment',current,4102444800)

    async def get_client(self, client_id):
        with self.store.transaction() as db:
            row = self.store.get(db,'client',digest(client_id))
            return OAuthClientInformationFull.model_validate(row) if row else None

    async def register_client(self, client_info):
        try:
            uris = client_info.redirect_uris or []
            if not 1<=len(uris)<=4 or any(origin(str(u)) not in self.redirect_origins for u in uris):
                raise ValueError()
        except ValueError:
            for uri in client_info.redirect_uris or []:
                try:
                    if len(self.denied_redirect_origins)<16:
                        self.denied_redirect_origins.add(origin(str(uri)))
                except ValueError:
                    pass
            raise RegistrationError('invalid_redirect_uri','redirect_origin_denied') from None
        if (client_info.token_endpoint_auth_method not in {'none','client_secret_post','client_secret_basic'}
                or set(client_info.grant_types)-{'authorization_code','refresh_token'}
                or set(client_info.response_types)!={'code'}):
            raise RegistrationError('invalid_client_metadata','unsupported_client')
        try:
            with self.store.transaction() as db:
                self.store.put(db,'client',digest(client_info.client_id),client_info.model_dump(mode='json'),time.time()+900)
        except ValueError:
            raise RegistrationError('invalid_client_metadata','registration_limit') from None

    async def authorize(self, client, params):
        if (params.resource not in {None,self.resource} or set(params.scopes or [])!={SCOPE}
                or not re.fullmatch(r'[A-Za-z0-9_-]{43}',params.code_challenge)
                or (params.state is not None and len(params.state)>512)):
            raise AuthorizeError('invalid_request','invalid_authorization')
        key = secrets.token_urlsafe(32)
        try:
            with self.store.transaction() as db:
                self.store.put(db,'pending',digest(key),{'client':client.client_id,
                    'params':params.model_dump(mode='json'),'csrf':None},time.time()+300)
        except ValueError:
            raise AuthorizeError('invalid_request','authorization_limit') from None
        return self.issuer+'/consent?request='+key

    def consent_record(self, key):
        with self.store.transaction() as db:
            return self.store.get(db,'pending',digest(key))

    def set_csrf(self, key, csrf):
        with self.store.transaction() as db:
            row = self.store.get(db,'pending',digest(key))
            if not row:
                raise ValueError('consent_unavailable')
            # Keep the existing expiry, never extend an authorization request.
            expiry = db.execute("SELECT expires FROM state WHERE kind='pending' AND ident=?",(digest(key),)).fetchone()[0]
            row['csrf'] = digest(csrf)
            self.store.put(db,'pending',digest(key),row,expiry)

    def consent(self, key, csrf, phrase):
        invalid = False
        redirect = None
        with self.store.transaction() as db:
            row = self.store.get(db,'pending',digest(key))
            attempts = self.store.get(db,'meta','owner_attempts') or {'count':0}
            if (not row or not row['csrf'] or not hmac.compare_digest(row['csrf'],digest(csrf))
                    or attempts['count']>=5 or not 16<=len(phrase)<=256):
                invalid = True
            else:
                candidate = hashlib.scrypt(phrase.encode(),salt=bytes.fromhex(self.owner['salt']),n=16384,r=8,p=1).hex()
                if not hmac.compare_digest(candidate,self.owner['hash']):
                    self.store.put(db,'meta','owner_attempts',{'count':attempts['count']+1},time.time()+900)
                    invalid = True
                else:
                    params = AuthorizationParams.model_validate(row['params'])
                    client = self.store.get(db,'client',digest(row['client']))
                    if not client:
                        invalid = True
                    else:
                        code = secrets.token_urlsafe(32)
                        model = AuthorizationCode(code=code,client_id=row['client'],scopes=[SCOPE],
                            expires_at=time.time()+60,code_challenge=params.code_challenge,
                            redirect_uri=params.redirect_uri,redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
                            resource=self.resource,subject='mail-owner')
                        self.store.put(db,'code',digest(code),model.model_dump(mode='json'),model.expires_at)
                        self.store.put(db,'client',digest(row['client']),client,time.time()+30*86400)
                        self.store.delete(db,'pending',digest(key))
                        self.store.delete(db,'meta','owner_attempts')
                        redirect = construct_redirect_uri(str(params.redirect_uri),code=code,state=params.state)
        if invalid:
            raise ValueError('consent_denied')
        return redirect

    async def load_authorization_code(self, client, authorization_code):
        with self.store.transaction() as db:
            row = self.store.get(db,'code',digest(authorization_code))
            return AuthorizationCode.model_validate(row) if row and row['client_id']==client.client_id else None

    def issue(self, db, client, family=None, end=None):
        now = int(time.time())
        access,refresh = secrets.token_urlsafe(48),secrets.token_urlsafe(48)
        row = {'client':client.client_id,'family':family or secrets.token_hex(16),
               'end':end or now+7*86400}
        access_expiry = min(now+600,row['end'])
        refresh_expiry = min(now+86400,row['end'])
        self.store.put(db,'access',digest(access),{**row,'expires':access_expiry},access_expiry)
        self.store.put(db,'refresh',digest(refresh),{**row,'expires':refresh_expiry},refresh_expiry)
        return OAuthToken(access_token=access,refresh_token=refresh,expires_in=access_expiry-now,scope=SCOPE)

    async def exchange_authorization_code(self, client, authorization_code):
        try:
            with self.store.transaction() as db:
                row = self.store.get(db,'code',digest(authorization_code.code))
                if not row or row['client_id']!=client.client_id:
                    raise ValueError()
                self.store.delete(db,'code',digest(authorization_code.code))
                return self.issue(db,client)
        except ValueError:
            raise TokenError('invalid_grant','authorization_code_unavailable') from None

    async def load_refresh_token(self, client, refresh_token):
        with self.store.transaction() as db:
            ident = digest(refresh_token)
            spent = self.store.get(db,'spent',ident)
            if spent and spent['client']==client.client_id:
                self.store.family(db,spent['family'])
            row = self.store.get(db,'refresh',ident)
            return (RefreshToken(token=refresh_token,client_id=client.client_id,scopes=[SCOPE],
                expires_at=row['expires'],resource=self.resource,subject='mail-owner')
                if row and row['client']==client.client_id else None)

    async def exchange_refresh_token(self, client, refresh_token, scopes):
        invalid = False
        tokens = None
        try:
            with self.store.transaction() as db:
                ident = digest(refresh_token.token)
                row = self.store.get(db,'refresh',ident)
                if not row or row['client']!=client.client_id or scopes!=[SCOPE]:
                    spent = self.store.get(db,'spent',ident)
                    if spent and spent['client']==client.client_id:
                        self.store.family(db,spent['family'])
                    invalid = True
                else:
                    self.store.family(db,row['family'])
                    self.store.put(db,'spent',ident,row,row['end'])
                    tokens = self.issue(db,client,row['family'],row['end'])
        except ValueError:
            raise TokenError('invalid_grant','grant_limit') from None
        if invalid:
            raise TokenError('invalid_grant','refresh_token_unavailable')
        return tokens

    async def load_access_token(self, token):
        with self.store.transaction() as db:
            row = self.store.get(db,'access',digest(token))
            return (AccessToken(token=token,client_id=row['client'],scopes=[SCOPE],
                expires_at=row['expires'],resource=self.resource,subject='mail-owner') if row else None)

    async def revoke_token(self, token):
        with self.store.transaction() as db:
            ident = digest(token.token)
            row = self.store.get(db,'access',ident) or self.store.get(db,'refresh',ident)
            if row:
                self.store.family(db,row['family'])

    def diagnostic(self):
        with self.store.transaction() as db:
            return {'registered_clients':self.store.count(db,'client'),
                    'pending_consents':self.store.count(db,'pending'),
                    'active_grants':self.store.count(db,'access'),
                    'denied_redirect_origins':sorted(self.denied_redirect_origins)}
