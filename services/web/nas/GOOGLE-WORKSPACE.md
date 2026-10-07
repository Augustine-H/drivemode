# Google Calendar, Drive and Gmail (read only)

The NAS app uses its own Google web OAuth client, separate from TTS ADC and Grok platform connectors. Open Settings → Google 일정 · Drive · Gmail. Connect, approve the requested services, run 세 서비스 읽기 점검, then choose a service and search. Calendar supports calendar selection and the next 30 days; Drive supports filename search and plain-text/Google Docs preview; Gmail supports Gmail search syntax, message headers and plain-text bodies. Search results stay in component memory, are not persisted in conversations, and are not sent to xAI. Opening mail does not change unread labels. Write/send/delete APIs are not implemented.

## One-time Google configuration

In the existing Google Cloud project, enable Google Calendar API, Google Drive API and Gmail API. Configure Google Auth Platform with an application name and the owner's support/contact email. For a personal external testing app, add only the owner as a test user. Do not create a VM or publish the app publicly. Create an OAuth client of type Web application with the authorized redirect URI:

`https://ds218-hmh.tail15dbbb.ts.net:8445/api/google-workspace/callback`

Download the client JSON to a private directory. The NAS private runtime supports `googleOAuth.clientId` and `googleOAuth.clientSecret`. `google-oauth-config.mjs` can merge a downloaded web-client JSON into the existing private runtime after validating this exact callback. Never place client JSON, runtime configuration, OAuth tokens or encryption keys in source, browser settings, deployment ZIPs or logs. Recreate config-init and web after changing runtime configuration.

Requested scopes: `calendar.readonly`, `drive.readonly`, `gmail.readonly`. The app uses offline refresh, OAuth state with a ten-minute expiry, and PKCE. Google consent is completed by the account owner; declining preserves any earlier connection. An external app in Testing can receive refresh tokens that expire after seven days; reconnect when Google invalidates authorization. Moving to Production for lasting personal use can involve Google's verification requirements for sensitive/restricted scopes; do not automatically publish or expand access.

## NAS storage and recovery

The `google-data` named volume is initialized with owner UID 1000 and mode 700; the server mount is `/run/google`. Token state is authenticated AES-256-GCM ciphertext; its random encryption key and ciphertext have mode 600. Only the same configured owner's Tailscale identity can invoke these endpoints; mutation endpoints also require the exact app Origin. Default Vercel and local unauthenticated requests fail closed. Encryption does not protect against a root administrator who can read both the key and ciphertext.

Include the entire google-data volume, the private runtime with OAuth client credentials, and the latest deployment package in the existing encrypted recovery workflow. Older recovery scripts/archives do not include this new volume. Never copy only the ciphertext without its key; reauthorizing Google is an alternative after loss. Disconnect revokes the Google refresh token and clears local token state.

Sources: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [Gmail listing](https://developers.google.com/workspace/gmail/api/guides/list-messages), [Drive read permissions](https://developers.google.com/drive/api/guides/api-specific-auth).

## Rollout status (2026-10-07)

Version 1.31.0 is deployed on the NAS with image voice-grok-web:1.31.0-google1. Calendar, Drive and Gmail APIs are enabled in the existing Cloud project. The owner-only status endpoint and settings UI were verified live. The OAuth client is not configured yet: Google Cloud branding setup returned a loading error. Account consent and real Google data API success remain unverified. Seven automated security/API tests, typecheck, development and production desktop/mobile rendering checks passed.
