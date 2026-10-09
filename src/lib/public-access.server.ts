import { createHmac, timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;
export const ACCESS_COOKIE = '__Host-voicegrok-access';
export const REFRESH_COOKIE = '__Host-voicegrok-refresh';
export const DEVICE_COOKIE = '__Host-voicegrok-device';
export const ACCESS_SECONDS = 900;
export const REFRESH_SECONDS = 7 * 86400;
export function publicOrigin(env: Env = process.env) {
  if (!env.VOICE_GROK_PUBLIC_ORIGIN) return '';
  const url = new URL(env.VOICE_GROK_PUBLIC_ORIGIN);
  if (url.protocol !== 'https:' || url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_PUBLIC_ORIGIN');
  return url.origin;
}
export function publicRequest(headers: Headers, env: Env = process.env) {
  return !!publicRequestOrigin(headers, env);
}
export function publicRequestOrigin(headers: Headers, env: Env = process.env) {
  const host = headers.get('x-forwarded-host') || headers.get('host');
  for (const value of [publicOrigin(env), env.VOICE_GROK_LAN_ORIGIN || '']) {
    if (!value) continue;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_LAN_ORIGIN');
    if (url.host === host) return url.origin;
  }
  return '';
}
export function clientOriginAllowed(origin: string | null, env: Env = process.env) {
  return !!origin && [publicOrigin(env), env.VOICE_GROK_LAN_ORIGIN, env.VOICE_GROK_NAS_ORIGIN, 'https://drivemode.grok.me'].includes(origin);
}
export function cookieValue(headers: Headers, name: string) {
  const rows = (headers.get('cookie') || '').split(';').map(row => row.trim()).filter(row => row.startsWith(name + '='));
  return rows.length === 1 ? rows[0].slice(name.length + 1) : '';
}
function secret(env: Env) {
  const value = env.VOICE_GROK_SESSION_SECRET || '';
  if (!/^[A-Za-z0-9_-]{64,128}$/.test(value)) throw new Error('PUBLIC_SESSION_NOT_CONFIGURED');
  return value;
}
export function sameSecret(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function sessionToken(device: string, kind: 'access' | 'refresh', env: Env = process.env, now = Date.now(), origin = publicOrigin(env)) {
  if (!/^[a-f0-9-]{36}$/.test(device)) throw new Error('INVALID_DEVICE');
  if (!origin) throw new Error('PUBLIC_ORIGIN_REQUIRED');
  const body = Buffer.from(JSON.stringify({ device, kind, origin, expires: Math.floor(now / 1000) + (kind === 'access' ? ACCESS_SECONDS : REFRESH_SECONDS) })).toString('base64url');
  return body + '.' + createHmac('sha256', secret(env)).update(body).digest('base64url');
}
export function sessionDevice(headers: Headers, kind: 'access' | 'refresh', env: Env = process.env, now = Date.now()) {
  try {
    if (!publicRequest(headers, env) || headers.get('x-forwarded-proto') !== 'https') return '';
    const token = cookieValue(headers, kind === 'access' ? ACCESS_COOKIE : REFRESH_COOKIE);
    if (token.length > 1024) return '';
    const parts = token.split('.');
    if (parts.length !== 2 || !sameSecret(parts[1], createHmac('sha256', secret(env)).update(parts[0]).digest('base64url'))) return '';
    const row = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const device = cookieValue(headers, DEVICE_COOKIE);
    if (!/^[a-f0-9-]{36}$/.test(device) || row.device !== device || row.kind !== kind || row.origin !== publicRequestOrigin(headers, env) || !Number.isSafeInteger(row.expires) || row.expires <= Math.floor(now / 1000)) return '';
    return device;
  } catch { return ''; }
}
export function sessionCookies(device: string, env: Env = process.env, origin = publicOrigin(env)) {
  return [
    [ACCESS_COOKIE, sessionToken(device, 'access', env, Date.now(), origin), ACCESS_SECONDS],
    [REFRESH_COOKIE, sessionToken(device, 'refresh', env, Date.now(), origin), REFRESH_SECONDS],
    [DEVICE_COOKIE, device, REFRESH_SECONDS],
  ].map(([name, value, age]) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${age}`);
}
