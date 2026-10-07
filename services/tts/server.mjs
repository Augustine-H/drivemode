// Dedicated persistent backend, not bundled into the web app or an APK.
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { UsageLedger } from './ledger.mjs';
import { pathToFileURL } from 'node:url';

export function createTtsService({ client, ledger, token, defaults, retryDelay = 1000, nodeId = 'pc' }) {
if (!token || token.length < 48 || !Number.isSafeInteger(defaults.threshold) || defaults.threshold < 1) throw new Error('INVALID_TTS_CONFIGURATION');
const config = () => ({ ...defaults, ...ledger.settings(), ...(defaults.cluster ? { allowOverage: false } : {}) });
let voices = [], auth = false, statusError = 'Google Cloud 인증을 확인하세요.';
let lastEngine = '', lastVoice = '', lastPeriod = '', fallbackReason = '';
let refreshJob;
async function refresh() {
  if (refreshJob) return refreshJob;
  refreshJob = (async () => {
    try { const [response] = await client.listVoices({ languageCode: 'ko-KR' }, { timeout: 10000 }); voices = response.voices || []; auth = true; statusError = ''; }
    catch { auth = false; statusError = 'Google Cloud 인증과 Text-to-Speech API 사용 권한을 확인하세요.'; }
    finally { refreshJob = null; }
  })();
  return refreshJob;
}
function fallbackVoice() {
  const available = voices.filter(v => v.name?.startsWith('ko-KR-Wavenet-'));
  const chosen = available.find(v => v.name === config().fallbackVoice) || available.find(v => v.ssmlGender === 'FEMALE') || available[0];
  if (!chosen) throw new Error('사용 가능한 한국어 WaveNet 음성이 없습니다.');
  return chosen.name;
}
function status() {
  const c = config(), usage = ledger.usage();
  return { authentication: auth, api: auth, error: statusError, config: c, usage, voices: voices.filter(v => v.name?.startsWith('ko-KR-Wavenet-')).map(v => ({ id: v.name, gender: v.ssmlGender })), currentEngine: lastPeriod === usage.billingPeriod && lastEngine ? lastEngine : !c.allowOverage && usage.googleChirpCharacters >= c.threshold ? 'wavenet' : 'chirp', currentVoice: lastVoice || c.voice, fallbackReason, fallbackReady: voices.some(v => v.name?.startsWith('ko-KR-Wavenet-')) };
}
function authenticated(req) {
  const received = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 12000) throw new Error('요청이 너무 큽니다.'); }
  return JSON.parse(raw);
}
const retryable = error => [4,8,10,13,14].includes(error?.code);
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('cancelled'));
    const cancel = () => { clearTimeout(timer); reject(new Error('cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
async function synthesize(input, res) {
  const { text, segmentId } = input;
  const speed = Number.isFinite(input.speed) ? Math.max(0.7,Math.min(1.5,input.speed)) : 1;
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 4500 || typeof segmentId !== 'string' || !/^[\w:.-]{1,180}$/.test(segmentId)) throw new Error('올바른 음성 요청이 아닙니다.');
  if (!auth) { await refresh(); if (!auth) throw new Error(statusError); }
  if (!ledger.claim(segmentId)) { res.writeHead(409); res.end('동일 음성 구간을 이미 처리했습니다.'); return; }
  const controller = new AbortController(), signal = controller.signal;
  res.on('close', () => controller.abort());
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const send = value => { if (!signal.aborted) res.write(JSON.stringify(value) + '\n'); };
    const initial = { ...config(), ...(input.format === 'mp3' ? { streaming:false } : {}) };
  let committed = false;
  try {
    const plans = initial.streaming ? [['chirp','stream'],['chirp','stream'],['chirp','stream'],['chirp','stream'],['chirp','standard'],['wavenet','standard']] : [['chirp','standard'],['wavenet','standard']];
    for (let index=0; index<plans.length; index++) {
      if (signal.aborted) return;
      let [engine, mode] = plans[index];
      const c = config(), used = ledger.usage().googleChirpCharacters;
      let reason = engine === 'wavenet' ? 'error' : '';
      // Reserve the entire request before the call, including retries and concurrent requests.
      if (!c.allowOverage && used + [...text].length > c.threshold) { engine = 'wavenet'; mode = 'standard'; reason = 'limit'; }
      const voice = engine === 'chirp' ? c.voice : fallbackVoice();
      const requestId = randomUUID(), started = Date.now();
      let emitted = false, submitted = false;
      try {
        ledger.submit(requestId, segmentId, engine, text, voice, mode); submitted = true;
        send({ type: 'meta', requestId, voice, engine, mode, sampleRate: 24000, fallback: engine === 'wavenet' });
        const audio = (content, encoding) => {
          if (signal.aborted || !content?.length) return;
          if (!emitted) { lastEngine = engine; lastVoice = voice; lastPeriod = ledger.usage().billingPeriod; fallbackReason = reason; ledger.audio(requestId); send({ type: 'latency', ttfaMs: Date.now()-started }); }
          emitted = true; committed = true;
          send({ type: 'audio', encoding, audio: Buffer.from(content).toString('base64') });
        };
        if (mode === 'stream') {
          await new Promise((resolve, reject) => {
            const stream = client.streamingSynthesize({ timeout: 15000, retry: null });
            const cancel = () => { stream.cancel(); reject(new Error('cancelled')); };
            const clean = () => signal.removeEventListener('abort',cancel);
            signal.addEventListener('abort', cancel, { once: true });
            stream.on('data', row => audio(row.audioContent, 'pcm'));
            stream.on('error', error => { clean(); reject(error); }); stream.on('end', () => { clean(); resolve(); });
            stream.on('close', clean);
            stream.write({ streamingConfig: { voice: { languageCode: 'ko-KR', name: voice }, streamingAudioConfig: { audioEncoding: 'PCM', sampleRateHertz: 24000, speakingRate: speed } } });
            stream.end({ input: { text } });
          });
        } else {
          const call = client.synthesizeSpeech({ input: { text }, voice: { languageCode: 'ko-KR', name: voice }, audioConfig: { audioEncoding: input.format === 'mp3' ? 'MP3' : 'LINEAR16', sampleRateHertz: 24000, speakingRate: speed } }, { timeout: 15000, retry: null });
          const cancel = () => call.cancel?.();
          signal.addEventListener('abort', cancel, { once: true });
          let response;
          try { [response] = await call; } finally { signal.removeEventListener('abort', cancel); }
          audio(response.audioContent, input.format === 'mp3' ? 'mp3' : 'wav');
        }
        if (!emitted) throw new Error('음성 데이터가 비어 있습니다.');
        ledger.finish(requestId, 'success');
        send({ type: 'done', status: status(), warnings: ledger.warnings(c.threshold), completedAt: new Date().toISOString() });
        res.end(); return;
      } catch (error) {
        // Unknown network outcomes may have been billed. Keep a conservative estimate.
        if (submitted) ledger.finish(requestId, emitted ? 'partial' : [3,5,7,16].includes(error?.code) && !signal.aborted ? 'failed' : 'uncertain');
        if (signal.aborted) return;
        if (emitted || committed) throw new Error('음성 연결이 중단되었습니다. 이미 읽은 부분은 반복하지 않습니다.');
        if (engine === 'wavenet') throw error;
        if (error?.code === 14) throw new Error('음성 서버 연결을 확인하세요.');
        if (mode === 'stream' && index < 3) {
          if (retryable(error)) await delay(retryDelay * 2 ** index, signal);
          else index = 3;
        }
      }
    }
    throw new Error('음성을 생성하지 못했습니다.');
  } catch (error) { send({ type: 'error', error: error.message, status: status(), warnings: ledger.warnings(config().threshold) }); }
  finally { res.end(); }
}
const server = http.createServer(async (req,res) => {
  if (!authenticated(req)) { res.writeHead(401); res.end(); return; }
  try {
    if (req.url === '/health' && req.method === 'GET') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ ...status(), nodeId })); }
    else if (req.url === '/status' && req.method === 'GET') { await refresh(); res.setHeader('content-type','application/json'); res.end(JSON.stringify(status())); }
    else if (req.url === '/settings' && req.method === 'POST') {
      const next = await body(req), allowed = {};
      if (defaults.cluster && next.allowOverage === true) throw new Error('서버별 합산 한도 보호가 켜져 있습니다.');
      if (typeof next.streaming === 'boolean') allowed.streaming = next.streaming;
      if (typeof next.allowOverage === 'boolean') { if (next.allowOverage && next.confirmOverage !== true) throw new Error('추가 비용 확인이 필요합니다.'); allowed.allowOverage = next.allowOverage; }
      if (typeof next.fallbackVoice === 'string') { if (!voices.some(v => v.name === next.fallbackVoice && v.name.startsWith('ko-KR-Wavenet-'))) throw new Error('사용 가능한 WaveNet 음성을 선택하세요.'); allowed.fallbackVoice = next.fallbackVoice; }
      ledger.configure(allowed); res.setHeader('content-type','application/json'); res.end(JSON.stringify(status()));
    } else if (req.url === '/synthesize' && req.method === 'POST') await synthesize(await body(req), res);
    else { res.writeHead(404); res.end(); }
  } catch (error) { if (!res.headersSent) { res.writeHead(400, { 'content-type':'application/json' }); res.end(JSON.stringify({error:error.message})); } else res.end(); }
});
server.requestTimeout = 30000;
return { server, refresh, status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.env.GOOGLE_TTS_DATA_DIR || join(process.env.LOCALAPPDATA || homedir(), 'VoiceGrok', 'Tts');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tokenPath = join(directory, 'backend-token');
  if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(48).toString('base64url'), { mode: 0o600 });
  const token = process.env.GOOGLE_TTS_BACKEND_TOKEN || readFileSync(tokenPath, 'utf8').trim();
  const ledger = new UsageLedger(join(directory, 'usage.sqlite'));
  const client = new TextToSpeechClient();
  const defaults = { voice: process.env.GOOGLE_TTS_VOICE || 'ko-KR-Chirp3-HD-Leda', threshold: Number(process.env.GOOGLE_TTS_MONTHLY_THRESHOLD || 1_000_000), fallbackVoice: '', allowOverage: false, streaming: true, cluster: process.env.GOOGLE_TTS_CLUSTER_MODE === 'true' };
  const { server, refresh } = createTtsService({ client, ledger, token, defaults, nodeId: process.env.GOOGLE_TTS_NODE_ID || 'pc' });
  server.listen(Number(process.env.GOOGLE_TTS_PORT || 8092), process.env.GOOGLE_TTS_HOST || '127.0.0.1', () => { console.log('Voice Grok Google TTS backend ready'); void refresh(); });
  process.on('SIGTERM', () => server.close(() => { ledger.close(); process.exit(0); }));
}
