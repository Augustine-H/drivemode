# Codex Desktop 인계 — Voice Grok / Naver Mail MCP

기준일: 2026-10-09 KST. 인계 작성 직전 소스 HEAD는 `483019c`다. 이후 인계 문서 커밋을 포함한 **브랜치 최신 HEAD**를 사용한다.

## 이어받을 작업 지시

`Augustine-H/drivemode`의 `feature/naver-mail-mcp-v1` 브랜치에서 기존 Voice Grok 기능을 유지하며 네이버 메일 읽기 전용 MCP 연동을 이어서 진행한다. 구현·합성 시험·실제 NAS OAuth 시험은 완료했지만, 실제 네이버 INBOX가 UIDVALIDITY=0을 반환하고 OBJECTID도 지원하지 않아 **실계정 조회가 차단된 상태**다. 원래 요청한 UID 식별 안전성을 만족하는 해결책을 조사해야 한다. 검증을 제거하거나 UIDVALIDITY=0을 임의 epoch로 바꾸는 수정은 하지 않는다. 대체 설계가 원래 UID 조회 의미/보장을 바꾼다면 그 차이를 사용자에게 명시한다. 기존 구현·실제 증거를 확인하고 동일 진단을 반복하지 않는다.

## 저장소와 작업 원칙

- 저장소: https://github.com/Augustine-H/drivemode
- 작업 브랜치: `feature/naver-mail-mcp-v1`; **main에는 병합하지 않았다.**
- 공개 설치물만 보관하는 별도 브랜치: `naver-mail-mcp-v1.0.0-rc1-assets`. 앱 소스 개발 브랜치로 사용하지 않는다.
- 클라우드 checkout은 `/workspace/drivemode`였다. Desktop에서는 해당 GitHub 브랜치를 받아 실제 checkout 경로에서 작업한다. 클라우드 `/workspace` 파일이나 실행 중인 프로세스가 Desktop에 존재한다고 가정하지 않는다.
- 기존 변경을 보존하고 `AGENTS.md`부터 읽는다. 기존 Google OAuth, 페르소나, TTS, 기억/백업 및 NAS 서비스의 임의 재구성을 금지한다.
- 발송/답장/삭제/이동/읽음 변경/플래그 수정/APPEND 등 메일 쓰기 기능은 구현하지 않는다. EXAMINE과 BODY.PEEK를 유지한다.
- 인증정보 값은 채팅/로그/명령행/Git/APK에 넣지 않는다. 별도 서버 token을 Android에 전달하지 않는다.
- 사용자가 GitHub의 해당 별도 브랜치 및 공개 시험판 설치물 게시를 승인했다. 인증정보는 제외해야 한다. NAS 직접 원격 접근이 가능하다고 가정하지 않는다.

## 기존 앱 및 구현

실제 저장소는 React/TanStack Start/Vite 기반 웹/PWA 앱이다. 별도 Kotlin/Java Android 프로젝트는 발견되지 않았다. xAI는 raw fetch `/v1/responses`, 기존 음성 인식/TTS를 사용한다. 기존 Google 기능은 별도 흐름이다. 네이버 요청은 인증된 NAS 앱 백엔드의 독립 경로로 처리하며, 메일 결과는 임시 메모리에 두고 기존 대화 기억·자동 백업에 합치지 않는다.

주요 파일:

| 영역 | 파일 |
|---|---|
| 기존 MCP 도구/보안 | `services/naver-mail/naver_mail/server.py`, `auth.py` |
| 읽기 전용 IMAP, MIME/HTML, 제한/UID 검증 | `services/naver-mail/naver_mail/mail.py` |
| dual OAuth/Voice Bearer 런타임 | `services/naver-mail/naver_mail/oauth_server.py` |
| 암호화 영구 OAuth, 회전/폐기 | `oauth_store.py`, `oauth_provider.py`, `oauth_admin.py` |
| HTTPS/Host/Origin/요청 제한 | `oauth_http.py` |
| owner 승인·xAI 데이터 전달 안내/동의 | `oauth_consent.py` |
| 합성 시험 데이터 | `validation_mail.py` |
| 한 통의 실제 읽기 전용/플래그 검사 | `read_only_audit.py` |
| NAS 기본 시험 모드 설치 | `deployment/nas_oauth_stage.sh`, `oauth_setup.py`, `compose.oauth.yaml` |
| 실제 private opt-in mount/전환 | `deployment/compose.oauth.real.yaml`, `oauth_enable_real.py` |
| 공개 소스 화이트리스트 export | `scripts/build-naver-oauth-release.py` |
| 앱 백엔드/계약/클라이언트 | `src/lib/naver-mail.server.ts`, `naver-mail-contract.ts`, `naver-mail-client.ts` |
| 인증된 앱 endpoint | `src/routes/api/naver-mail.ts` |
| Voice 백엔드 opt-in 설정 | `services/naver-mail/voice-grok.compose.override.yaml` |

