export type Backend = { id: 'cloud' | 'nas' | 'pc'; url: string; token: string; budget?: number };
export function parseBackends(raw: string): Backend[] {
  const rows: Backend[] = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.length || rows.length > 3) throw new Error('INVALID_BACKENDS');
  let previous = -1, total = 0;
  const urls = new Set<string>();
  for (const row of rows) {
    const rank = ['cloud', 'nas', 'pc'].indexOf(row.id), url = new URL(row.url);
    if (rank <= previous || rank < 0 || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('INVALID_BACKENDS');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('HTTPS_REQUIRED');
    if (urls.has(url.origin) || typeof row.token !== 'string' || row.token.length < 48 || !Number.isSafeInteger(row.budget) || row.budget! < 1) throw new Error('INVALID_BACKENDS');
    urls.add(url.origin); previous = rank; total += row.budget!;
  }
  if (total > 1_000_000) throw new Error('TOTAL_BUDGET_EXCEEDED');
  return rows;
}

// Only read-only connection checks may fail over. Submitted mutations are never replayed.
export async function routeTts(backends: Backend[], request: Request, path: string, fetcher: typeof fetch = fetch, timeoutMs = 2000) {
  const attempts: { id: string; state: string }[] = [];
  let selected: Backend | undefined;
  for (const backend of backends) {
    request.signal.throwIfAborted();
    try {
      const health = await fetcher(new URL('/health', backend.url), { headers: { authorization: `Bearer ${backend.token}` }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]) });
      if (!health.ok) { attempts.push({ id: backend.id, state: 'unavailable' }); continue; }
      const status = await health.json();
      if (!status.authentication || !status.api) { attempts.push({ id: backend.id, state: 'api-unavailable' }); continue; }
      if (backend.budget !== undefined && (status.nodeId !== backend.id || status.config?.threshold !== backend.budget || status.config?.allowOverage !== false || status.config?.cluster !== true)) {
        attempts.push({ id: backend.id, state: 'budget-mismatch' }); continue;
      }
      selected = backend; attempts.push({ id: backend.id, state: 'connected' }); break;
    } catch { request.signal.throwIfAborted(); attempts.push({ id: backend.id, state: 'unavailable' }); }
  }
  if (!selected) return Response.json({ error: '클라우드, NAS, PC TTS 백엔드에 연결하지 못했습니다.', routing: { attempts } }, { status: 503 });
  const body = request.method === 'POST' ? await request.text() : undefined;
  if (selected.budget !== undefined && path === '/settings' && body && JSON.parse(body).allowOverage === true) return Response.json({ error: '자동 서버 전환에서는 합산 한도 보호를 위해 초과 사용을 허용하지 않습니다.' }, { status: 409 });
  let upstream: Response;
  try {
    upstream = await fetcher(new URL(path, selected.url), { method: request.method, headers: { authorization: `Bearer ${selected.token}`, 'content-type': 'application/json' }, body, signal: request.signal });
  } catch {
    request.signal.throwIfAborted();
    return Response.json({ error: '선택한 TTS 서버와 연결이 끊겼습니다. 중복 생성을 막기 위해 이 요청은 재전송하지 않습니다.' }, { status: 503 });
  }
  const routing = { activeBackend: selected.id, priority: backends.map(row => row.id), attempts, usageScope: selected.budget === undefined ? 'single' : 'allocated', totalBudget: backends.reduce((sum, row) => sum + (row.budget || 0), 0) };
  const headers = { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store', 'x-accel-buffering': 'no', 'x-voice-grok-backend': selected.id };
  if (upstream.ok && path !== '/synthesize') return Response.json({ ...await upstream.json(), routing }, { status: upstream.status, headers });
  if (upstream.ok && path === '/synthesize' && upstream.body) {
    const decoder = new TextDecoder(), encoder = new TextEncoder(); let pending = '';
    const send = (row: string, controller: TransformStreamDefaultController<Uint8Array>) => {
      if (!row.trim()) return;
      const frame = JSON.parse(row); if (frame.status) frame.status.routing = routing;
      if (frame.type === 'meta') frame.routing = routing;
      controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n'));
    };
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { pending += decoder.decode(chunk, { stream: true }); const rows = pending.split('\n'); pending = rows.pop() || ''; for (const row of rows) send(row, controller); },
      flush(controller) { send(pending + decoder.decode(), controller); },
    });
    return new Response(upstream.body.pipeThrough(transform), { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
