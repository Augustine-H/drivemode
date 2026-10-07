import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageLedger } from '../services/tts/ledger.mjs';
import { createTtsService } from '../services/tts/server.mjs';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ttsUnits } from '../src/lib/tts-chunking.ts';
import { voiceResponse } from '../src/lib/voice-formatter.ts';
import { speechParts } from '../src/lib/stream-speech.ts';
import { SpeechOnsetDetector } from '../src/lib/speech-onset.ts';

test('monthly boundaries, one-time warnings, reservation and independent WaveNet usage', () => {
  const ledger = new UsageLedger(':memory:');
  const reserve = (n, engine='chirp') => ledger.submit(crypto.randomUUID(),crypto.randomUUID(),engine,'가'.repeat(n),'verified-voice','stream');
  assert.equal(ledger.usage().googleChirpCharacters,0);
  reserve(799999); assert.deepEqual(ledger.warnings(1000000),[]);
  reserve(1); assert.deepEqual(ledger.warnings(1000000),[80]); assert.deepEqual(ledger.warnings(1000000),[]);
  reserve(99999); assert.deepEqual(ledger.warnings(1000000),[]);
  reserve(1); assert.deepEqual(ledger.warnings(1000000),[90]);
  reserve(99999); assert.deepEqual(ledger.warnings(1000000),[]);
  reserve(1); assert.deepEqual(ledger.warnings(1000000),[100]);
  reserve(2,'wavenet'); assert.equal(ledger.usage().googleWaveNetCharacters,2);
  assert.equal(ledger.usage().googleChirpCharacters,1000000); ledger.close();
});
test('barge-in requires sustained speech and does not repeatedly interrupt one utterance', () => {
  const onset = new SpeechOnsetDetector();
  assert.equal(onset.update(0.05,0),false); assert.equal(onset.update(0,100),false);
  assert.equal(onset.update(0.05,200),false); assert.equal(onset.update(0.05,300),false);
  assert.equal(onset.update(0.05,400),true); assert.equal(onset.update(0.05,500),false);
});
test('natural buffering publishes long and Korean phrases early with stable indices', () => {
  assert.deepEqual(ttsUnits('네.'),[]);
  assert.deepEqual(ttsUnits('첫 문장을 설명합니다 다음 문장'),['첫 문장을 설명합니다']);
  assert.deepEqual(ttsUnits('첫 구문은 충분히 길고, 다음 구문'),['첫 구문은 충분히 길고,']);
  const long = '길게 이어지는 한국어 문장 '.repeat(25);
  const first = ttsUnits(long.slice(0,190));
  assert.ok(first.length > 0); assert.deepEqual(ttsUnits(long).slice(0,first.length),first);
  assert.equal(ttsUnits('속도는 1.2배입니다.',true).join(' '),'속도는 1.2배입니다.');
});
test('LLM token growth never rewrites already published long speech segments', () => {
  for (const text of ['안녕하세요. '+ '아'.repeat(800) + '. 마지막 문장입니다.', '첫 구문은 충분히 길고, 이어서 설명합니다 다음 내용을 길게 설명하는 한국어 문장 '.repeat(8)]) {
    let emitted = [];
    for (let i=1;i<=text.length;i++) {
      const current = speechParts(voiceResponse(text.slice(0,i),false),true);
      assert.deepEqual(current.slice(0,emitted.length),emitted);
      emitted = current;
    }
    assert.deepEqual(speechParts(voiceResponse(text,true),true).slice(0,emitted.length),emitted);
    assert.ok(emitted.length > 0);
  }
});
test('durable usage and warning state survive process restart', () => {
  const directory = mkdtempSync(join(tmpdir(),'voice-grok-tts-'));
  try {
    const path = join(directory,'usage.sqlite');
    let ledger = new UsageLedger(path);
    ledger.submit('1','segment','chirp','가'.repeat(80),'Leda','stream'); ledger.finish('1','success');
    assert.deepEqual(ledger.warnings(100),[80]); ledger.configure({ allowOverage:false }); ledger.close();
    ledger = new UsageLedger(path); assert.equal(ledger.usage().googleChirpCharacters,80); assert.deepEqual(ledger.warnings(100),[]); assert.equal(ledger.claim('segment'),true); assert.equal(ledger.claim('segment'),false); ledger.close();
  } finally { rmSync(directory,{ recursive:true }); }
});

