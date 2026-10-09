export type ConnectionMode = 'auto' | 'https' | 'lan' | 'tailscale';
export type NetworkConfig = { mode: ConnectionMode; https: string; lan: string; tailscale: string };
export type NetworkStatus = { mode?: Exclude<ConnectionMode, 'auto'>; server?: string; latencyMs?: number; fallback?: boolean; error?: string };
const KEY = 'voice-grok-network-v1';
export const NETWORK_EVENT = 'voice-grok-network-status';
let active: { base: string; until: number; status: NetworkStatus } | undefined;
let checking: Promise<string> | undefined;
const renewals = new Map<string, Promise<boolean | null>>();
let revision = 0;
let publicSession = false;
let status: NetworkStatus = {};
export function setPublicSession(value: boolean) { publicSession = value; }
export function networkConfig(): NetworkConfig {
  const defaults: NetworkConfig = { mode: 'auto', https: import.meta.env?.VITE_VOICE_GROK_API_BASE_URL || '', lan: '', tailscale: '' };
  try { const value = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; if (!['auto','https','lan','tailscale'].includes(value.mode) || ['https','lan','tailscale'].some(key => typeof value[key] !== 'string')) return defaults; return value; } catch { return defaults; }
}
export function validateEndpoint(raw: string, mode: Exclude<ConnectionMode, 'auto'>) {
  if (!raw.trim()) return '';
  const url = new URL(raw.trim());
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('서버 주소에 경로·인증정보를 넣지 마세요.');
  if (mode === 'https' && (url.protocol !== 'https:' || url.port)) throw new Error('외부 서버는 기본 HTTPS 주소를 사용하세요.');
  const local = /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
  const tail = url.hostname.endsWith('.ts.net') || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(url.hostname);
  if (mode === 'lan' && !local && url.protocol !== 'https:') throw new Error('LAN에는 사설 주소 또는 인증된 HTTPS 주소를 사용하세요.');
  if (mode === 'tailscale' && !tail) throw new Error('Tailscale에는 기존 tailnet 주소를 사용하세요.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || tail))) throw new Error('안전한 서버 주소가 아닙니다.');
  return url.origin;
}
export function saveNetworkConfig(value: NetworkConfig) {
  if (!['auto','https','lan','tailscale'].includes(value.mode)) throw new Error('연결 모드를 확인하세요.');
  const next = { mode: value.mode, https: validateEndpoint(value.https, 'https'), lan: validateEndpoint(value.lan, 'lan'), tailscale: validateEndpoint(value.tailscale, 'tailscale') };
  if (next.mode !== 'auto' && !next[next.mode]) throw new Error('선택한 모드의 서버 주소를 입력하세요.');
  localStorage.setItem(KEY, JSON.stringify(next)); invalidateNetwork();
}
export function networkConfigured() { const c = networkConfig(); return publicSession || !!(c.https || c.lan || c.tailscale); }
export function networkSnapshot() { return status; }
function publish(value: NetworkStatus) { status = value; if (typeof window !== 'undefined') window.dispatchEvent(new Event(NETWORK_EVENT)); }
export function invalidateNetwork() { active = undefined; checking = undefined; revision++; }
export async function publicSessionRefreshOutcome(base = '') {
  if (!renewals.has(base)) renewals.set(base, fetch(base + '/api/network/refresh', { method: 'POST', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(10000) }).then(r => r.ok ? true : r.status === 401 ? false : null).catch(() => null).finally(() => { renewals.delete(base); }));
  return renewals.get(base)!;
}
export async function refreshPublicSession(base = '') { return (await publicSessionRefreshOutcome(base)) === true; }
export async function probeEndpoint(base: string, timeout = 1500) {
  if (window.location.protocol === 'https:' && base.startsWith('http:')) throw new Error('HTTPS 앱에서는 HTTP LAN 연결이 차단됩니다. 신뢰 가능한 LAN HTTPS를 사용하세요.');
  const start = performance.now();
  let response = await fetch(base + '/health', { credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout) });
  if (response.status === 401 && await refreshPublicSession(base)) response = await fetch(base + '/health', { credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout) });
  if (response.status === 401 || response.status === 403) throw new Error('서버 인증이 필요합니다. 해당 서버 주소에서 기기 등록 또는 Tailscale 계정을 확인하세요.');
  if (!response.ok || (await response.json()).status !== 'ok') throw new Error('서버 상태 확인 실패');
  return Math.round(performance.now() - start);
}
async function choose() {
  const startedRevision = revision;
  const c = networkConfig();
  if (!c.https && !c.lan && !c.tailscale) {
    if (publicSession) {
      const latencyMs = await probeEndpoint(window.location.origin);
      if (revision !== startedRevision) throw new Error('연결 설정이 변경되었습니다. 다시 연결하세요.');
      const value: NetworkStatus = { mode: 'https', server: window.location.host || new URL(window.location.origin).host, latencyMs, fallback: false };
      active = { base: '', until: Date.now() + 300000, status: value }; publish(value);
    }
    return '';
  }
  const modes: Exclude<ConnectionMode, 'auto'>[] = c.mode === 'auto' ? ['https','lan','tailscale'] : [c.mode];
  let reason = '';
  for (const mode of modes) {
    if (!c[mode]) continue;
    try {
      const base = validateEndpoint(c[mode], mode);
      const latencyMs = await probeEndpoint(base);
      if (revision !== startedRevision) throw new Error('연결 설정이 변경되었습니다. 다시 연결하세요.');
      const value = { mode, server: new URL(base).host, latencyMs, fallback: c.mode === 'auto' && mode !== 'https' };
      active = { base, until: Date.now() + (value.fallback ? 15000 : 300000), status: value }; publish(value); return base;
    } catch (e) { if (revision !== startedRevision) throw e; reason = e instanceof Error ? e.message : '연결 실패'; }
  }
  publish({ error: reason || '사용할 서버 주소가 없습니다.' });
  throw new Error(`Voice Grok 서버에 연결할 수 없습니다. ${reason}`);
}
export async function networkBase() {
  if (active && active.until > Date.now()) return active.base;
  if (!checking) { const job = choose().finally(() => { if (checking === job) checking = undefined; }); checking = job; } return checking;
}
// No submitted POST is replayed after transport failure: paid jobs and TTS stay single-shot.
export async function networkFetch(path: string, init: RequestInit = {}) {
  const base = networkConfigured() ? await networkBase() : '';
  try {
    const response = await fetch(base + path, { ...init, credentials: 'include', redirect: 'error' });
    if (response.status === 401 && await refreshPublicSession(base)) return fetch(base + path, { ...init, credentials: 'include', redirect: 'error' });
    return response;
  } catch (e) { invalidateNetwork(); if (init.signal?.aborted) throw e; publish({ ...status, error: '연결이 끊겼습니다. 진행 중 요청은 재전송하지 않았습니다.' }); throw new Error('서버 연결이 끊겼습니다. 인터넷 및 서버 상태를 확인하세요. 기존 대화와 작업은 유지됩니다.'); }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', invalidateNetwork);
  window.addEventListener('offline', () => { invalidateNetwork(); publish({ error: '인터넷 연결이 끊겼습니다.' }); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidateNetwork(); });
}
