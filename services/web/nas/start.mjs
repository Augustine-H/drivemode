import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.VOICE_GROK_CONFIG_FILE || '/run/config/runtime.json','utf8'));
if (!config.login || !config.origin || !Array.isArray(config.backends) || !config.backends.length) throw new Error('NAS private configuration is incomplete');
process.env.VOICE_GROK_PRIVATE_NAS='true';
process.env.VOICE_GROK_NAS_LOGIN=config.login;
process.env.VOICE_GROK_NAS_ORIGIN=config.origin;
process.env.GOOGLE_TTS_BACKENDS=JSON.stringify(config.backends);
if (config.googleOAuth) {
  if (typeof config.googleOAuth.clientId !== 'string' || typeof config.googleOAuth.clientSecret !== 'string') throw new Error('NAS Google OAuth configuration is invalid');
  process.env.GOOGLE_WORKSPACE_CLIENT_ID=config.googleOAuth.clientId;
  process.env.GOOGLE_WORKSPACE_CLIENT_SECRET=config.googleOAuth.clientSecret;
}
process.env.GOOGLE_WORKSPACE_DATA_DIR='/run/google';
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
