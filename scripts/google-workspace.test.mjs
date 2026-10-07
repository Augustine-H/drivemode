import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoogleWorkspace, WorkspaceStore, WORKSPACE_SCOPES, googleWorkspace } from '../src/lib/google-workspace.server.ts';
const config={clientId:'test-client',clientSecret:'test-secret',origin:'https://test.tail.example',directory:''};
function memory(value={}) {return {value,async read(){return structuredClone(this.value);},async write(v){this.value=structuredClone(v);}};}
const response=(body,status=200)=>Response.json(body,{status});
test('OAuth requests only read scopes, uses PKCE, consumes state and prevents replay',async()=>{
  const store=memory();let exchanges=0;
  const client=new GoogleWorkspace(config,store,async(url,options)=>{
    exchanges++; assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.ok(options.body.get('code_verifier'));
    return response({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:Object.values(WORKSPACE_SCOPES).join(' ')});
  });
  const url=new URL((await client.connect()).url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.deepEqual(url.searchParams.get('scope').split(' '),Object.values(WORKSPACE_SCOPES));
  await assert.rejects(client.callback('code','wrong'),e=>e.code==='state');assert.equal(exchanges,0);
  const state=url.searchParams.get('state');await client.callback('code',state);
  await assert.rejects(client.callback('code',state),e=>e.code==='state');assert.equal(exchanges,1);
  const status=await client.status();assert.equal(status.connected,true);assert.equal(JSON.stringify(status).includes('refresh'),false);
});
test('denied consent retains existing connection without token exchange',async()=>{
  const store=memory({refreshToken:'old'});const client=new GoogleWorkspace(config,store,()=>{throw new Error('unexpected network');});
  const url=new URL((await client.connect()).url);await client.callback('',url.searchParams.get('state'),true);
  assert.equal(store.value.refreshToken,'old');assert.equal(store.value.pending,undefined);
});
test('scope denial blocks API and invalid refresh clears credentials',async()=>{
  const store=memory({refreshToken:'old',scopes:[WORKSPACE_SCOPES.drive]});let calls=0;
  const client=new GoogleWorkspace(config,store,async()=>{calls++;return response({error:'invalid_grant'},400);});
  await assert.rejects(client.calendars(),e=>e.code==='consent');assert.equal(calls,0);
  await assert.rejects(client.files('', ''),e=>e.code==='expired');assert.deepEqual(store.value,{});
});
test('all data operations use GET, drive query is escaped, mail body stays plain text',async()=>{
  const store=memory({refreshToken:'refresh',accessToken:'access',expiresAt:Date.now()+3600000,scopes:Object.values(WORKSPACE_SCOPES)});
  const calls=[];const client=new GoogleWorkspace(config,store,async(url,options)=>{calls.push([url,options.method]);
    if(url.includes('format=full'))return response({snippet:'fallback',payload:{parts:[{mimeType:'text/plain',body:{data:Buffer.from('safe text').toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from('<script>bad</script>').toString('base64url')}}]}});
    return response({items:[],files:[],messages:[]});});
  await client.calendars();await client.events('primary','','');await client.files("a' or trashed = true",'');await client.messages('is:unread','');
  assert.deepEqual(await client.message('abcdef'),{text:'safe text'});
  assert.ok(calls.every(([,method])=>method==='GET'));assert.match(new URL(calls[2][0]).searchParams.get('q'),/a\\' or/);
});
test('store encrypts credentials and authenticates persisted ciphertext',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'voice-grok-google-test-'));
  try {const store=new WorkspaceStore(dir);await store.write({refreshToken:'very-secret-token'});
    const data=await readFile(join(dir,'oauth.enc'));assert.equal(data.includes(Buffer.from('very-secret-token')),false);
    assert.equal((await store.read()).refreshToken,'very-secret-token');
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('NAS routes reject anonymous and cross-origin callers before touching tokens',async()=>{
  assert.equal((await googleWorkspace(new Request('https://localhost/api/google-workspace'))).status,403);
  const saved={...process.env};Object.assign(process.env,{VOICE_GROK_PRIVATE_NAS:'true',VOICE_GROK_NAS_LOGIN:'owner',VOICE_GROK_NAS_ORIGIN:config.origin});
  try {const request=new Request(`${config.origin}/api/google-workspace?action=connect`,{method:'POST',headers:{'tailscale-user-login':'owner','x-forwarded-host':'test.tail.example','x-forwarded-proto':'https',origin:'https://evil.example'}});
    assert.equal((await googleWorkspace(request)).status,403);
  } finally {for(const key of ['VOICE_GROK_PRIVATE_NAS','VOICE_GROK_NAS_LOGIN','VOICE_GROK_NAS_ORIGIN']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});
