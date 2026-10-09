import { nasAccess } from './nas-access.ts';
import { clientOriginAllowed } from './public-access.server.ts';
export async function musicProxy(request: Request, fetcher: typeof fetch = fetch) {
  const access = nasAccess(request.headers);
  if (!access.allowed) return Response.json({ error: 'DEVICE_AUTH_REQUIRED' }, { status: 401 });
  const origin = request.headers.get('origin');
  if ((origin && origin !== access.origin && !clientOriginAllowed(origin)) || (request.method === 'POST' && !origin)) return Response.json({ error: 'ORIGIN_NOT_ALLOWED' }, { status: 403 });
  const source = new URL(request.url), path = source.pathname.slice('/api/music'.length);
  const read = path === '/health' || /^\/v1\/jobs(?:\/[a-f0-9-]{36}(?:\/audio\/(?:wav|mp3))?)?$/.test(path);
  const write = path === '/v1/jobs' || /^\/v1\/jobs\/[a-f0-9-]{36}\/cancel$/.test(path);
  if (!((read && ['GET','HEAD'].includes(request.method)) || (write && request.method === 'POST'))) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  const token = process.env.VOICE_GROK_MUSIC_CLIENT_TOKEN || '';
  if (!/^[A-Za-z0-9_-]{48,128}$/.test(token)) return Response.json({ error: 'MUSIC_NOT_CONFIGURED' }, { status: 503 });
  // Fixed local target: public callers cannot select an upstream or reach worker/admin APIs.
  const target = new URL('http://127.0.0.1:8094' + path);
  for (const name of ['limit','offset']) { const value = source.searchParams.get(name); if (value !== null && /^\d{1,6}$/.test(value)) target.searchParams.set(name, value); }
  const headers = new Headers({ authorization: `Bearer ${token}` });
  for (const name of ['content-type','range','if-range','if-none-match']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  let body: Uint8Array | undefined;
  if (request.method === 'POST') {
    const limit = 25700000;
    if (Number(request.headers.get('content-length')) > limit) return Response.json({ error: 'BODY_TOO_LARGE' }, { status: 413 });
    const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
    if (reader) while (true) { const row = await reader.read(); if (row.done) break; size += row.value.length; if (size > limit) { await reader.cancel(); return Response.json({ error: 'BODY_TOO_LARGE' }, { status: 413 }); } chunks.push(row.value); }
    body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  }
  try {
    const upstream = await fetcher(target, { method: request.method, headers, body: body as BodyInit | undefined, redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]) });
    const output = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
    for (const name of ['content-type','content-length','content-range','accept-ranges','etag','x-audio-sha256']) { const value = upstream.headers.get(name); if (value) output.set(name, value); }
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch { return Response.json({ error: 'MUSIC_UNAVAILABLE' }, { status: 503 }); }
}
