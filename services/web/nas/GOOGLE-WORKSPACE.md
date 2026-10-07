# Google Workspace OAuth — VoiceGrok 1.32.0

## Deployment topology

The app at `https://drivemode.grok.me` calls the NAS API at `https://ds218-hmh.tail15dbbb.ts.net:8445`. The NAS is the only OAuth/token/API execution server. The existing configured Tailscale owner is required on every request; this is a single-owner personal deployment, not a multi-tenant public account system. Grok account sign-in at auth.grok.me is separate and untouched.

Only the two exact app origins are accepted by CORS; POST requires one of those Origins. The public app never receives Google tokens. Google connection uses a top-level navigation to NAS so its Secure/HttpOnly/SameSite=Lax state cookie works with the Google callback. Returning to the public app requires publishing this source through its existing Grok deployment process. Old drivemode.grok.me 1.30.0 does not gain these changes from a NAS update.

## Server environment (no credentials in source or deployment packages)

- GOOGLE_CLIENT_ID — web OAuth client ID
- GOOGLE_CLIENT_SECRET — web OAuth client secret
- GOOGLE_REDIRECT_URI — optional, defaults to the exact URI below; any different value fails closed
- GOOGLE_WORKSPACE_DATA_DIR — NAS launcher sets /run/google
- XAI_API_KEY — existing server-only Grok key for user-initiated natural-language interpretation

Exact redirect URI (no trailing slash):

`https://ds218-hmh.tail15dbbb.ts.net:8445/api/google-workspace/callback`

The Docker compose web service injects GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the separately uploaded NAS-private `private/google-oauth.env` file. This file must be explicitly authorized by the owner, created outside the source workspace, excluded from Git/deployment ZIPs and owned by NAS root with mode 600 in the existing private mode-700 directory. The app still reads only process.env. Never put actual values in compose.yaml, source, browser app settings, logs or chat. config-init requires the private credential file before the new web container starts and restricts its permissions. The old runtime googleOAuth object is no longer read. The validator can optionally export the private environment file with --output to an absolute path outside this workspace; without that option it only validates and prints variable names. It never overwrites an existing destination.

Enable Gmail, Calendar and Drive APIs in the VoiceGrok Cloud project. External/Testing test-user consent must be completed by the account owner. Testing refresh tokens can expire after seven days; automatic refresh cannot bypass this Google restriction. Moving to Production and verification is separate manual work, never automatic.

## OAuth and API endpoints

GET /api/google-workspace/connect — offline OAuth, consent, state, PKCE S256, exact callback; returnOrigin is restricted to the configured NAS origin or drivemode.grok.me.
GET /api/google-workspace/callback — verifies server state and browser cookie; exchanges code; stores tokens encrypted; clears code/state from redirect URL.
GET /api/google-workspace/status — configured/connected/email, gmail/calendar/drive, granted service flags and expiry; no tokens.
GET /api/google-workspace/verify — minimal real reads for the three services.
GET profile, messages, message, events, files, file under the same prefix — service reads.
POST /api/google-workspace/propose — validates a mutation and returns a preview with one-time 10-minute confirmation ID.
POST /api/google-workspace/execute — consumes that ID; bound to the current OAuth account generation, cannot replay.
POST /api/google-workspace/chat — one capped Grok function call interprets the explicit request; reads execute, writes only propose.
POST /api/google-workspace/disconnect — revokes where possible, always clears local tokens and pending changes; reports a safe warning if Google revoke fails.
Legacy /api/google-workspace?action=... is retained for read compatibility.

Requested scopes:
- https://www.googleapis.com/auth/drive.file
- https://www.googleapis.com/auth/calendar.events
- https://www.googleapis.com/auth/gmail.modify
- openid
- email

calendar.events does not grant calendarList access: primary is supported by default. drive.file lists only app-authorized files, never all Drive; creation supports UTF-8 text and explicitly selected binary files up to 1 MB, preview supports Google Docs/plain text. Arbitrary existing files need a separate explicit Google Picker flow (not included); the app does not claim general Drive access. Mail read does not mark it read. Mail sends/replies, unread changes, calendar CRUD, Drive text save/update and trash are available after explicit preview confirmation. No Gmail delete endpoint exists.

## Storage and refresh

Google tokens are encrypted with authenticated AES-256-GCM in /run/google/oauth.enc in the google-data named volume. Key /run/google/key; both mode 600, directory mode 700, UID 1000. The key is co-located, so encryption does not protect against a NAS root administrator. No tokens are returned to the browser or sent to Grok.

GoogleWorkspace.access() refreshes 60 seconds before access-token expiry and coalesces refresh requests. api() forces one refresh after a 401 and retries once; invalid_grant clears saved authorization. Refresh responses that omit refresh_token preserve it; rotations are retained. Writes are not retried for network/5xx uncertainty. HTTP operations serialize token/session mutations.

Back up the complete google-data volume and the separately protected server OAuth configuration through encrypted recovery. Older encrypted archives exclude the new Google volume. No new credentials were installed during this implementation, so real-account recovery validation remains pending.

## UI and natural-language use

Settings → Google 일정 · Drive · Gmail: connect/status/disconnect, service queries and direct mutation forms. Clicking a read result selects its ID for a follow-up such as '이 메일 읽어줘' / '답장 보내줘'. One Workspace operation runs per user turn even in multi-persona rooms; internal relay-writing prompts do not invoke Workspace. Main voice/text requests mentioning Google, Gmail, Drive, mail, reply or calendar route to the NAS Workspace assistant. Read results in conversation are subject to the app's existing conversation/history retention; the settings browser keeps results only in memory. Minimal selected metadata and the explicit request are sent to Grok for interpretation. Mutations require the on-screen preview's confirmation button; saying '실행해' does not bypass it.

