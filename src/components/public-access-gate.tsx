import { useEffect, useState, type ReactNode } from 'react';
import { refreshPublicSession, setPublicSession } from '@/lib/network';
export function PublicAccessGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false), [required, setRequired] = useState(false), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const response = await fetch('/api/network/status', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error('status');
        const state = await response.json();
        const allowed = !state.public || state.authenticated || await refreshPublicSession();
        if (live) { setPublicSession(!!state.public); setRequired(!allowed); setReady(true); }
      } catch { if (live) { setError('서버 연결 상태를 확인하지 못했습니다. 새로고침해 다시 연결하세요.'); setReady(true); setRequired(true); } }
    };
    void check(); const timer = window.setInterval(() => void check(), 10 * 60000);
    const resume = () => { if (!document.hidden) void check(); }; document.addEventListener('visibilitychange', resume);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, []);
  async function pair() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/network/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(response.status === 429 ? '시도가 많습니다. 15분 후 다시 시도하세요.' : '등록 코드를 확인하세요. 서버의 공개 연결 설정이 필요할 수도 있습니다.');
      setCode(''); setRequired(false);
    } catch (e) { setError(e instanceof Error ? e.message : '기기를 등록하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  if (!ready) return <main className="p-6 text-fg" role="status">서버 연결 확인 중…</main>;
  if (!required) return children;
  return <main className="mx-auto max-w-md space-y-4 p-6 text-fg"><h1 className="text-2xl font-semibold">Voice Grok 기기 등록</h1><p className="text-muted">이 서버를 사용할 기기를 등록하세요. 등록 코드는 서버 소유자가 보관하며 브라우저에 저장하지 않습니다.</p><form className="space-y-4" onSubmit={e => { e.preventDefault(); void pair(); }}><label className="block space-y-2">기기 등록 코드<input aria-label="기기 등록 코드" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} className="min-h-11 w-full rounded-xl border border-line bg-surface px-3" /></label><button disabled={busy || !code} className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-40">{busy ? '등록 중…' : '이 기기 등록'}</button></form>{error && <p role="alert">{error}</p>}</main>;
}
