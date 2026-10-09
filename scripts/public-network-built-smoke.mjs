// Built NAS runtime integration; loopback HTTP simulates trusted proxy headers.
// Does not prove public DNS/TLS, DSM behavior, or mobile-device compatibility.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const code = randomBytes(48).toString('base64url');
const origin = 'https://voice.example.test';
const env = { ...process.env, NITRO_HOST:'127.0.0.1', NITRO_PORT:String(port), VOICE_GROK_PRIVATE_NAS:'true', VOICE_GROK_NAS_ORIGIN:'https://nas.example.ts.net:8445', VOICE_GROK_NAS_LOGIN:'owner@example.test', VOICE_GROK_PUBLIC_ORIGIN:origin, VOICE_GROK_SESSION_SECRET:randomBytes(48).toString('base64url'), VOICE_GROK_PAIRING_HASH:createHash('sha256').update(code).digest('hex') };
for (const key of Object.keys(env)) if (/^(GOOGLE_|XAI_|VOICE_GROK_MUSIC_)/.test(key)) delete env[key];
const child = spawn(process.execPath, ['.output/server/index.mjs'], { env, windowsHide:true, stdio:['ignore','ignore','ignore'] });
let exited = false; child.on('exit', () => { exited = true; });
const base = `http://127.0.0.1:${port}`;
const headers = { 'x-forwarded-host':'voice.example.test', 'x-forwarded-proto':'https', origin };
const request = (path, init={}) => fetch(base + path, { ...init, headers:{...headers,...init.headers}, redirect:'manual', signal:AbortSignal.timeout(5000) });
const results = {};
try {
  let ready = false;
  for (let i=0;i<80;i++) {
    if (exited) throw new Error('Built NAS runtime exited');
    try { const response=await request('/api/network/status'); if(response.ok){assert.equal((await response.json()).public,true);ready=true;break;} } catch { /* Retry during startup. */ }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'Built runtime must become ready');
  results.unauthenticated=[];
  for (const path of ['/health','/api/ask','/api/google-tts','/api/music/health','/_serverFn/test']) {
    const response=await request(path);assert.equal(response.status,401);results.unauthenticated.push({path,status:response.status});
  }
  assert.equal((await request('/api/network/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'wrong'})})).status,401);
  const pair=await request('/api/network/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});assert.equal(pair.status,200);
  const cookie=pair.headers.getSetCookie().map(row=>row.split(';')[0]).join('; ');
  assert.equal(pair.headers.getSetCookie().length,3);results.registration=true;
  const health=await request('/health',{headers:{cookie}});assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');results.authenticatedHealth=200;
  assert.equal((await request('/api/network/refresh',{method:'POST',headers:{cookie}})).status,200);results.refresh=true;
  assert.equal((await request('/api/music/internal/worker/poll',{method:'POST',headers:{cookie}})).status,404);
  assert.equal((await request('/api/debug',{headers:{cookie}})).status,404);results.adminIsolated=true;
  assert.equal((await request('/api/ask',{method:'POST',headers:{cookie,origin:'https://evil.example'},body:'{}'})).status,403);results.csrfBlocked=true;
  assert.equal((await request('/health',{headers:{cookie:cookie.replace(/\.[A-Za-z0-9_-]+;/,'.invalid;')}})).status,401);results.tamperedTokenBlocked=true;
  const cors=await request('/health',{headers:{cookie,origin:'https://drivemode.grok.me'}});assert.equal(cors.status,200);assert.equal(cors.headers.get('access-control-allow-origin'),'https://drivemode.grok.me');assert.equal(cors.headers.get('access-control-allow-credentials'),'true');results.exactOriginCors=true;
  const privateHealth=await request('/health',{headers:{'x-forwarded-host':'nas.example.ts.net:8445','tailscale-user-login':'owner@example.test',origin:'https://nas.example.ts.net:8445'}});assert.equal(privateHealth.status,200);results.privateServeRetained=true;
  const logout=await request('/api/network/logout',{method:'POST',headers:{cookie}});assert.equal(logout.status,200);results.logout=true;
  results.ok=true;results.transport='Loopback HTTP with simulated trusted HTTPS proxy headers; real TLS not tested';
  await writeFile('artifacts/public-network-built-verification.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally { child.kill(); }
