import { nasAccess, nasRequestOriginAllowed } from '../../src/lib/nas-access.ts';
import { publicBoundary } from '../../src/lib/public-boundary.server.ts';
import { publicRequest, clientOriginAllowed } from '../../src/lib/public-access.server.ts';

export default async function nasAccessMiddleware(event: { req: Request }, next: () => unknown) {
  const cors = (response: unknown) => {
    const origin = event.req.headers.get('origin');
    if (response instanceof Response && process.env.VOICE_GROK_PUBLIC_ORIGIN && clientOriginAllowed(origin)) {
      response.headers.set('access-control-allow-origin', origin!); response.headers.set('access-control-allow-credentials', 'true'); response.headers.set('vary', 'Origin');
      response.headers.set('access-control-expose-headers', 'Content-Length,Content-Range,Accept-Ranges,ETag,X-Audio-SHA256,X-Voice-Grok-Backend');
    }
    return response;
  };
  const publicResponse = await publicBoundary(event.req);
  if (publicResponse) return cors(publicResponse);
  if (process.env.VOICE_GROK_PUBLIC_ORIGIN && publicRequest(event.req.headers)) return cors(await next());
  if (new URL(event.req.url).pathname === '/api/network/status' && process.env.VOICE_GROK_PRIVATE_NAS !== 'true') return Response.json({ public: false, authenticated: false });
  const access = nasAccess(event.req.headers);
  if (!access.enabled) return next();
  const origin = event.req.headers.get('origin');
  if (!access.allowed || !(nasRequestOriginAllowed(origin,event.req.url,access.origin) || (process.env.VOICE_GROK_PUBLIC_ORIGIN && clientOriginAllowed(origin)))) {
    return new Response('NAS 계정의 Tailscale 연결을 확인하세요.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (event.req.method === 'OPTIONS' && process.env.VOICE_GROK_PUBLIC_ORIGIN && clientOriginAllowed(origin)) return cors(new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET,HEAD,POST', 'access-control-allow-headers': 'Content-Type,Range,If-Range,If-None-Match,X-TSR-Redirect,X-TSR-Raw-Response,X-TSR-ServerFn' } }));
  if (new URL(event.req.url).pathname === '/health') return cors(Response.json({ status: 'ok', service: 'voice-grok' }, { headers: { 'cache-control': 'no-store' } }));
  if (new URL(event.req.url).pathname === '/api/network/status') return Response.json({ public: false, authenticated: true });
  return cors(await next());
}