Python 3.12, 공식 MCP SDK 1.30.0, uvicorn 0.54.0, cryptography 50.0.2를 hash 잠금으로 사용한다. 요청했던 규격 이름만으로 지원을 주장하지 않았다. 실제 Grok/SDK 통신 증거를 기준으로 한다.

7개 도구: `mail_list_folders`, `mail_list_recent`, `mail_search`, `mail_get_message`, `mail_get_unread`, `mail_list_attachments`, `mail_get_thread`. 결과 수/페이지/응답·본문 크기/입력 제한을 적용한다. 첨부 원본 다운로드와 외부 URL 자동 접근은 하지 않는다.

새 OAuth는 기존 도구를 재사용한다. web은 `mail.read`/PKCE/S256/resource/CSRF 및 owner 승인, Voice는 서버 측 별도 registry와 요청별 scope를 확인한다. SQLite는 AES-GCM 암호화, 메일 본문 영구 캐시 없음. access 10분, refresh 24시간, family 최대 7일; 재사용 시 family 폐기. 모드/계정 전환 시 grant가 폐기되므로 시험 token을 실계정으로 승격하지 않는다. 현재 기본 모드는 **validation**이다.

## 실제 NAS 상태 — 사용자 실행/화면 증거

- Synology DS218+, x86_64, DSM 7.2 build 64570 update 4.
- Docker 24.0.2, Compose v2.20.1. root는 Docker에 접근 가능; manhak 단독 Docker 접근은 불가했다.
- DSM: `https://imhmh.synology.me:5119`; SSH: `imhmh.synology.me:710`, 사용자 `manhak`.
- SSH 접속은 사용자가 PC에서 수행했다. 클라우드가 NAS에 직접 접속/설치했다고 보고하면 안 된다.
- SSH 명령: `ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -p 710 manhak@imhmh.synology.me`.
- `sudo Password:`는 **manhak NAS 로그인 비밀번호**다. 새로운 메일 승인 암호와 혼동하지 않는다.

| 서비스 | 프로젝트/컨테이너 | 호스트 바인딩 및 상태 |
|---|---|---|
| 기존 uptime-kuma | `uptime-kuma` | 3001 사용 중; 건드리지 않음 |
| 최초 실제 메일 MCP | `/volume1/docker/voice-grok-naver-mail`; `voice-grok-naver-mail-naver-mail-1` | 127.0.0.1:13001 → 3001. IMAP 로그인/health/restart 확인; 실제 메일 조회 완료 아님 |
| 초기 합성 OAuth canary | `/volume1/docker/voice-grok-naver-mail-canary`; `voice-grok-naver-canary-canary-1` | 127.0.0.1:13002 → 3001. 실제 Grok 합성 검색/Get Message/한국어 요약 확인 |
| 새 영구 OAuth | `/volume1/docker/voice-grok-naver-mail-oauth`; `voice-grok-naver-oauth-mail-oauth-1` | 127.0.0.1:13003 → 3001. **MODE=validation**; 설치/health/restart 및 실제 Grok 합성 Get Message 확인 |

기존 이미지: `voice-grok-naver-mail:1.0.0`, 고정 ID `sha256:1127503de36f7a88344d99d8dea8b4f6f1f9e856ccea9b20c5c486928d3e81d3`. 새 OAuth는 이 기존 이미지를 재사용하고 공개 코드를 `/code`에 mount한다.

DSM 역방향 프록시는 source `https://imhmh.synology.me:8446`, target `http://127.0.0.1:13003`로 새 시험 서버를 사용한다(초기 target은 13002였다). 요청 머리글 Host=`imhmh.synology.me:8446`, X-Forwarded-Proto=`https`; DDNS 인증서 및 TCP8446 포트포워딩 설정. 한국/칠레 제한 방화벽 때문에 Grok 연결이 실패했으나 8446 허용 규칙 설정 후 연결됐다. 새로운 실계정 공개 전환은 하지 않았다. 원래 13001을 프록시에 지정하지 않는다.

실제 Grok connector 이름은 **Naver Mail OAuth Test**, URL은 `https://imhmh.synology.me:8446/mcp`다. 이전 Canary connector와 혼동하지 않는다. 사용자가 새 컨테이너를 재시작한 출력 및 재연결 없이 `Mail Get Message 사용함`이 표시된 후속 화면을 제공했다. 새 provider의 실제 refresh 만료/회전 전체 검증은 아직 아니다.

## 인증정보 위치 — 값은 인계하지 않음

