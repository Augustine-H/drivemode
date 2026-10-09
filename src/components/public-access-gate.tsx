import { useEffect, useRef, useState, type ReactNode } from 'react';
import { publicSessionRefreshOutcome, setPublicSession } from '@/lib/network';
export function PublicAccessGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false), [required, setRequired] = useState(false), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let live = true;
    let checking = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (checking) return;
      checking = true;
      const started = generation.current;
      try {
        const response = await fetch('/api/network/status', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('status');
        const state = await response.json();
        if (typeof state.public !== 'boolean' || typeof state.authenticated !== 'boolean') throw new Error('status');
        const allowed = !state.public || state.authenticated || await publicSessionRefreshOutcome();
        if (allowed === null) throw new Error('connection');
        if (live && started === generation.current) { clearTimeout(retry); setConnectionError(''); setPublicSession(state.public); setRequired(!allowed); setReady(true); }
      } catch {
        if (live && started === generation.current) {
          setConnectionError('서버에 다시 연결하는 중입니다. 기기 등록 정보는 유지됩니다.');
          clearTimeout(retry); retry = setTimeout(() => void check(), 5000);
        }
      } finally { checking = false; }
    };
    void check(); const timer = window.setInterval(() => void check(), 10 * 60000);
    const resume = () => { if (!document.hidden) void check(); }; document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => { live = false; clearTimeout(retry); clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
  }, []);
  async function pair() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/network/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(response.status === 429 ? '시도가 많습니다. 15분 후 다시 시도하세요.' : '등록 코드를 확인하세요. 서버의 공개 연결 설정이 필요할 수도 있습니다.');
      generation.current++; setPublicSession(true); setCode(''); setConnectionError(''); setRequired(false);
    } catch (e) { setError(e instanceof Error ? e.message : '기기를 등록하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  if (!ready) return <main className="p-6 text-fg" role="status">{connectionError || '서버 연결 확인 중…'}</main>;
  if (!required) return <>{connectionError && <p role="status" className="border-b border-line p-3 text-fg">{connectionError}</p>}{children}</>;
  return <main className="mx-auto max-w-md space-y-4 p-6 text-fg"><h1 className="text-2xl font-semibold">Voice Grok 기기 등록</h1><p className="text-muted">이 서버를 사용할 기기를 등록하세요. 등록 코드는 서버 소유자가 보관하며 브라우저에 저장하지 않습니다.</p><form className="space-y-4" onSubmit={e => { e.preventDefault(); void pair(); }}><label className="block space-y-2">기기 등록 코드<input aria-label="기기 등록 코드" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} className="min-h-11 w-full rounded-xl border border-line bg-surface px-3" /></label><button disabled={busy || !code} className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-40">{busy ? '등록 중…' : '이 기기 등록'}</button></form>{error && <p role="alert">{error}</p>}</main>;
}
