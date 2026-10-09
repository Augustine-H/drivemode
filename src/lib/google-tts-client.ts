import { GOOGLE_APP_ORIGIN, GOOGLE_BACKEND_ORIGIN } from './google-workspace-contract';
import { networkConfigured, networkFetch } from './network.ts';
export function googleTtsEndpoint() {
  return `${!networkConfigured() && typeof window!=='undefined' && window.location.origin===GOOGLE_APP_ORIGIN?GOOGLE_BACKEND_ORIGIN:''}/api/google-tts`;
}
function ttsFetch(init: RequestInit) { return networkConfigured() ? networkFetch('/api/google-tts', init) : fetch(googleTtsEndpoint(), init); }
export type TtsSelection = 'google' | 'xai';
export type GoogleTtsStatus = {
  routing?: { activeBackend: string; priority: string[]; attempts: { id: string; state: string }[]; usageScope: string; totalBudget: number };
  authentication: boolean; api: boolean; error: string;
  config: { voice: string; threshold: number; fallbackVoice: string; allowOverage: boolean; streaming: boolean };
  usage: { billingPeriod: string; googleChirpCharacters: number; googleWaveNetCharacters: number; lastUpdated: string | null };
  voices: { id: string; gender: string }[]; currentEngine: string; currentVoice: string; fallbackReason: string; fallbackReady: boolean;
};
export const GOOGLE_TTS_DEFAULT = { displayName: 'Leda', voiceId: 'ko-KR-Chirp3-HD-Leda', language: 'ko-KR' };
export function selectedTts(): TtsSelection { return typeof window !== 'undefined' && localStorage.getItem('voice-grok-tts-provider') === 'xai' ? 'xai' : 'google'; }
export function ttsHeaders() { const code = networkConfigured() || window.location.origin===GOOGLE_APP_ORIGIN ? null : sessionStorage.getItem('voice-grok-tts-access'); return { 'content-type':'application/json', ...(code ? { authorization: `Bearer ${code}` } : {}) }; }
// Explicit preview / voice-mail exports require an MP3 file, not live PCM playback.
export async function speakSelectedLine(input: { data:{ text:string; voiceId:string; speed:number } }): Promise<SpeakResult> {
  if (selectedTts() === 'xai') return speakXai(input);
  try {
    const response = await ttsFetch({ method:'POST', headers:ttsHeaders(), body:JSON.stringify({ text:input.data.text, speed:input.data.speed, segmentId:crypto.randomUUID(), format:'mp3' }) });
    if (!response.ok) { const data = await response.json(); return {ok:false,error:data.error || 'Google 음성을 생성하지 못했습니다.'}; }
    const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    for (const frame of frames) if (frame.type === 'done' || frame.type === 'error') publishTts(frame);
    const failed = frames.find(frame => frame.type === 'error');
    if (failed) return {ok:false,error:failed.error};
    const audio = frames.find(frame => frame.type === 'audio' && frame.encoding === 'mp3');
    if (!audio || !frames.some(frame => frame.type === 'done')) return {ok:false,error:'Google 음성이 완료되지 않았습니다.'};
    return {ok:true,audio:audio.audio};
  } catch { return {ok:false,error:'Google 음성 서버에 연결하지 못했습니다.'}; }
}
let latestTts: Record<string, unknown> = {};
export function ttsSnapshot() { return latestTts; }
export function publishTts(value: Record<string, unknown>) {
  latestTts = { ...latestTts, ...value };
  window.dispatchEvent(new CustomEvent('google-tts-status', { detail: value }));
  const warnings = value.warnings as number[] | undefined;
  if (warnings?.length) {
    const level = Math.max(...warnings);
    const status = value.status as GoogleTtsStatus | undefined;
    window.alert(`Google Chirp 3 HD 월 사용량이 ${level}%에 도달했습니다.\n${level >= 100 ? status?.config.allowOverage ? 'Chirp 유료 계속 사용 설정이 켜져 있습니다.' : '추가 비용 방지를 위해 WaveNet으로 자동 전환합니다.' : '한도 도달 시 WaveNet으로 자동 전환됩니다.'}`);
  }
}