- 최초 Naver credentials: `/volume1/docker/voice-grok-naver-mail/services/naver-mail/private/server/imap.json`.
- 같은 디렉터리: `config.json`, `tokens.json`, `health-token`. root:10001, 파일 0440, 디렉터리 0750. 원본 디렉터리 mount로 token 원자적 회전을 보존한다.
- 최초 private/clients의 `voice-v1`, `web-v1`는 root 전용 token 파일이다. 내용을 출력하지 않는다.
- 새 OAuth private: `/volume1/docker/voice-grok-naver-mail-oauth/private`; config/owner hash/state key/health/validation token을 보관한다.
- 새 OAuth state: 위 프로젝트의 `state`; UID10001:10001/0700, DB0600. state와 key는 공개 Git/설치물에 포함하지 않는다.
- 새 **메일 접근 승인 암호는 초기 Canary 암호, NAS 비밀번호, Naver 앱 비밀번호와 별도로** 사용자가 숨겨 입력했다. Desktop Codex가 이 값을 알고 있다고 가정하지 않는다.

## 현재 차단 원인 — 진단 반복 불필요

1. 최초 audit 호출은 이미지 WorkingDir `/app` 때문에 이전 package가 선택돼 module not found였다. 일회성 실행에 **`--workdir /code`**를 추가해 해결했다. compose에는 원래 working_dir /code가 있다.
2. 수정된 실제 audit는 failed였다. 숨김 단계별 진단으로 IMAP 연결/LOGIN 성공, INBOX 검색 전 mailbox_uidvalidity 검증에서 실패를 확인했다.
3. 직접 읽기 전용 EXAMINE 응답을 값 비노출로 분류한 결과: **`uidvalidity_category=zero`, `mail_body_read=false`**.
4. 로그인 후 CAPABILITY 결과: **OBJECTID=false, CONDSTORE=false, QRESYNC=false, IMAP4REV2=false**. 이 계정의 관찰이며 네이버 전체를 일반화하지 않는다. 다른 capability 전체가 미지원이라는 뜻도 아니다.
5. 따라서 RFC 8474 MAILBOXID/EMAILID 표준 대체 경로도 현재 사용할 수 없다. CONDSTORE/QRESYNC는 UID 식별 보장의 대체가 아니다.

소스 최신 버전은 이 경우 `uidvalidity_unsupported`로 명확하게 실패하며 SEARCH/FETCH 전에 차단한다. **NAS에 설치된 공개 runtime은 `191eb9b` 코드**로, 최신 오류 처리 `226abf0` 및 이후 문서 변경은 NAS에 배포하지 않았다. 설치물과 최신 Git 코드를 같은 버전으로 취급하지 않는다.

실제 본문/한국어 검색/flags 유지 audit는 성공하지 않았다. 고정 epoch 0/1, 검사 제거, header hash를 동등한 안정 식별자로 간주하는 우회는 적용하지 않았다. 헤더/내용 hash 및 단기 snapshot 대안은 의미·개인정보·동시 변경·UID 재사용을 별도로 설계/검증해야 한다. 지금 보장된 해결책이 아니다.

## 검증 결과

- 최신 관련 코드에서 Python **90 passed**, 기존 Starlette/httpx deprecation 경고 1개, 실패/skip 없음. UIDVALIDITY 0/음수/uint32 초과 시 실제 검색/본문 FETCH 전 차단하는 회귀 포함.
- Voice 계약 회귀 **11 passed** (`node --test scripts/naver-mail.test.mjs`): provider 분리, scope/인증, 페르소나/TTS 유지, Google/기억과 분리, token 비노출.
- 영구 OAuth 개발 단계 실제 격리 Docker: 숨김 TTY 설치, nonroot/read-only/loopback, SDK 합성 도구, 재시작 후 기존 access, refresh 회전/replay 폐기, root 모드 전환·복귀 및 정책 미동의 거부 통과. 계정 없이 수행했다.
- 로컬 test CA를 신뢰하되 TLS 검증을 유지한 PC/모바일 승인 화면, 필수 xAI 동의, 잘못된 승인 암호 거부 확인.
- 실제 NAS: IMAP 로그인, 설치/health/restart, 새 합성 OAuth Grok 도구 실행 확인. PID cgroup 미지원 경고가 있으며 pids_limit 적용 성공으로 보고하지 않는다.
- 미완료: 실제 Naver 본문/검색/모든 flags 유지, 실계정 Grok 요약, 실제 Voice 음성/xAI remote MCP, 새 provider 실제 refresh 만료 복구, 실제 백업/복구.
- 전체 앱 빌드/전체 JS suite의 최초 결과와 후속 제한 회귀는 `docs/naver-mail-validation.md`에 구분 기록했다. 최근 Python 90개 실행을 전체 앱 재검증으로 확대 해석하지 않는다.

## 재현 및 읽을 문서

