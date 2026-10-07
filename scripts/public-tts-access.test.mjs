import test from 'node:test';
import assert from 'node:assert/strict';
import {googleTtsProxy} from '../src/lib/google-tts-proxy.server.ts';
test('public TTS preflight requires the configured Serve owner; unrelated origins and identities fail closed',async()=>{
  const previous={...process.env};
  Object.assign(process.env,{VOICE_GROK_PRIVATE_NAS:'true',VOICE_GROK_NAS_ORIGIN:'https://nas.example:8445',VOICE_GROK_NAS_LOGIN:'owner@example.com'});
  const headers={'origin':'https://drivemode.grok.me','tailscale-user-login':'owner@example.com','x-forwarded-host':'nas.example:8445','x-forwarded-proto':'https'};
  try {
    const request=(changes={})=>new Request('https://nas.example:8445/api/google-tts',{method:'OPTIONS',headers:{...headers,...changes}});
    const allowed=await googleTtsProxy(request(),'/status');
    assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),headers.origin);
    assert.equal(allowed.headers.get('access-control-allow-headers'),'Content-Type');
    for(const change of [{origin:'https://evil.example'},{'tailscale-user-login':'other@example.com'},{'x-forwarded-proto':'http'},{'x-forwarded-host':'evil.example'}])assert.equal((await googleTtsProxy(request(change),'/status')).status,403);
    const denied=await googleTtsProxy(new Request('https://nas.example:8445/api/google-tts',{method:'POST',headers:{...headers,'tailscale-user-login':'other@example.com'}}),'/synthesize');
    assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
  } finally {for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
