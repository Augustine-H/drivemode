import { parseBackends, routeTts } from './google-tts-routing.server';
import { nasAccess } from './nas-access';
// Loaded only by API handlers. Google credentials stay in the dedicated backend.
export async function googleTtsProxy(request: Request, path: string) {
  const dev = import.meta.env.DEV;
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const nas = nasAccess(request.headers);
  if (nas.enabled && !nas.allowed) return Response.json({ error: 'NAS 계정의 Tailscale 연결을 확인하세요.' }, { status: 403 });
  if (origin && origin !== (nas.enabled ? nas.origin : url.origin)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const access = process.env.GOOGLE_TTS_ACCESS_TOKEN;
  if (nas.allowed) {
    // Serve has authenticated the configured owner; backend tokens remain server-only.
  } else if (access) {
    const { timingSafeEqual } = await import('node:crypto');
    const received = Buffer.from((request.headers.get('authorization') || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(access);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return Response.json({ error: 'TTS 접근 코드를 확인하세요.' }, { status: 401 });
  } else if (!dev || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
    return Response.json({ error: 'TTS 접근 인증을 설정하세요.' }, { status: 503 });
  }
  if (process.env.GOOGLE_TTS_BACKENDS) {
    try { return await routeTts(parseBackends(process.env.GOOGLE_TTS_BACKENDS), request, path); }
    catch { return Response.json({ error: 'TTS 서버 전환 설정 또는 요청을 확인하세요.' }, { status: 503 }); }
  }
  let token = process.env.GOOGLE_TTS_BACKEND_TOKEN;
  if (!token && dev) {
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      token = (await readFile(join(process.env.GOOGLE_TTS_DATA_DIR || join(process.env.LOCALAPPDATA || homedir(), 'VoiceGrok', 'Tts'), 'backend-token'), 'utf8')).trim();
    } catch { /* service has not started */ }
  }
  if (!token) return Response.json({ error: 'Google TTS 백엔드 연결을 확인하세요.' }, { status: 503 });
  try {
    const endpoint = new URL(process.env.GOOGLE_TTS_BACKEND_URL || (dev ? 'http://127.0.0.1:8092' : ''));
    if (endpoint.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)) throw new Error('HTTPS_REQUIRED');
    return await routeTts([{ id: 'pc', url: endpoint.origin, token }], request, path);
  } catch { return Response.json({ error: 'Google TTS 백엔드에 연결하지 못했습니다.' }, { status: 503 }); }
}