새 환경에서 Python 3.12와 uv를 준비하고 hash 잠금된 `services/naver-mail/test-requirements.txt`를 이용해 별도 venv에 sync한다. 아래는 POSIX 예시이며 Desktop 플랫폼에 맞는 venv 실행 경로를 사용한다.

```sh
cd services/naver-mail
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python --require-hashes test-requirements.txt
PYTHONPATH=. .venv/bin/python -m pytest -q tests
cd ../..
node --test scripts/naver-mail.test.mjs
```

Docker NAS staging 시험은 기존 고정 이미지/Docker 접근 권한/공유 filesystem이 필요하다. 단순 기본 테스트와 구분한다. 이미지가 없는 Desktop에서 설치돼 있다고 가정하지 않는다. NAS root 작업 helper는 application package를 import하지 않는 독립 stdlib 스크립트다. 컨테이너 code/private/state 권한을 임의 완화하지 않는다.

우선 읽을 문서:

1. `docs/naver-mail-validation.md`: 시점별 실제/합성/미실행 증거.
2. `services/naver-mail/OAUTH_INSTALL.md`: 전환 보류 경고, 설치/검사/전환/되돌리기/폐기/백업.
3. `docs/naver-mail-imap-support-request.md`: 네이버 고객센터 문의 초안. **자동 전송하지 않았다.**
4. `docs/naver-mail-architecture.md`, `docs/naver-mail-production-oauth-plan.md`: 초기 조사와 이후 변경 범위. 초기 문서의 과거 미검증 상태는 최신 validation 기록으로 보완한다.
5. `services/naver-mail/NAS_INSTALL.md`, `integration/README.md`, `integration/SYNOLOGY_OAUTH_CANARY.md`.

## 설치물 및 버전 참고

웹 Codex artifact 다운로드가 사이드바만 열리는 문제가 있어 GitHub의 공개 고정 raw 링크로 전달했다. GitHub upload API가 실패해 실제 release asset upload 대신 asset-only Git branch와 release 본문 링크를 이용했다.

- 시험판: https://github.com/Augustine-H/drivemode/releases/tag/naver-mail-mcp-v1.0.0-rc1
- 새 영구 OAuth 설치 명령: https://raw.githubusercontent.com/Augustine-H/drivemode/03e42decbd71ad005fbd83a96c6683f42d1ca84e/naver-mail-oauth-install-command.txt
- 소스 runtime tar: https://raw.githubusercontent.com/Augustine-H/drivemode/ce94664c62d55e68b85c78464f9c5baded24949f/naver-mail-oauth-runtime.tar.gz
- 위 tar SHA256: `5426d42254160d5f202d71612ddb9b6e465177184f95a83f2e392d8805a01ed0`, code 기준 `191eb9bb38de4e9137772cc027ef08320c4cd578`.
- 기존 프로젝트/네트워크가 있으면 설치 스크립트가 중단하도록 했다. **설치 명령을 재실행하거나 디렉터리/private를 삭제하지 않는다.** 현재 해결해야 할 문제는 설치가 아닌 UID 식별 호환성이다.

## 다음 작업과 완료 기준

Desktop 후속 조사(2026-10-09): [메시지 식별 대안 조사](naver-mail-identity-investigation.md)를 먼저 읽는다. 원래 영구 UID 보장을 대체하는 경로는 확인하지 못했으며 기존 차단을 유지했다. 헤더/내용 hash, 세션 위치, RAM snapshot의 보장 차이와 채택 전 시험을 정리했다. runtime/NAS/실계정 모드는 변경하지 않았다. Desktop Voice 계약 회귀 11개 재통과; Python 90개는 인계의 기존 결과로 구분한다.

현재 네이버 계정의 공식 UIDVALIDITY 해결 방법 또는 보장되는 대체 식별 경로를 확인한다. 문의가 필요하면 위 초안을 사용자가 직접 제출한다. 모델이 사용자 지시 없이 외부 문의를 전송하지 않는다.

대체 설계를 제안할 경우 UID 재사용/메일함 reset/재연결/동시 변경/중복 Message-ID/동일 헤더·크기/큰 MIME/첨부 원본 비조회/개인정보 최소화/임시와 영구 cache를 검토하고, 원래 요구사항과 달라지는 보장을 분명히 설명한다. 테스트를 통과시키려고 UIDVALIDITY 검증이나 원래 safety oracle를 제거하지 않는다.

해결 코드와 자동 검증 후, 사용자 요청 범위의 실제 읽기 전용 audit가 통과하고 xAI 정책 동의·새 OAuth 승인이 있을 때만 실계정 전환한다. 실제 Grok 메일과 실제 Voice 음성은 각각 검증한다. 기존 main/Google/TTS/백업/다른 NAS 컨테이너 유지와 secret 비노출을 계속 확인한다.
