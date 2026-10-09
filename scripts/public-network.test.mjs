import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sessionToken, sessionDevice, sessionCookies, ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE } from '../src/lib/public-access.server.ts';
import { publicBoundary } from '../src/lib/public-boundary.server.ts';
import { nasAccess } from '../src/lib/nas-access.ts';
import middleware from '../server/middleware/nas-access.ts';
import { musicProxy } from '../src/lib/music-proxy.server.ts';
const env = { VOICE_GROK_PUBLIC_ORIGIN:'https://voice.example.com', VOICE_GROK_LAN_ORIGIN:'https://voice.lan.example.com', VOICE_GROK_SESSION_SECRET:'s'.repeat(64), VOICE_GROK_PAIRING_HASH:createHash('sha256').update('p'.repeat(64)).digest('hex'), VOICE_GROK_PRIVATE_NAS:'true', VOICE_GROK_NAS_ORIGIN:'https://nas.example.ts.net:8445', VOICE_GROK_NAS_LOGIN:'owner@example.com', VOICE_GROK_MUSIC_CLIENT_TOKEN:'m'.repeat(64) };
const device = '12345678-1234-1234-1234-123456789abc';
function headers(auth = true) { return new Headers({ host:'voice.example.com','x-forwarded-host':'voice.example.com','x-forwarded-proto':'https', origin:env.VOICE_GROK_PUBLIC_ORIGIN, ...(auth ? {cookie:`${ACCESS_COOKIE}=${sessionToken(device,'access',env)}; ${REFRESH_COOKIE}=${sessionToken(device,'refresh',env)}; ${DEVICE_COOKIE}=${device}`} : {}) }); }
const req = (path, auth = true, init = {}) => new Request(env.VOICE_GROK_PUBLIC_ORIGIN + path, {headers:headers(auth), ...init});
test('expired, tampered, wrong device, wrong host and plaintext session requests fail closed', () => {
  assert.equal(sessionDevice(headers(), 'access', env), device);
  const expired=headers();expired.set('cookie', `${ACCESS_COOKIE}=${sessionToken(device,'access',env,Date.now()-901000)}; ${DEVICE_COOKIE}=${device}`);
  assert.equal(sessionDevice(expired,'access',env),'');
  const wrongDevice=headers();wrongDevice.set('cookie',wrongDevice.get('cookie').replace(`${DEVICE_COOKIE}=${device}`,`${DEVICE_COOKIE}=00000000-0000-0000-0000-000000000000`));
  for (const h of [expired, wrongDevice]) assert.equal(nasAccess(h,env).allowed,false);
  for (const [key,value] of [['x-forwarded-host','evil.example'],['x-forwarded-proto','http'],['cookie','invalid']]) {const h=headers();h.set(key,value);assert.equal(sessionDevice(h,'access',env),'');}
  const duplicate=headers();duplicate.append('cookie',`${ACCESS_COOKIE}=invalid`);assert.equal(sessionDevice(duplicate,'access',env),'');
  const badSignature=headers();badSignature.set('cookie',badSignature.get('cookie').replace(/\.[A-Za-z0-9_-]+;/,'.invalid;'));assert.equal(sessionDevice(badSignature,'access',env),'');
});
test('public APIs and server functions require device authentication; spoofed Serve identity does not bypass it', async () => {
  for (const path of ['/health','/api/ask','/api/google-tts','/api/music/health','/_serverFn/test']) assert.equal((await publicBoundary(req(path,false),env)).status,401);
  const h=headers(false);h.set('tailscale-user-login',env.VOICE_GROK_NAS_LOGIN);
  assert.equal(nasAccess(h,env).allowed,false);
  assert.equal((await publicBoundary(req('/api/music/internal/worker/poll'),env)).status,404);
  assert.equal((await publicBoundary(req('/api/debug'),env)).status,404);
  assert.deepEqual(await (await publicBoundary(req('/health'),env)).json(),{status:'ok',service:'voice-grok'});
  assert.equal(await publicBoundary(req('/api/ask',true,{method:'POST'}),env),null);
});
test('registration creates secure HTTP-only cookies, refresh works and malicious origins are rejected', async () => {
  const pair=await publicBoundary(req('/api/network/pair',false,{method:'POST',body:JSON.stringify({code:'p'.repeat(64)})}),env);
  assert.equal(pair.status,200);
  const cookies=pair.headers.getSetCookie();assert.equal(cookies.length,3);
  for (const cookie of cookies) assert.match(cookie,/Path=\/; Secure; HttpOnly; SameSite=None; Max-Age=/);
  const h=headers(false);h.set('cookie',cookies.map(row=>row.split(';')[0]).join('; '));
  assert.ok(sessionDevice(h,'access',env));
  assert.equal((await publicBoundary(req('/api/network/refresh',true,{method:'POST',headers:h}),env)).status,200);
  h.set('origin','https://evil.example');
  assert.equal((await publicBoundary(req('/api/ask',true,{method:'POST',headers:h}),env)).status,403);
  const missing=headers();missing.delete('origin');assert.equal((await publicBoundary(req('/api/ask',true,{method:'POST',headers:missing}),env)).status,403);
  const rotated={...env,VOICE_GROK_SESSION_SECRET:'r'.repeat(64)};assert.equal(sessionDevice(headers(),'refresh',rotated),'');
  const lan=headers(false);lan.set('x-forwarded-host','voice.lan.example.com');lan.set('origin',env.VOICE_GROK_LAN_ORIGIN);
  lan.set('cookie',sessionCookies(device,env,env.VOICE_GROK_LAN_ORIGIN).map(row=>row.split(';')[0]).join('; '));assert.equal(sessionDevice(lan,'access',env),device);
  lan.set('x-forwarded-host','voice.example.com');assert.equal(sessionDevice(lan,'access',env),'');
});
test('wrong registration code, body limit and repeated attempts are blocked', async () => {
  const h=headers(false);h.set('x-real-ip','192.0.2.123');
  for (let i=0;i<5;i++) assert.equal((await publicBoundary(req('/api/network/pair',false,{method:'POST',headers:h,body:JSON.stringify({code:'wrong'})}),env)).status,401);
  assert.equal((await publicBoundary(req('/api/network/pair',false,{method:'POST',headers:h,body:'{}'}),env)).status,429);
  const large=headers(false);large.set('x-real-ip','192.0.2.124');
  assert.equal((await publicBoundary(req('/api/network/pair',false,{method:'POST',headers:large,body:'x'.repeat(513)}),env)).status,413);
});
test('boundary middleware emits credentialed exact-origin CORS and blocks unauthenticated requests', async () => {
  const previous={...process.env};Object.assign(process.env,env);
  try {
    const h=headers();h.set('origin','https://drivemode.grok.me');
    const result=await middleware({req:req('/health',true,{headers:h})},()=>{throw Error('health must terminate')});
    assert.equal(result.status,200);assert.equal(result.headers.get('access-control-allow-origin'),'https://drivemode.grok.me');assert.equal(result.headers.get('access-control-allow-credentials'),'true');
    const denied=await middleware({req:req('/api/ask',false,{method:'POST'})},()=>{throw Error('unauthenticated must terminate')});assert.equal(denied.status,401);
    const preflight=headers(false);preflight.set('access-control-request-method','POST');preflight.set('access-control-request-headers','content-type,x-tsr-serverfn');
    assert.equal((await middleware({req:req('/_serverFn/test',false,{method:'OPTIONS',headers:preflight})},()=>{})).status,204);
  } finally {for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
test('music proxy preserves Range/206 and streams the first chunk before upstream completion', async () => {
  const previous={...process.env};Object.assign(process.env,env);let finish;
  try {
    const h=headers();h.set('range','bytes=0-3');
    const response=await musicProxy(req('/api/music/v1/jobs/'+device+'/audio/mp3',true,{headers:h}),async(url,init)=>{
      assert.equal(url.host,'127.0.0.1:8094');assert.equal(init.headers.get('range'),'bytes=0-3');assert.equal(init.headers.get('authorization'),'Bearer '+env.VOICE_GROK_MUSIC_CLIENT_TOKEN);
      return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));finish=()=>{c.enqueue(new Uint8Array([3,4]));c.close();};}}),{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-3/10','accept-ranges':'bytes'}});
    });
    assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-3/10');
    const reader=response.body.getReader();assert.deepEqual(Array.from((await reader.read()).value),[1,2]);finish();assert.deepEqual(Array.from((await reader.read()).value),[3,4]);
    assert.equal((await musicProxy(req('/api/music/internal/worker/poll',true,{method:'POST'}))).status,404);
    const large=headers();large.set('content-length','25700001');assert.equal((await musicProxy(req('/api/music/v1/jobs',true,{method:'POST',headers:large,body:'{}'}))).status,413);
  } finally {for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
