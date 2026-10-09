import { GOOGLE_APP_ORIGIN } from './google-workspace-contract.ts';
import { publicRequestOrigin, publicRequest, sessionDevice } from './public-access.server.ts';
export function nasRequestOriginAllowed(origin:string|null,requestUrl:string,nasOrigin:string) {
  if(!origin || origin===nasOrigin)return true;
  try {
    const path=new URL(requestUrl).pathname;
    return origin===GOOGLE_APP_ORIGIN && (path.startsWith('/api/google-workspace/') || path==='/api/google-tts' || path==='/api/naver-mail');
  } catch { return false; }
}
// Trust these headers only on the loopback listener behind Tailscale Serve.
export function nasAccess(headers: Headers, env: Record<string, string | undefined> = process.env) {
  if (env.VOICE_GROK_PUBLIC_ORIGIN && publicRequest(headers, env)) return { enabled: true, allowed: !!sessionDevice(headers, 'access', env), origin: publicRequestOrigin(headers, env) };
  if (env.VOICE_GROK_PRIVATE_NAS !== 'true') return { enabled: false, allowed: false, origin: '' };
  const origin = env.VOICE_GROK_NAS_ORIGIN || '';
  const login = env.VOICE_GROK_NAS_LOGIN || '';
  let allowed = false;
  try {
    const url = new URL(origin);
    allowed = !!login && url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash
      && headers.get('tailscale-user-login') === login
      && headers.get('x-forwarded-host') === url.host
      && headers.get('x-forwarded-proto') === 'https';
  } catch { /* Fail closed for missing or invalid runtime configuration. */ }
  return { enabled: true, allowed, origin };
}
