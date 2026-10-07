import { useEffect, useRef, useState } from 'react';
import { GOOGLE_TTS_DEFAULT, GoogleTtsProvider, selectedTts, ttsHeaders, ttsSnapshot, type GoogleTtsStatus, type TtsSelection } from '@/lib/google-tts-client';

export function GoogleTtsSettings() {
  const [provider, setProvider] = useState<TtsSelection>('google');
  const [status, setStatus] = useState<GoogleTtsStatus | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [latency, setLatency] = useState<number | null>(null), [warning, setWarning] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [testing, setTesting] = useState(false);
  const testRef = useRef<{ provider:GoogleTtsProvider; abort:AbortController; context:AudioContext } | null>(null);
  function stopSample() { testRef.current?.abort.abort(); testRef.current?.provider.stop(); void testRef.current?.context.close(); testRef.current = null; setTesting(false); }
  async function sample() {
    if (testing) { stopSample(); return; }
    window.dispatchEvent(new Event('tts-provider-change'));
    const context = new AudioContext(), abort = new AbortController(), provider = new GoogleTtsProvider();
    testRef.current = { context,abort,provider }; setTesting(true); setError('');
    try { await context.resume(); await provider.speak('안녕하세요. 보이스 그록의 레다 음성입니다.',context,abort.signal); }
    catch (err) { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : '음성을 확인하세요.'); }
    finally { if (testRef.current?.abort === abort) stopSample(); }
  }
  async function load(settings?: object) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/google-tts' + (settings ? '?action=settings' : ''), { method: settings ? 'POST':'GET', headers: ttsHeaders(), body: settings ? JSON.stringify(settings):undefined });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setStatus(data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Google 연결을 확인하세요.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    setProvider(selectedTts()); void load();
    const saved = ttsSnapshot();
    if (saved.playbackLatencyMs !== undefined) setLatency(saved.playbackLatencyMs as number);
    const update = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (data.status) setStatus(data.status);
      if (data.routing) setStatus(previous => previous ? { ...previous, routing:data.routing } : previous);
      if (data.playbackLatencyMs !== undefined) setLatency(data.playbackLatencyMs);
      if (data.warnings?.length) setWarning(Math.max(...data.warnings));
      if (data.error) setError(data.error);
    };
    window.addEventListener('google-tts-status', update);
    const cancel = () => stopSample();
    window.addEventListener('tts-provider-change',cancel);
    window.addEventListener('pagehide',cancel);
    return () => { window.removeEventListener('google-tts-status', update); window.removeEventListener('tts-provider-change',cancel); window.removeEventListener('pagehide',cancel); testRef.current?.abort.abort(); testRef.current?.provider.stop(); void testRef.current?.context.close(); };
  }, []);
  const used = status?.usage.googleChirpCharacters ?? 0, threshold = status?.config.threshold ?? 1_000_000;
  const percent = used/threshold*100;
  return <div className="space-y-3 rounded-xl border border-line p-3 text-sm">
    <label className="block space-y-2"><span>TTS Provider</span><select aria-label="TTS Provider" className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-fg" value={provider} onChange={event => {
      const next = event.target.value as TtsSelection; localStorage.setItem('voice-grok-tts-provider', next); setProvider(next); window.dispatchEvent(new Event('tts-provider-change'));
    }}><option value="google">Google Cloud · Leda</option><option value="xai">xAI · 기존 목소리</option></select></label>
    {provider === 'google' && <>
      <p className="font-medium">{status?.config.voice.split('-').at(-1) ?? GOOGLE_TTS_DEFAULT.displayName} — Chirp 3 HD</p>
      <p>연결 서버: {({ cloud:'클라우드', nas:'NAS', pc:'PC' } as Record<string,string>)[status?.routing?.activeBackend ?? ''] ?? '연결 대기'}</p>
      {status?.routing?.usageScope === 'allocated' && <p className="text-muted">{status.routing.priority.map(id => ({ cloud:'클라우드', nas:'NAS', pc:'PC' } as Record<string,string>)[id] ?? id).join(' → ')} 자동 연결 · 아래 사용량은 현재 서버 기준입니다. 설정된 서버의 합산 한도 {status.routing.totalBudget.toLocaleString()}자를 서버별로 나눠 보호합니다.</p>}
      <button type="button" className="min-h-11 rounded-xl border border-line px-3" onClick={() => void sample()} disabled={!status?.authentication}>{testing ? '음성 테스트 중단':'Leda 음성 테스트'}</button>
      <p className="text-muted">현재 TTS: Google {status?.currentEngine === 'wavenet' ? `WaveNet · ${status.fallbackReason === 'error' ? 'Chirp 오류에 따른 대체 음성':'월 기준 사용량에 따른 자동 전환'}`:'Chirp 3 HD'}</p>
      <p>Voice Grok 추정 사용량 · {status?.usage.billingPeriod ?? '연결 대기'}</p>
      <p>{used.toLocaleString()} / {threshold.toLocaleString()}자 · {percent.toFixed(1)}%</p>
      <progress aria-label="Chirp 월 사용량" className="h-2 w-full accent-primary" max={threshold} value={Math.min(used,threshold)} />
      <p className="text-muted">WaveNet: {(status?.usage.googleWaveNetCharacters ?? 0).toLocaleString()}자 · 실제 Google 청구 사용량과 차이가 있을 수 있습니다.</p>
      {warning !== null && <p role="alert">Google Chirp 3 HD 월 사용량이 {warning}%에 도달했습니다.{warning >= 100 ? ' WaveNet으로 자동 전환합니다.':' 한도 도달 시 WaveNet으로 자동 전환됩니다.'}</p>}
      {error && <p role="alert" className="text-muted">{error}</p>}
      <label className="flex min-h-11 items-center justify-between gap-3">스트리밍<input type="checkbox" disabled={busy || !status} checked={status?.config.streaming ?? true} onChange={e => void load({ streaming:e.target.checked })} /></label>
      <p>자동 WaveNet 전환 · 켜짐</p>
      <label className="flex min-h-11 items-center justify-between gap-3">무료 기준 초과 후 Chirp 3 HD 계속 사용<input type="checkbox" disabled={busy || !status || status.routing?.usageScope === 'allocated'} checked={status?.config.allowOverage ?? false} onChange={e => {
        const on = e.target.checked;
        if (on && !window.confirm('무료 기준 사용량을 초과하면 Google Cloud 사용료가 발생할 수 있습니다. 계속하시겠습니까?')) return;
        void load({ allowOverage:on, confirmOverage:on });
      }} /></label>
      <details><summary className="min-h-11 cursor-pointer py-3">고급 설정 · 진단</summary><div className="space-y-3">
        <label className="block">WaveNet 대체 음성<select aria-label="WaveNet 대체 음성" className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-fg" disabled={busy || !status?.voices.length} value={status?.config.fallbackVoice ?? ''} onChange={e => void load({ fallbackVoice:e.target.value })}><option value="">조회된 여성 음성 자동 선택</option>{status?.voices.map(v => <option key={v.id} value={v.id}>{v.id}</option>)}</select></label>
        <p>인증: {status?.authentication ? '정상':'확인 필요'} · API: {status?.api ? '연결됨':'연결 대기'}</p>
        <p className="break-words">Voice ID: {status?.currentVoice || status?.config.voice || GOOGLE_TTS_DEFAULT.voiceId}</p>
        <p>첫 재생 지연: {latency === null ? '측정 대기':`${latency} ms`} · Fallback: {status?.fallbackReady ? '준비됨':'확인 필요'}</p>
        <label className="block">TTS 접근 코드<input type="password" autoComplete="off" aria-label="TTS 접근 코드" className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-fg" value={code} onChange={e => setCode(e.target.value)} /></label>
        <button type="button" className="min-h-11 rounded-xl border border-line px-3" disabled={busy} onClick={() => { if (code) sessionStorage.setItem('voice-grok-tts-access',code); setCode(''); void load(); }}>{busy ? '확인 중…':'연결 확인'}</button>
      </div></details>
    </>}
  </div>;
}