## Test procedure and status

Automated tests mock Google/xAI transport and are not evidence of live authorization. The UI's '실제 API 통합 시험 · 변경 포함' first displays the exact effects: self-addressed test mail kept in Gmail, its unread/read label changes, only the newly created VoiceGrok OAuth Test calendar event and Drive text file are updated and removed. Failure to clean up returns only that test object ID; no user mail deletion or unrelated resource deletion. Disconnect invalidates local pending confirmation IDs.

As of 2026-10-07 the requested client credentials have not been supplied; the new code is not deployed to NAS or published to drivemode.grok.me. Real OAuth consent, refresh, service writes/reads and live revoke remain pending. The existing NAS HTTPS/callback service can be probed without credentials, but successful Google redirect/code exchange can only be verified after consent.

Sources: [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Gmail send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

### OAuth recovery backup

After connecting Google, create-recovery-backup.sh includes the private OAuth environment file and /run/google/key plus /run/google/oauth.enc inside the authenticated encrypted recovery archive. It requires the existing recovery-key.txt temporarily under private/recovery and removes that temporary NAS key only after successful backup. Keep the recovery key separately from the archive. verify-recovery-memory.mjs validates both archive encryption and Google token-store encryption in memory without printing tokens or extracting credentials. A restored Google refresh token can still expire or be revoked by Google; reconnect in that case.

## VoiceGrok 1.32.0 verified deployment

The published public app and NAS web image 1.32.0-google6 are deployed. The public client sends Workspace requests and Google TTS PCM/MP3 synthesis, status and settings to the NAS. Exact-origin CORS and the existing Tailscale Serve owner gate protect both paths. Unrelated paths, origins and owner identities remain rejected; browser TTS access codes are not sent from the public app to NAS.

The owner switched the OAuth app to External/In Production, revoked the old Testing connection, and completed new offline consent. Production access-token automatic renewal and authenticated Gmail, Calendar and app-authorized Drive reads were verified. Production does not guarantee refresh tokens will never be revoked or expire; invalid_grant clears the local connection and requires new consent.

Calendar speech uses Seoul dates, weekday and morning/afternoon times. Mail speech prefers sender display names or the address local part. Individual long plain-text bodies are summarized in Korean with a bounded, non-stored xAI request; explicit original-text requests bypass summaries. Search lists describe snippets as previews. Summaries use at most 12000 source characters and identify longer bodies as partial summaries. Original speech is capped at 10000 characters. Mail content is untrusted data and cannot execute tools or writes through summarization.

Validation: 35 Workspace/TTS/identity/speech tests, typecheck, NAS build and Vercel build passed. Live NAS TTS returned PCM frames and a completion frame, public browser sample completed without errors, and foreign-Origin requests returned 403. Phone speaker audibility needs separate device confirmation. No live mailbox mutation or calendar/file write was performed during these speech/TTS checks.

## Playback scroll and complete mail summaries — 2026-10-08

Conversation scroll no longer follows playback status, turn index or speech chunk changes. Existing new-message-ID navigation remains; replaying unchanged bubbles leaves the user's scroll position alone.

Mail summaries are no longer sliced at 1000 characters. The bounded xAI output budget is 1600 tokens. An incomplete response or unfinished sentence triggers at most one shorter-summary retry; repeated incompleteness gives an explicit original-reading suggestion instead of speaking a clipped fragment. Existing 12000-character input coverage labeling remains. Tests cover preserved final sentences beyond 1000 characters, incomplete output ending with a connector, retry bounds and honest failure.

26 focused regression tests, typecheck, NAS build and Vercel build passed. The same public app was republished with owner-only access retained; NAS web was rebuilt from the updated google6 package. In the actual public browser, scrollTop remained 0 while TTS remained actively playing after an upward scroll. No live Google writes, email sending or token output during verification.
# 1.32.1: 메일 본문 요약과 후속 원문 읽기

- 메일 목록의 읽기/요약 요청은 각 메일의 실제 본문을 조회하고 요약합니다. Gmail snippet을 요약으로 읽지 않습니다.
- 명시적인 요약은 600자 이하 본문에도 적용합니다. 단순 목록 조회는 번호, 보낸 사람, 제목을 안내합니다.
- 선택한 메일이 있으면 `원문 읽어줘`, `짧게 요약해줘`도 Workspace로 전달합니다. 번호/제목으로 선택할 수 있으며 여러 후보는 확인합니다.
- 선택 메타데이터는 해당 브라우저 탭의 sessionStorage에 한 시간만 유지합니다. 본문과 OAuth 토큰은 저장하지 않습니다.
- 원문은 만 자 한도를 넘으면 앞부분임을 명시합니다. 원문 읽기와 요약 읽기는 응답 문구로 구분합니다.
- HTML 전용 메일은 htmlparser2로 본문을 텍스트로 추출합니다. 스크립트/스타일/숨긴 미리보기는 제외하고 링크나 이미지를 요청하지 않습니다. 일반 텍스트 본문이 있으면 우선하며 첨부 파일은 본문으로 읽지 않습니다.
- Gmail의 본문 attachmentId도 읽기 전용 API로 가져옵니다(1MB 한도). 실제 본문이 없으면 미리보기를 원문으로 대체하지 않고 안내합니다.
