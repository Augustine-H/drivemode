import { nasAccess, nasRequestOriginAllowed } from '../../src/lib/nas-access';

export default function nasAccessMiddleware(event: { req: { method: string; headers: Headers; url:string } }, next: () => unknown) {
  const access = nasAccess(event.req.headers);
  if (!access.enabled) return next();
  const origin = event.req.headers.get('origin');
  if (!access.allowed || !nasRequestOriginAllowed(origin,event.req.url,access.origin)) {
    return new Response('NAS 계정의 Tailscale 연결을 확인하세요.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return next();
}
