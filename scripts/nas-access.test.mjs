import test from 'node:test';
import assert from 'node:assert/strict';
import { nasAccess, nasRequestOriginAllowed } from '../src/lib/nas-access.ts';
const env = {VOICE_GROK_PRIVATE_NAS:'true',VOICE_GROK_NAS_LOGIN:'owner@example.com',VOICE_GROK_NAS_ORIGIN:'https://nas.example:8445'};
const headers = () => new Headers({'tailscale-user-login':'owner@example.com','x-forwarded-host':'nas.example:8445','x-forwarded-proto':'https'});
test('public app origin is limited to Workspace and the exact TTS endpoint',()=> {
  const app='https://drivemode.grok.me',nas=env.VOICE_GROK_NAS_ORIGIN;
  assert.equal(nasRequestOriginAllowed(app,`${nas}/api/google-workspace/status`,nas),true);
  assert.equal(nasRequestOriginAllowed(app,`${nas}/api/google-workspace/chat?x=1`,nas),true);
  assert.equal(nasRequestOriginAllowed(app,nas+'/api/google-tts',nas),true);
  for(const path of ['/','/api/google-tts-evil','/api/google-tts/other','/api/google-workspace-evil/status'])assert.equal(nasRequestOriginAllowed(app,nas+path,nas),false);
  assert.equal(nasRequestOriginAllowed('https://evil.example',`${nas}/api/google-workspace/status`,nas),false);
  assert.equal(nasRequestOriginAllowed(app,'invalid',nas),false);
  assert.equal(nasRequestOriginAllowed(nas,nas+'/',nas),true);
});
test('NAS identity gate is opt-in and accepts only configured Serve identity and HTTPS origin', () => {
  assert.equal(nasAccess(headers(),{}).enabled,false);
  assert.equal(nasAccess(headers(),env).allowed,true);
  for(const [key,value] of [['tailscale-user-login','other@example.com'],['x-forwarded-host','other.example'],['x-forwarded-proto','http']]) {
    const h=headers();h.set(key,value);assert.equal(nasAccess(h,env).allowed,false);
  }
  assert.equal(nasAccess(new Headers(),env).allowed,false);
  assert.equal(nasAccess(headers(),{...env,VOICE_GROK_NAS_LOGIN:''}).allowed,false);
  assert.equal(nasAccess(headers(),{...env,VOICE_GROK_NAS_ORIGIN:'http://nas.example:8445'}).allowed,false);
});