async function fixture(t, { streamError=false, standardError=false, slow=false, threshold=1000 } = {}) {
  const ledger = new UsageLedger(':memory:'); const calls = [], token = 'x'.repeat(64);
  const client = {
    listVoices: async () => [{ voices:[{name:'ko-KR-Wavenet-TEST',ssmlGender:'FEMALE'}] }],
    streamingSynthesize() {
      calls.push('stream'); const stream = new EventEmitter(); stream.write = () => {};
      stream.cancel = () => { calls.push('cancel'); stream.emit('error',Object.assign(new Error('cancelled'),{code:1})); };
      stream.end = () => {
        if (!slow) setImmediate(() => {
          if (streamError) stream.emit('error',Object.assign(new Error('unsupported'),{code:3}));
          else { stream.emit('data',{audioContent:Buffer.alloc(100)}); stream.emit('end'); }
        });
      }; return stream;
    },
    async synthesizeSpeech(request) {
      calls.push(request.voice.name);
      if (standardError && request.voice.name.includes('Chirp')) throw Object.assign(new Error('unsupported'),{code:3});
      return [{audioContent:Buffer.alloc(100)}];
    },
  };
  const service = createTtsService({ client, ledger, token, defaults:{voice:'ko-KR-Chirp3-HD-Leda',threshold,streaming:true,allowOverage:false,fallbackVoice:''},retryDelay:1 });
  await service.refresh(); await new Promise(resolve => service.server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${service.server.address().port}`;
  const send = (path,data,signal) => fetch(url+path,{method:data?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:data?JSON.stringify(data):undefined,signal});
  t.after(async () => { service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); ledger.close(); });
  return { ledger,calls,send,url };
}
test('Leda streaming, duplicate rejection, authentication and cost confirmation',async t => {
  const f = await fixture(t); const data = { text:'한국어 음성 테스트.',segmentId:'response:segment:0' };
  const result = await (await f.send('/synthesize',data)).text();
  assert.match(result, /"encoding":"pcm"/); assert.match(result, /"type":"done"/);
  assert.equal(f.ledger.usage().googleChirpCharacters,[...data.text].length);
  assert.equal((await f.send('/synthesize',data)).status,409);
  assert.equal((await fetch(f.url+'/status')).status,401);
  assert.equal((await f.send('/settings',{allowOverage:true})).status,400);
  assert.equal((await f.send('/settings',{fallbackVoice:'guessed-voice'})).status,400);
});
test('stream failure → standard Chirp → verified WaveNet, each request logged',async t => {
  const f = await fixture(t,{streamError:true,standardError:true});
  const result = await (await f.send('/synthesize',{text:'안녕.',segmentId:'fallback:0'})).text();
  assert.deepEqual(f.calls,['stream','ko-KR-Chirp3-HD-Leda','ko-KR-Wavenet-TEST']);
  assert.match(result, /"fallback":true/); assert.equal(f.ledger.usage().googleWaveNetCharacters,3);
});
test('threshold reserves text before submission; confirmed overage is optional',async t => {
  const f = await fixture(t,{threshold:10}); f.ledger.submit('before','before','chirp','가'.repeat(10),'Leda','stream'); f.ledger.finish('before','success');
  let result = await (await f.send('/synthesize',{text:'안녕.',segmentId:'limit:0'})).text();
  assert.deepEqual(f.calls,['ko-KR-Wavenet-TEST']); assert.match(result, /"fallback":true/);
  await f.send('/settings',{allowOverage:true,confirmOverage:true});
  result = await (await f.send('/synthesize',{text:'안녕.',segmentId:'limit:1'})).text(); assert.match(result, /"encoding":"pcm"/);
});
test('explicit voice-mail and preview exports produce MP3 without changing live PCM streaming',async t => {
  const f = await fixture(t);
  const result = await (await f.send('/synthesize',{text:'보이스 메일.',segmentId:'export:0',format:'mp3'})).text();
  assert.deepEqual(f.calls,['ko-KR-Chirp3-HD-Leda']); assert.match(result, /"encoding":"mp3"/);
});
test('client disconnect cancels the Google stream without retry or old audio',async t => {
  const f = await fixture(t,{slow:true}); const abort = new AbortController();
  const response = await f.send('/synthesize',{text:'중단 테스트.',segmentId:'cancel:0'},abort.signal);
  const reader = response.body.getReader(); await reader.read(); abort.abort(); await reader.cancel().catch(()=>{});
  for (let i=0;i<30 && !f.calls.includes('cancel');i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(f.calls,['stream','cancel']);
});
test('Unicode, duplicate segments, month rollover and failed vs uncertain request tracking', () => {
  let now = new Date('2026-10-31T14:59:59Z');
  const ledger = new UsageLedger(':memory:', () => now);
  assert.equal(ledger.claim('response:0'),true); assert.equal(ledger.claim('response:0'),false);
  ledger.submit('1','response:0','chirp','한 A😀!','Leda','stream');
  assert.equal(ledger.usage().googleChirpCharacters,5);
  ledger.finish('1','failed'); assert.equal(ledger.usage().googleChirpCharacters,0);
  ledger.submit('2','response:1','chirp','가','Leda','stream'); ledger.finish('2','uncertain');
  assert.equal(ledger.usage().googleChirpCharacters,1);
  now = new Date('2026-10-31T15:00:00Z'); assert.equal(ledger.usage().billingPeriod,'2026-11'); assert.equal(ledger.usage().googleChirpCharacters,0);
  ledger.close();
});
