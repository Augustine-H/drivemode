# Naver Mail — direct IMAP/SMTP

VoiceGrok 1.34.0 adds Settings → 네이버 메일 and voice/text routing into the existing speech response flow. Google OAuth remains separate. No MCP server, connector gate or new database is required.

Enable IMAP in Naver Mail settings and generate an application password under Naver two-step verification. Enter `name@naver.com` and that password in the authenticated app's connection form, never in chat. Connection verifies both IMAP and SMTP before replacing an existing account. Use the NAS's existing HTTPS/Tailscale or paired public-device access; the endpoint rejects unauthenticated requests, incorrect origins and insecure forwarded traffic. Password submission pins the chosen HTTPS destination and cannot fall back to an HTTP server.

The NAS launcher sets `NAVER_MAIL_DATA_DIR=/run/google/naver`, inside the existing private `google-data` volume. `key` and `credentials.enc` use mode 600, parent directory mode 700; AES-256-GCM with provider-specific AAD protects the credentials. The key is co-located, so a NAS administrator can access the account. Existing encrypted recovery backups additionally include `web/naver/key` and `web/naver/credentials.enc` when connected. Restore these to `/run/google/naver` with UID 1000 and the original restricted permissions. Disconnect clears stored credentials and pending drafts/proposals; revoke the app password in Naver to invalidate it outside VoiceGrok as well.

The backend fixes IMAP to `imap.naver.com:993` with verified TLS and SMTP to `smtp.naver.com:587` with required STARTTLS. Protocol logging is disabled. Browser responses never contain passwords. Plain text is preferred; HTML parsing does not load images or links. Source messages are capped at 20MB, extracted body text at 100,000 characters, attachments for outgoing mail at 5 files/10MB total, recipients at 10, list results at the latest 20 matching messages. Search uses literal IMAP text search, not Gmail query syntax. Voice lists narrate at most 5 messages. Long original readings disclose a 10,000-character cutoff.

Reads use read-only mailbox locks and PEEK fetches; they do not mark messages read. Selection identifies account generation, mailbox, UIDVALIDITY and UID. Changed mailbox identity rejects stale selections. Explicit mark-read/unread, move and trash operations require a preview; trash does not permanently delete messages. Trash requires an IMAP mailbox advertised with `\\Trash`; if none is advertised, select a destination manually. Received originals and delivered recipient messages cannot be edited.

App drafts are device-scoped AES-256-GCM files in the private Naver directory and survive server restarts. Disconnect/account replacement removes them. Encrypted recovery backups include these files. Save app edits before closing settings. Explicit **네이버 임시보관함에 저장** opens a confirmation and saves a Drafts message; **초안으로 불러오기** imports a selected Naver Drafts message. This is manual synchronization, not continuous two-way synchronization. Fingerprint/UIDVALIDITY checks reject changed or missing old drafts. A new verified draft is saved before the older version moves to Trash. Ambiguous APPEND/SMTP results are never automatically retried. Imported drafts use plain text; CC/BCC recipients are preserved separately when importing and saving drafts. Delivered SMTP MIME removes BCC headers while its envelope includes BCC recipients. To/CC/BCC together are capped at 10 recipients; BCC-only delivery is allowed. Confirmations show all three groups to the authenticated owner. Forwarding clears original recipients. Forwarding includes original attachments by default, with an explicit exclusion checkbox. Limits are decimal 10,000,000 bytes per file/total and 20,000,000 bytes raw source. Voice edits retain attachments; voice sync requests prepare confirmations.

Sending previews the exact sender, recipients, subject, body and attachment names/sizes. One-use 10-minute proposals bind to the authenticated device/Tailscale owner and account generation. Saving a revised draft or preparing a new preview invalidates older previews. SMTP errors consume the proposal and never auto-retry. SMTP acceptance means the server accepted the message, not verified recipient delivery. The app does not append another copy to Sent; check Naver's own sent-mail behavior after real-account verification.

`/api/naver-mail?action=...` supports GET status/mailboxes/messages/message/draft and POST connect/disconnect/draft/reply/propose/execute/chat. The API runs only behind the existing trusted NAS listener and authentication boundary. AI operations are user-initiated, bounded, server-side xAI calls; mail content is untrusted data and cannot authorize execution.

Verification: `node --experimental-strip-types --test scripts/naver-mail.test.mjs`, build/typecheck, development/production desktop and mobile smoke, and isolated UI fixtures. A real Naver account connection and authorized real delivery test remain distinct from simulated tests. Deploy the new built NAS package before connecting an account in the live app.

Official references: [Naver IMAP/SMTP](https://help.naver.com/service/30029/contents/21344?lang=ko), [Naver application-password policy](https://help.naver.com/service/30029/bookmark/24347?lang=ko&osType=COMMONOS), [Nodemailer SMTP](https://nodemailer.com/smtp).

## 1.34.2 · 첨부 다운로드 및 후속 검증

2026-10-09 KST: 앱 내 첨부 다운로드(원문 5MB·파일 3MB 이하)와 정확한 Base64 파일 크기 표시를 추가했다. 인증과 generation/UIDVALIDITY/UID 검사를 유지하고 읽기 전용으로 조회한다. 실제 테스트 첨부의 원본 바이트·SHA-256 일치 및 안읽음 보존, 읽음 변경·메일함 이동·휴지통 이동과 복원, 답장 In-Reply-To·References 연결을 확인했다. 새 발송은 없다. 40개 회귀 테스트, 타입 검사, Vercel/NAS 빌드 및 개발/운영 데스크톱·모바일 화면 검증 통과.


## 1.34.4 recipient groups

Adds CC/BCC fields to editing, voice drafts, confirmations and imported Naver drafts. Existing drafts remain compatible. Local SMTP protocol tests verify BCC envelope delivery without a BCC header.

## 1.34.5 중요 표시

메일 목록·상세에서 중요 표시를 구분하고 선택한 메일에 설정·해제할 수 있다. 음성의 중요 표시 요청도 일회용 확인을 거친다. IMAP \Flagged만 UID로 추가·제거하며 읽음 상태와 다른 플래그는 유지한다.
