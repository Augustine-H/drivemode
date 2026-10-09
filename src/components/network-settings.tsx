import { useEffect, useState } from 'react';
import { NETWORK_EVENT, networkConfig, networkSnapshot, saveNetworkConfig, probeEndpoint, networkBase, invalidateNetwork, type NetworkConfig, type NetworkStatus } from '@/lib/network';
const control = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-fg';
const names = { auto: '자동', https: 'HTTPS', lan: 'LAN', tailscale: 'Tailscale' };
export function NetworkSettings() {
  const [config, setConfig] = useState<NetworkConfig>({ mode: 'auto', https: '', lan: '', tailscale: '' });
  const [status, setStatus] = useState<NetworkStatus>({}), [notice, setNotice] = useState(''), [report, setReport] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { setConfig(networkConfig()); setStatus(networkSnapshot()); const update = () => setStatus(networkSnapshot()); window.addEventListener(NETWORK_EVENT, update); return () => window.removeEventListener(NETWORK_EVENT, update); }, []);
  async function save() {
    setBusy(true); setNotice('');
    try { saveNetworkConfig(config); invalidateNetwork(); await networkBase(); setNotice('연결 설정을 저장했습니다. 기존 대화와 작업은 유지됩니다.'); }
    catch (e) { setNotice(e instanceof Error ? e.message : '연결 실패'); }
    finally { setBusy(false); }
  }
  async function diagnose() {
    setBusy(true); const lines = [`Voice Grok 연결 진단 · ${new Date().toISOString()}`, `선택 모드: ${names[config.mode]}`];
    for (const mode of ['https','lan','tailscale'] as const) {
      const endpoint = config[mode]; if (!endpoint) { lines.push(`${names[mode]}: 미설정`); continue; }
      try {
        const { validateEndpoint } = await import('@/lib/network'); const base = validateEndpoint(endpoint, mode);
        const ms = await probeEndpoint(base); lines.push(`${names[mode]}: ${new URL(base).host} · health 정상 · ${ms} ms · ${base.startsWith('https:') ? '브라우저 TLS 검증 통과' : '사설 HTTP'}`);
      } catch { lines.push(`${names[mode]}: 연결 실패 (DNS·TLS·인증·서버 상태 확인 필요)`); }
    }
    lines.push('DNS/TLS 세부 오류는 브라우저에서 구분할 수 없습니다.', 'WebSocket: 현재 구현에서 사용하지 않음', '업로드·다운로드: 실제 파일로 별도 검증 필요', 'TTS: 목소리 · 재생에서 사용자 요청으로 스트리밍 테스트', 'Tailscale VPN 활성 여부: 브라우저에서 조회 불가');
    setReport(lines.join('\n')); setBusy(false);
  }
  return <details className="rounded-2xl border border-line p-3"><summary className="min-h-11 cursor-pointer py-3 font-medium">서버 연결 · HTTPS · 진단</summary><div className="space-y-4 pt-2 text-sm">
    <p className="text-muted">자동 모드는 HTTPS → LAN → Tailscale 순서로 연결합니다. 직접 선택한 모드는 자동 전환하지 않습니다. 공개 서버 주소에서 기기를 먼저 등록하세요.</p>
    <label className="block space-y-2">연결 모드<select aria-label="연결 모드" className={control} value={config.mode} onChange={e => setConfig({ ...config, mode: e.target.value as NetworkConfig['mode'] })}>{Object.entries(names).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    {(['https','lan','tailscale'] as const).map(mode => <label key={mode} className="block space-y-2">{names[mode]} 서버<input aria-label={`${names[mode]} 서버`} type="url" className={control} value={config[mode]} onChange={e => setConfig({ ...config, [mode]: e.target.value })} placeholder={mode === 'https' ? 'https://voice.example.com' : mode === 'lan' ? 'https://192.168.1.10' : 'https://nas.tailnet.ts.net:8445'} autoCapitalize="none" spellCheck={false} /></label>)}
    <p className="text-muted">HTTPS 화면에서는 HTTP LAN 접속이 차단됩니다. LAN은 유효한 인증서와 인증을 갖춘 HTTPS 또는 같은 도메인의 로컬 DNS 연결을 사용하세요. VPN은 자동으로 켜지지 않습니다.</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-40">저장 · 연결 확인</button><button type="button" disabled={busy} onClick={() => void diagnose()} className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-40">연결 진단</button></div>
    <dl className="grid grid-cols-2 gap-2"><dt>현재 연결</dt><dd>{status.mode ? names[status.mode] : '현재 앱 서버'}</dd><dt>서버</dt><dd className="break-all">{status.server || '현재 앱 주소'}</dd><dt>TLS</dt><dd>{status.latencyMs === undefined ? '미검증' : (status.mode && config[status.mode] || window.location.origin).startsWith('https:') ? '브라우저 검증 통과' : '사설 HTTP'}</dd><dt>health 응답시간</dt><dd>{status.latencyMs === undefined ? '미측정' : `${status.latencyMs} ms`}</dd><dt>Fallback</dt><dd>{config.mode === 'auto' ? status.fallback ? '사용 중' : '활성화' : '비활성'}</dd><dt>Tailscale VPN</dt><dd>기기에서 확인</dd></dl>
    {status.fallback && <p role="status">외부 HTTPS를 사용할 수 없어 {status.mode === 'lan' ? '로컬 네트워크' : 'Tailscale'}로 연결되었습니다.</p>}{status.error && <p role="alert">{status.error}</p>}{notice && <p role="status">{notice}</p>}
    {report && <><pre className="whitespace-pre-wrap break-all rounded-xl border border-line p-3 text-xs">{report}</pre><button type="button" className="min-h-11 rounded-xl border border-line px-4" onClick={() => { void navigator.clipboard.writeText(report).then(() => setNotice('진단 결과를 복사했습니다.')).catch(() => setNotice('복사 권한을 확인하세요.')); }}>진단 결과 복사</button></>}
  </div></details>;
}
