import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.VOICE_GROK_CONFIG_FILE || '/run/config/runtime.json','utf8'));
if (!config.login || !config.origin || !Array.isArray(config.backends) || !config.backends.length) throw new Error('NAS private configuration is incomplete');
process.env.VOICE_GROK_PRIVATE_NAS='true';
process.env.VOICE_GROK_NAS_LOGIN=config.login;
process.env.VOICE_GROK_NAS_ORIGIN=config.origin;
process.env.GOOGLE_TTS_BACKENDS=JSON.stringify(config.backends);
// Optional public entry point. Private Serve identity and backend routes remain intact.
if (config.publicOrigin) {
  const url = new URL(config.publicOrigin);
  if (url.protocol !== 'https:' || url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_PUBLIC_ORIGIN');
  if (!/^[A-Za-z0-9_-]{64,128}$/.test(config.sessionSecret || '') || !/^[a-f0-9]{64}$/.test(config.pairingHash || '') || !/^[A-Za-z0-9_-]{48,128}$/.test(config.musicClientToken || '')) throw new Error('PUBLIC_AUTH_CONFIGURATION_REQUIRED');
  process.env.VOICE_GROK_PUBLIC_ORIGIN = url.origin;
  if (config.lanOrigin) {
    const lan = new URL(config.lanOrigin);
    if (lan.protocol !== 'https:' || lan.pathname !== '/' || lan.username || lan.password || lan.search || lan.hash) throw new Error('INVALID_LAN_ORIGIN');
    process.env.VOICE_GROK_LAN_ORIGIN = lan.origin;
  }
  process.env.VOICE_GROK_SESSION_SECRET = config.sessionSecret;
  process.env.VOICE_GROK_PAIRING_HASH = config.pairingHash;
  process.env.VOICE_GROK_MUSIC_CLIENT_TOKEN = config.musicClientToken;
  process.env.GOOGLE_REDIRECT_URI = url.origin + '/api/google-workspace/callback';
}
// OAuth client credentials are supplied only as server environment variables.
process.env.GOOGLE_WORKSPACE_DATA_DIR='/run/google';
process.env.NAVER_MAIL_DATA_DIR='/run/google/naver';
// This optional credential comes only from the private runtime volume.
if (config.xaiApiKey !== undefined) {
  if (typeof config.xaiApiKey !== 'string' || !config.xaiApiKey.trim() || /\s/.test(config.xaiApiKey)) {
    throw new Error('NAS xAI credential is invalid');
  }
  process.env.XAI_API_KEY=config.xaiApiKey;
}
process.env.NITRO_HOST='127.0.0.1';
process.env.NITRO_PORT=process.env.VOICE_GROK_WEB_PORT || '8097';
await import('./app/server/index.mjs');