export interface TtsProvider {
  stream(text: string, segmentId: string, context: AudioContext, signal: AbortSignal, onAudio: () => void, speed?: number): Promise<void>;
  stop(): void;
  cancel(): void;
  getVoices(): Promise<GoogleTtsStatus['voices']>;
  getUsage(): Promise<GoogleTtsStatus['usage']>;
  speak(text:string, context:AudioContext, signal:AbortSignal, onAudio?:() => void, speed?:number): Promise<void>;
}
// Per-playback provider: holds only active buffers. Conversation audio is never persisted.
export class GoogleTtsProvider implements TtsProvider {
  private nodes = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private generation = 0;
  stop() { this.generation++; for (const node of this.nodes) { try { node.stop(); } catch { /* Already stopped audio nodes are safe to disconnect. */ } node.disconnect(); } this.nodes.clear(); this.nextTime = 0; }
  cancel() { this.stop(); }
  async getStatus(): Promise<GoogleTtsStatus> {
    const response = await ttsFetch({ headers: ttsHeaders() });
    if (!response.ok) throw new Error('Google TTS 연결을 확인하세요.');
    return response.json();
  }
  async getVoices() { return (await this.getStatus()).voices; }
  async getUsage() { return (await this.getStatus()).usage; }
  speak(text: string, context: AudioContext, signal: AbortSignal, onAudio = () => {}, speed = 1) { return this.stream(text, crypto.randomUUID(), context, signal, onAudio, speed); }
  async stream(text: string, segmentId: string, context: AudioContext, signal: AbortSignal, onAudio: () => void, speed = 1) {
    const generation = this.generation, started = performance.now();
    const response = await ttsFetch({ method: 'POST', headers: ttsHeaders(), body: JSON.stringify({ text, segmentId, speed }), signal });
    if (!response.ok || !response.body) {
      let error = 'Google 음성을 생성하지 못했습니다.';
      try { error = (await response.json()).error || error; } catch { /* Keep the safe default when an upstream body is not JSON. */ }
      throw new Error(error);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '', tail: number | null = null, heard = false, finished = false, pcmCarry: number | null = null;
    const cancel = () => { this.stop(); void reader.cancel(); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        const row = await reader.read();
        if (signal.aborted || generation !== this.generation) throw new DOMException('Cancelled','AbortError');
        pending += decoder.decode(row.value, { stream: !row.done });
        const lines = pending.split('\n'); pending = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const frame = JSON.parse(line);
          if (frame.type === 'latency' || frame.type === 'meta') publishTts(frame);
          if (frame.type === 'error') { publishTts(frame); throw new Error(frame.error); }
          if (frame.type === 'done') { finished = true; publishTts(frame); }
          if (frame.type !== 'audio') continue;
          const bytes = Uint8Array.from(atob(frame.audio), char => char.charCodeAt(0));
          let buffer: AudioBuffer;
          if (frame.encoding === 'wav') buffer = await context.decodeAudioData(bytes.buffer);
          else {
            const data: Uint8Array = pcmCarry === null ? bytes : Uint8Array.from([pcmCarry, ...bytes]);
            pcmCarry = data.length % 2 ? data[data.length-1] : null;
            if (data.length < 2) continue;
            buffer = context.createBuffer(1, Math.floor(data.length/2), 24000);
            const floats = buffer.getChannelData(0), view = new DataView(data.buffer);
            for (let i=0; i<floats.length; i++) floats[i] = view.getInt16(i*2, true)/32768;
          }
          if (signal.aborted || generation !== this.generation) throw new DOMException('Cancelled','AbortError');
          const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination);
          this.nodes.add(node); node.onended = () => { this.nodes.delete(node); node.disconnect(); };
          this.nextTime = Math.max(context.currentTime + 0.015, this.nextTime);
          node.start(this.nextTime); this.nextTime += buffer.duration; tail = this.nextTime;
          if (!heard) { heard = true; onAudio(); publishTts({ playbackLatencyMs: Math.round(performance.now()-started), playbackStartedAt: new Date().toISOString(), segmentId }); }
        }
        if (row.done) break;
      }
      if (!finished || !heard) throw new Error('Google 음성 스트림이 완료되지 않았습니다.');
      while (tail !== null && context.currentTime < tail) {
        if (signal.aborted || generation !== this.generation) throw new DOMException('Cancelled','AbortError');
        await new Promise(resolve => window.setTimeout(resolve, 25));
      }
    } catch (error) { this.stop(); throw error; }
    finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); }
  }
}
import { speakLine as speakXai, type SpeakResult } from '@/lib/tts';
