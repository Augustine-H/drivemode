import { randomUUID, createHash } from 'node:crypto';
import { ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE, publicOrigin, publicRequest, publicRequestOrigin, clientOriginAllowed, cookieValue, sameSecret, sessionCookies, sessionDevice } from './public-access.server.ts';

const attempts = new Map<string, { count: number; until: number }>();
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
export function publicPathAllowed(path: string) {
  return path === '/health' || ['/api/ask', '/api/google-tts', '/api/media-source', '/api/video-source', '/api/google-workspace', '/api/naver-mail'].includes(path)
    || /^\/api\/google-workspace\/(?:callback|connect|status|profile|verify|disconnect|propose|execute|chat|events|calendars|files|file|messages|message)$/.test(path)
    || /^\/api\/music\/(?:health|v1\/jobs(?:\/[a-f0-9-]{36}(?:\/cancel|\/audio\/(?:wav|mp3))?)?)$/.test(path)
    || path.startsWith('/_serverFn/');
}
// Loopback listener only. DSM must replace forwarded headers and strip Serve identity.
export async function publicBoundary(request: Request, env: Record<string, string | undefined> = process.env): Promise<Response | null> {
  if (!publicOrigin(env)) return null;
  const path = new URL(request.url).pathname;
  if (!publicRequest(request.headers, env)) return null;
  const origin = publicRequestOrigin(request.headers, env);
  if (request.headers.get('x-forwarded-proto') !== 'https') return reply({ error: 'HTTPS_REQUIRED' }, 403);
  const incoming = request.headers.get('origin');
  if (incoming && !clientOriginAllowed(incoming, env)) return reply({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (request.method === 'OPTIONS') {
    const allowedHeaders = new Set(['content-type','range','if-range','if-none-match','x-tsr-redirect','x-tsr-raw-response','x-tsr-serverfn']);
    if (!clientOriginAllowed(incoming, env) || !['GET','HEAD','POST'].includes(request.headers.get('access-control-request-method') || '') || (request.headers.get('access-control-request-headers') || '').split(',').some(name => name.trim() && !allowedHeaders.has(name.trim().toLowerCase()))) return reply({ error: 'PREFLIGHT_NOT_ALLOWED' }, 403);
    if (!publicPathAllowed(path) && !['/api/network/status','/api/network/refresh'].includes(path)) return reply({ error: 'NOT_FOUND' }, 404);
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': incoming!, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET,HEAD,POST', 'access-control-allow-headers': [...allowedHeaders].join(','), 'vary': 'Origin' } });
  }
  if (path.startsWith('/api/network/')) {
    if (path === '/api/network/status' && request.method === 'GET') return reply({ public: true, authenticated: !!sessionDevice(request.headers, 'access', env) });
    if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (!clientOriginAllowed(incoming, env)) return reply({ error: 'ORIGIN_REQUIRED' }, 403);
    if (path === '/api/network/pair' && incoming !== origin) return reply({ error: 'PAIR_ON_SERVER_ORIGIN' }, 403);
    if (path === '/api/network/logout') {
      const response = reply({ ok: true });
      for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE]) response.headers.append('set-cookie', `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
      return response;
    }
    if (path === '/api/network/refresh') {
      const device = sessionDevice(request.headers, 'refresh', env);
      if (!device) return reply({ error: 'SESSION_EXPIRED' }, 401);
      const response = reply({ ok: true });
      for (const cookie of sessionCookies(device, env, origin)) response.headers.append('set-cookie', cookie);
      return response;
    }
    if (path !== '/api/network/pair') return reply({ error: 'NOT_FOUND' }, 404);
    const ip = request.headers.get('x-real-ip') || 'unknown';
    const key = createHash('sha256').update(ip).digest('hex');
    const now = Date.now();
    for (const [id, row] of attempts) if (row.until <= now) attempts.delete(id);
    if (attempts.size >= 1024 && !attempts.has(key)) return reply({ error: 'TRY_LATER' }, 429);
    const row = attempts.get(key) || { count: 0, until: now + 15 * 60000 };
    attempts.set(key, row); if (++row.count > 5) return reply({ error: 'TRY_LATER' }, 429);
    const expected = env.VOICE_GROK_PAIRING_HASH || '';
    if (!/^[a-f0-9]{64}$/.test(expected)) return reply({ error: 'PAIRING_NOT_CONFIGURED' }, 503);
    if (Number(request.headers.get('content-length')) > 512) return reply({ error: 'BODY_TOO_LARGE' }, 413);
    let text = ''; const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'INVALID_REQUEST' }, 400);
    while (true) { const step = await reader.read(); if (step.done) break; text += new TextDecoder().decode(step.value); if (text.length > 512) { await reader.cancel(); return reply({ error: 'BODY_TOO_LARGE' }, 413); } }
    let code = ''; try { code = JSON.parse(text).code; } catch { return reply({ error: 'INVALID_REQUEST' }, 400); }
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{48,128}$/.test(code) || !sameSecret(createHash('sha256').update(code).digest('hex'), expected)) return reply({ error: 'PAIRING_FAILED' }, 401);
    const response = reply({ ok: true });
    try { for (const cookie of sessionCookies(randomUUID(), env, origin)) response.headers.append('set-cookie', cookie); }
    catch { return reply({ error: 'SESSION_NOT_CONFIGURED' }, 503); }
    attempts.delete(key); return response;
  }
  const api = path.startsWith('/api/') || path.startsWith('/_server') || path === '/health';
  if (!api) return null;
  if (!publicPathAllowed(path)) return reply({ error: 'NOT_FOUND' }, 404);
  if (!sessionDevice(request.headers, 'access', env)) {
    // OAuth returns through a navigation, so browser-side renewal cannot run first.
    // Renew only this callback, with a valid device-bound refresh and matching OAuth state.
    if (path === '/api/google-workspace/callback' && request.method === 'GET') {
      const url = new URL(request.url), state = url.searchParams.get('state') || '';
      const device = sessionDevice(request.headers, 'refresh', env);
      if (device && /^[A-Za-z0-9_-]{43}$/.test(state) && sameSecret(state, cookieValue(request.headers, '__Host-voicegrok-google-state'))) {
        const response = new Response(null, { status: 303, headers: { location: origin + path + url.search, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
        for (const cookie of sessionCookies(device, env, origin)) response.headers.append('set-cookie', cookie);
        return response;
      }
    }
    return reply({ error: 'DEVICE_AUTH_REQUIRED' }, 401);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD' && !clientOriginAllowed(incoming, env)) return reply({ error: 'ORIGIN_REQUIRED' }, 403);
  if (path === '/health') return reply({ status: 'ok', service: 'voice-grok' });
  return null;
}
