# Naver Mail MCP v1.0 검증 기록

2026-10-08 KST, 웹 Codex 클라우드의 GitHub checkout에서 수행했다. 원래 HEAD `ec5c65d2a5324836d9c485a0e601f9198a9b0f50`은 `origin/main`과 일치했다. 구현은 `feature/naver-mail-mcp-v1` 브랜치에 있으며 Git 커밋은 `git log -1`로 확인할 수 있다. 실제 계정/배포/웹 연결은 이 기록의 성공 항목이 아니다.

## 실행한 자동 검증

아래 표는 최초 구현 커밋의 검증이다. 후속 HTTPS 도구 작업의 재검증 결과는 다음 절에 따로 기록한다.

| 검증 | 결과 | 범위 |
|---|---|---|
| Python `pytest -q tests` | **27 passed**, skipped 0 | 읽기 전용 IMAP, MIME, 도구, 인증/회전, 실제 합성 TLS/SDK 전송 |
| `node --test scripts/naver-mail.test.mjs` | **11 passed** | 계획/선택/remote MCP 요청, 요약 격리, 한국어 안내, 인증과 기존 서비스 분리, backend credential 반환 방어 |
| 전체 `npm test` | **450 passed** = scripts 395 + TS 55, failed/skipped 0 | 기존 439개 + 새 11개. Google/TTS/기억/백업/대화 회귀 포함 |
| `npm run typecheck` | 통과 | 신규 route tree와 서버/클라이언트 코드 포함 |
| `npm run build` | 통과 | 기존 grok-4.5 / Responses 유지. DB 설정 없음으로 migration을 skip; DB 연결 검증으로 표현하지 않음 |
| `docker compose config --quiet` | 통과 | Compose 문법/설정 정합성, 실제 NAS 충돌 검증 아님 |
| Docker 이미지 빌드 | 통과 | Python 3.12, hash 잠금 파일, non-root UID/GID 10001. 신뢰 CA를 BuildKit secret으로만 제공 |
| `tests/verify_container.py` | 통과 | 네트워크/공개 port 없는 컨테이너, 인증 health, 무인증 401, read-only/non-root, restart 후 동일 token health |
| agent-browser dev 화면 | 통과 | 합성 API 응답으로 메일 패널·목록·모바일 폭, 닫기, reload와 localStorage에 본문 없는지 검사 |
| agent-browser build 화면 | 통과 | 동일 합성 UI를 빌드된 앱에서도 실행; 실제 네이버/xAI/음성 하드웨어는 사용하지 않음 |

Python transport 테스트는 local CA를 명시적으로 신뢰한 TLS fixture를 사용하며 인증서 hostname/chain 검증을 끄지 않는다. 실제 IMAP wire LOGIN, 잘못된 인증 거부, EXAMINE, 한국어 literal SEARCH와 UID header FETCH를 검증했다. 별도 실제 HTTPS fixture에서 공식 MCP SDK initialize/list_tools/call_tool을 실행했다. fixture flags 비교는 합성 메일 저장소에 대한 검사이며 네이버 실계정 FLAGS 유지의 증거가 아니다.

Voice Grok Compose override의 병합은 저장소 외부의 합성 project 폴더와 빈 Google env fixture로 검사했다. 실제 NAS의 기존 Google private env 파일은 클라우드에 없으며 읽거나 생성하지 않았다. 빌드된 browser static assets에는 `NAVER_MAIL_TOKEN_FILE`과 `X-Naver-Mail-Scope` 서버 설정 코드가 포함되지 않는 것도 확인했다.

Docker 첫 실패는 build network 경로, 다음 실패는 proxy CA 신뢰, 다음 실행 실패는 소스 파일의 비특권 읽기 권한이었다. 지원되는 host build networking/신뢰 CA secret 및 `COPY --chown=10001:10001`로 수정한 후 재검증했다. TLS/패키지 해시 검증을 비활성화한 적은 없다. 현재 Docker 시험은 실제 IMAP 접속 없이 health만 확인하며 `imap_checked:false`를 명시한다.

원래 `scripts/browser-smoke.mjs`는 cloud Chromium의 Grok 외부 확장 script CA 신뢰 문제로 exit 2였다. 앱 자체는 HTTP 200, 데스크톱/모바일 표시, pageErrors 0, 가로 넘침 없음이었다. 동일 페이지를 agent-browser의 지원되는 `--ca-cert`로 실행하여 별도 실제 브라우저 동작 검증을 했다. HTTPS 오류 무시 옵션은 사용하지 않았다. 기존 custom share-card가 없다는 BRAND NOTE 및 기존 번들러의 `use client` 경고는 이번 메일 구현과 분리하여 남겼다.

브라우저 합성 UI 재현:

```sh
cd /workspace/drivemode
AGENT_BROWSER_SOCKET_DIR=/workspace/.onboarding/browser-sockets \
AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium AGENT_BROWSER_ARGS=--no-sandbox \
/workspace/.onboarding/browser-tools/node_modules/.bin/agent-browser \
  --ca-cert /usr/local/share/ca-certificates/environment-proxy-ca.crt \
  batch --bail < scripts/naver-mail-ui-qa.json
```

`--no-sandbox`는 이 클라우드의 headless Chromium 실행 옵션이며 Docker 서비스는 cap-drop/no-new-privileges/non-root를 유지한다. 브라우저 CA 파일은 이 클라우드의 제공된 신뢰 root다. 다른 환경은 그 환경의 올바른 신뢰 root를 사용한다. QA JSON의 `/api/naver-mail`은 **합성 응답으로 mock**한다. production QA는 URL만 8081로 변경한 동일 순서로 실행한다. 실제 메일 성공이나 음성 재생으로 표시하지 않는다.

## 요청된 18개 테스트 구분

### 후속 작업: 계정 없는 HTTPS 점검 도구

2026-10-08 UTC, 같은 `feature/naver-mail-mcp-v1` 브랜치에서 사용자가 선택한 “계정 없이 HTTPS 테스트 환경·통합 점검 도구 준비”를 수행했다.

- `integration.https_canary`: IMAP 연결 없는 합성 데이터, loopback 전용 HTTPS, 임시 CA/개인 키/역할별 토큰을 private 파일로 생성.
- `integration.probe`: 기본 모드는 메일을 읽지 않고 HTTPS 인증·프로토콜·7개 읽기 전용 도구 목록만 검사. `--canary` 조회는 loopback만 허용. URL 내 자격증명·query·fragment와 redirect를 차단.
- `integration.self_check`: 별도 서버 프로세스에서 합성 한글 목록·본문, 인증서 신뢰 요구, 무인증/잘못된 토큰 401, Host/Origin 차단, 웹 역할 기본 거부, scope 누락/확대 거부, 토큰 overlap/즉시 폐기, 재시작 후 신규 토큰 정상·폐기 토큰 거부를 검사. 종료 시 서버·임시 private 파일 정리.
- 테스트 파일 `tests/test_integration_tools.py`의 11개 케이스 포함 전체 Python **38 passed**, failed/skipped 0. 기존 Starlette TestClient deprecation warning 1건.
- 전체 `npm test` 재실행 **450 passed**, failed/skipped 0. Voice Grok 앱 소스와 production 서버·Dockerfile·의존성은 이번 후속 작업에서 변경하지 않았다. 타입/빌드/브라우저/Docker 검증은 위 최초 구현 기록이며 이번에 재실행한 것으로 표시하지 않는다.
- `git diff --check` 통과. 실제 네이버 계정, 공개 HTTPS ingress, NAS, Grok 웹, 유료 xAI, Android 음성은 이번에도 **미실행**. 최종 실서비스 완료 기준은 아직 충족하지 않았다.

이번 변경 파일은 `services/naver-mail/integration/{__init__.py,https_canary.py,probe.py,self_check.py,README.md}`, `services/naver-mail/tests/test_integration_tools.py`, `services/naver-mail/.dockerignore`, `services/naver-mail/README.md`, 이 검증 문서다. 테스트 도구는 production 이미지의 build context에서도 제외한다. 신뢰 CA·개인 키·토큰·registry·실제 메일 데이터는 Git에 저장하지 않았다. 운영 단계별 설정과 미검증 항목은 [HTTPS 점검 안내](../services/naver-mail/integration/README.md)에 있다.

### 후속 작업: Voice Grok 백엔드와 HTTPS MCP 연결 검증

2026-10-08 KST, 사용자의 “다음 진행”에 따라 클라우드 설정의 존재 여부만 확인했다. `NAVER_MAIL_ENABLED`, `NAVER_MAIL_MCP_URL`, `NAVER_MAIL_TOKEN_FILE`, `XAI_API_KEY`가 없고 MCP 토큰 파일도 준비되지 않아 실제 외부 연결을 실행하지 않았다. 인증정보 값은 읽거나 출력하지 않았다.

기존 `naverMailEndpoint`와 별도 프로세스의 합성 HTTPS MCP 서버를 연결하는 `integration.voice_check`를 추가했다. 기존 백엔드가 만든 scope/Authorization/인자를 공식 Python SDK에 전달하고 실제 HTTPS 도구 응답을 기존 결과 해석 코드에 입력한다. xAI 계획·요약·remote 응답 envelope는 모의 값이며 실제 유료 API에 접근하지 않는다. Node 기본 fetch는 테스트에서 차단된다.

앱 identity/Origin 거부, 7개 도구, 한글 목록 → 실제 반환된 메시지 선택 → 원문/TTS용 텍스트/모의 요약, scope 확대 거부, UIDVALIDITY 변경 안내, 쓰기 명령 upstream 호출 차단, 폐기 토큰의 한국어 오류, no-store 및 토큰/API 키/기억 미포함을 확인했다. SDK 연결은 11회 시도했으며 마지막은 폐기 토큰으로 인증 실패를 기대하는 경우다. 실제 route HTTP listener·Tailscale proxy·브라우저·음성 재생은 이 도구에서 시험하지 않는다.

- 전체 Python 재실행: **42 passed**, failed/skipped 0, 기존 TestClient deprecation warning 1건. 신규 4개 테스트는 외부/HTTP 주소·쓰기 도구를 SDK bridge가 연결 전에 거부하는 것과 전체 Voice 흐름이다.
- 전체 `npm test` 재실행: **450 passed** = 395 + 55, failed/skipped 0.
- `git diff --check`: 통과. 앱/production 서버/의존성/Docker 설정은 변경하지 않았으며 이전 타입·빌드·UI·Docker 검증을 이번 재실행으로 표시하지 않는다.
- 실제 네이버·NAS·공개 HTTPS·Grok 웹·xAI·Android 마이크/TTS는 **미실행**. 보고서도 `xai_verified`, `grok_web_verified`, `android_voice_verified`를 false로 반환한다. 외부 연결 전에 서버 private 토큰 파일·HTTPS URL·서버 전용 xAI 키와 인증된 NAS 앱 설정이 필요하며 채팅/Git에 값 자체를 제공하지 않는다.

변경 파일: `services/naver-mail/integration/{sdk_bridge.py,voice_check.py,voice_flow.mjs,README.md}`, `services/naver-mail/tests/test_voice_flow.py`, 이 문서. 테스트 서버와 private 파일은 종료 시 정리했으며 실제 인증정보를 생성·커밋하지 않았다. 기존 합성 토큰도 임시 파일로만 존재한다.

### 후속 작업: Synology 설치 묶음 준비

2026-10-08 KST, 사용자가 NAS/인증 HTTPS가 아직 없다고 답하고 “NAS 배포 준비부터 진행”을 선택했다. 기존 서비스 구성은 변경하지 않았다.

`scripts/build-naver-mail-release.py`는 깨끗한 커밋의 MCP 서비스/문서만 archive하고, Linux amd64·UID/GID 10001 및 런타임 소스/requirements 해시가 일치하는 Docker 이미지만 export한다. 기존 다른 release tag와 출력 디렉터리를 덮어쓰지 않는다. 생성된 묶음에는 manifest와 SHA256SUMS를 제공한다. 실제 `.env`, private 파일, NAS/네이버 인증정보는 포함하지 않는다. source 묶음은 전체 Voice Grok checkout이 아니므로 앱 배포/Node 테스트는 전체 저장소를 사용한다.

`deployment/private_check.py`는 네트워크 없이 private 파일 형식·0440/0400 권한·분리된 역할/hash·health token·초기 HTTPS/웹 차단 게이트를 검사한다. JSON 결과는 계정/토큰/예외 내용을 포함하지 않는다. 실제 password 인증, DSM ACL/포트 충돌/proxy peer를 확인했다고 표시하지 않는다. 초기 설치용이므로 웹 게이트가 이미 true인 설정은 거부하며 운영 환경의 게이트를 자동으로 변경하지 않는다.

- Python 전체 **48 passed**, failed/skipped 0, 기존 TestClient warning 1건. 신규 6개 케이스는 private 값 미출력 및 위험한 권한·웹 게이트·proxy 신뢰·health Host·공유 토큰 hash 거부다.
- 기존 이미지 `sha256:1127503de36f7a88344d99d8dea8b4f6f1f9e856ccea9b20c5c486928d3e81d3`: Linux amd64, UID/GID 10001 확인. 합성 tmpfs private 파일로 새 오프라인 점검을 **실제 UID 10001/read-only root/network none**에서 실행하여 통과했다.
- 기존 격리 Docker 인증 health/무인증 401/non-root/read-only/restart 재검증 통과. Compose config 및 git diff 검사 통과.
- 설치 이미지 export 후 `docker load`를 실행하여 같은 image ID·Linux amd64·UID 10001이 복원되는 것을 확인했다. Source archive의 필수 파일·private 미포함과 `SHA256SUMS` 검증도 통과했다. Source 파일/폴더 mode는 Git archive의 umask를 명시해 0644/0755로 생성한다. Archive 원본 커밋·실제 체크섬은 release manifest/SHA256SUMS를 기준으로 확인한다.
- 앱 소스/운영 Dockerfile/의존성은 변경하지 않았다. 이전 450개 JS/TS 회귀·타입·빌드·브라우저 결과를 이번 재실행으로 표시하지 않는다.
- 실제 NAS 설치, 네이버 로그인, 공개 HTTPS, Grok 웹/xAI, Android, NAS 백업·복구는 **미실행**.

변경 파일은 `scripts/build-naver-mail-release.py`, `services/naver-mail/{NAS_INSTALL.md,README.md,deployment/private_check.py,tests/test_nas_private_check.py}`, 이 기록이다. 사용자/운영자가 설정할 항목과 롤백 절차는 [NAS 설치 안내](../services/naver-mail/NAS_INSTALL.md)에 있으며 실제 계정 설정 값은 안전한 NAS 관리 경로에서 입력한다. 생성 archive의 원본 커밋과 image ID는 묶음의 `manifest.json`을 기준으로 확인한다.

### 최초 구현의 18개 시험 결과

| # | 요청 항목 | 자동 검증 | 실제 통합 |
|---|---|---|---|
| 1 | 정상 IMAP 인증 | TLS 합성 server LOGIN 통과 | 네이버 계정 미실행 |
| 2 | 잘못된 인증 거부 | TLS fixture와 IMAP 오류 redaction 통과 | 네이버 계정 미실행 |
| 3 | 받은메일 목록 | UID/헤더 fixture + MCP call 통과 | 미실행 |
| 4 | 한글 제목 | MIME encoded word / TLS FETCH 통과 | 미실행 |
| 5 | 한글 본문 | base64 UTF-8 MIME 통과 | 미실행 |
| 6 | HTML 안전 변환 | script/hidden/svg/image URL 제거 통과 | 미실행 |
| 7 | 날짜 검색 | SINCE 포함/BEFORE 제외 및 잘못된 날짜 통과 | 네이버 CHARSET/INTERNALDATE 미실행 |
| 8 | 안 읽은 메일 | UNSEEN 검색 통과 | 미실행 |
| 9 | SEEN 유지 | 합성 flag 전후 동일, PEEK/EXAMINE 명령 통과 | 네이버 flag 비교 미실행 |
| 10 | 기타 flags 유지 | Flagged/Answered/Draft 전후 동일 통과 | 미실행 |
| 11 | 대용량 제한 | 본문·응답·literal/페이지 제한 통과 | 미실행 |
| 12 | MCP 인증 실패 | 401/Host/Origin/TLS/proxy/크기/빈도 통과 | 공개 HTTPS ingress 미실행 |
| 13 | 재시작 복구 | 새 SDK app/registry 재읽기 + Docker restart 통과 | 실제 NAS reboot/restore 미실행 |
| 14 | Grok 웹 연결 | xAI-shaped 요청 fixture와 SDK 협상만 검증 | **미실행·인증 호환성 미확인** |
| 15 | Voice Grok 음성 명령 | 한국어 명령 분기/remote 요청/TTS 전달 경로 및 mock UI 통과 | 실제 Android 마이크·스피커·메일 미실행 |
| 16 | 프롬프트 인젝션 | 다른 UID 선택 거부, 정확한 scope, 요약에 tool 없음, 외부 접근/secret/history 없음 통과 | 실제 악성 메일 모델 응답 미실행 |
| 17 | 토큰 회전 | 새/기존 동시 사용, 즉시 폐기 후 401, restart 통과 | 웹 connector 토큰 갱신 미실행 |
| 18 | 기존 회귀 | 기존 439개 + 신규 11개 총450 통과, 타입/빌드 통과 | 사용자 실제 서비스 관찰 미실행 |

## 2026-10-08 실제 NAS 후속 결과

아래는 NAS 운영자가 실행한 명령의 출력·화면을 확인한 결과다. 클라우드 에이전트가 NAS에 직접 로그인해 실행한 결과로 표시하지 않는다.

- 실제 DSM 7.2/DS218+에서 archive 검증·image load·스테이징 파일/토큰 분리·UID 10001 읽기 권한·Compose 설정 점검 통과.
- 대화형 SSH 입력 도구로 NAS private에 인증정보 저장 통과. 값은 채팅·Git에 입력하지 않았다.
- 실제 네이버 IMAP TLS LOGIN/LOGOUT 성공. 메일 목록·본문·FLAGS 비교는 미수행.
- 새 MCP 서버 시작 및 해당 컨테이너 restart 후 인증 health 복구 성공. 바인딩 `127.0.0.1:13001->3001/tcp` 확인.
- 컨테이너 loopback의 무인증 health 401 및 평문 HTTP MCP 403 확인. 실제 공개 HTTPS endpoint의 무인증 거부는 미수행.
- NAS 커널의 PIDs cgroup 미지원 경고로 `pids_limit:64`가 적용되지 않음. 메모리 제한/로그 회전 실제 적용, NAS reboot/backup restore는 별도 미검증.
- 공개 합성 HTTPS/Grok Custom 인증, 실제 xAI remote MCP, Voice Grok 실제 음성, 한국어 실메일/flags 검증은 여전히 미수행. Grok 웹 인증 증명 전 실계정 공개 라우트와 웹 게이트를 활성화하지 않는다.

## 2026-10-08 OAuth 합성 시험 서버 준비

Grok Custom 초기 화면에는 이름·서버 URL만 있다는 운영자 확인을 바탕으로 별도 OAuth 시험 서버를 구현했다. URL 입력 후 실제 인증 탐색을 확인하기 위한 준비이며 Grok의 인증 방식이나 연결 성공이 입증된 것은 아니다.

- 최종 Python suite: **70 passed, failed/skipped 0**. 기존 48개에 OAuth/SDK 22개 추가. Starlette TestClient/httpx deprecation warning 1개가 남아 있다.
- 공식 MCP SDK OAuth metadata/PKCE S256, public/post/basic client 인증, owner 승인/CSRF/Origin, 1회성 코드, resource/scope, refresh 회전·재사용 탐지·폐기, expiry/restart, HTTPS/Host/body/rate 경계를 검증했다. 인증 성공 후 7개 읽기 전용 도구와 합성 structuredContent를 확인했다. 실제 Grok/IMAP 요청은 수행하지 않았다.
- `tests/verify_oauth_canary.py`: 실제 Docker root/TTY 입력 비노출, scrypt hash만 저장, private 권한, UID 10001/read-only, 별도 authenticated health/무인증 401/평문 MCP 403, 재시작 통과. 실제 계정 private mount는 없다.
- `tests/verify_oauth_nas_stage.py`: 전체 root 스테이징 script를 격리 Docker/중첩 TTY로 실행하여 Compose 시작·재시작, loopback bind와 read-only mounts를 확인했다. NAS 장비 자체의 canary 설치 검증과는 구분한다.
- agent-browser: 명시적으로 신뢰한 로컬 시험 CA를 사용한 HTTPS에서 데스크톱 1280×800·모바일 390×844 승인 화면, 잘못된 암호 안내, 가로 overflow 없음·44px 입력/버튼을 확인하고 두 screenshot을 검토했다. 인증서 검증을 끄지 않았다. `no-referrer`가 브라우저 form POST의 Origin을 null로 만드는 문제를 발견해 `same-origin`으로 수정했다. 외부 사이트로 승인 URL이 전달되지 않는다. 실제 Grok callback 이동은 수행하지 않았다.
- 신규 설치는 별도 프로젝트/bridge, `127.0.0.1:13002`, 후보 HTTPS 8446을 사용한다. 기존 실계정 13001과 private/config를 변경하지 않는다. 원래 검증된 Docker 이미지 ID를 재사용하며 공개 소스만 read-only mount한다. 실계정 공개 gate는 유지한다.
- 앱·Google/TTS 소스는 변경하지 않아 이번 단계에서 JS/TS 450개·앱 build를 재실행한 것으로 표시하지 않는다. 기존 결과는 앞 절의 실행 기록이다.

설치·인증서·DSM 역방향 프록시·시험 종료 절차는 [Synology OAuth 합성 시험 안내](../services/naver-mail/integration/SYNOLOGY_OAUTH_CANARY.md)에 있다. 실제 NAS canary 설치 결과는 아래 운영자 확인 절에 기록한다. 공개 CA HTTPS, Grok 등록/인증/합성 읽기/요약/무인증 거부와 xAI는 **미실행**이다. 승인 암호는 운영자가 SSH에서 숨겨 입력하며 NAS/Naver 계정 비밀번호와 다르게 정한다. OAuth 저장소는 메모리만 사용하므로 재시작 후 다시 연결해야 한다.

## 실제 NAS OAuth canary 설치 — 운영자 화면 확인

운영자가 SSH에서 설치 명령을 실행한 화면에서 다음을 확인했다. 클라우드 에이전트의 직접 NAS 실행 결과가 아니다.

- `CANARY_HEALTH_CHECK=passed`, `CANARY_RESTART_RECOVERY=passed`, `CANARY_STAGING_COMPLETE=yes`.
- 별도 `voice-grok-naver-canary-canary-1` 컨테이너 시작 및 loopback bind `127.0.0.1:13002` 보고. 후보 HTTPS 포트 8446 사전 점검을 통과해 설치가 완료됐다.
- `REAL_MAIL_ACCOUNT_CONNECTED=no`, `PUBLIC_HTTPS_CONFIGURED=no`, `GROK_WEB_VERIFIED=no`. 이 단계에서는 합성 서버 시작만 확인했으며 실제 메일/공개 HTTPS/Grok 연결 성공이 아니다.
- NAS의 PIDs limit 미지원 경고가 canary에서도 발생했다. 해당 제한은 적용되지 않았다. DSM 역방향 프록시·인증서·외부 접속과 인증 검증은 다음 단계다.

## 공개 HTTPS 도달성 점검 — 포트포워딩 설정 후

운영자 화면에서 DSM reverse proxy의 HTTPS DDNS:8446 → HTTP 127.0.0.1:13002와 해당 DDNS 인증서 선택을 확인했고, 포트포워딩 완료를 보고받았다. 선택된 인증서의 외부 chain/기간 검증은 아직 아니다.

- 클라우드 HTTPS 경로로 `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/mcp`를 요청했다. 모두 upstream 연결 timeout에 해당하는 503을 반환했다. 이 응답은 시험 MCP의 인증 응답으로 판단하지 않는다.
- 같은 클라우드 경로의 기존 DSM HTTPS 5119는 HTTP 200을 반환했다. 직접 TCP는 8446·5119 모두 거부되어 직접 경로의 실패만으로 NAS 포트 문제를 확정하지 않는다.
- 외부 NAS TLS 인증서, OAuth metadata, 무인증 MCP 401은 **미검증**이다. 운영자 측 외부 접속 결과와 NAT/firewall 경로를 확인한 뒤 재점검한다. TLS 검증을 끄거나 실계정 13001을 공개하지 않는다.

## 운영자 브라우저 응답과 Grok 첫 연결 실패

- 운영자 모바일 브라우저에서 `/mcp` 요청 후 SDK JSON `invalid_token` / `Authentication required` 화면을 확인했다. 브라우저 주소 표시줄은 호스트만 표시했고 HTTP status/인증서 chain은 화면에 없으므로 401 status나 전체 TLS chain 검사 성공으로 확대하지 않는다.
- Grok Custom에서 시험 URL 등록 후 연결 실패 화면이 나왔다. 승인 화면이나 도구 인식 성공은 확인되지 않았다.
- NAS의 인증된 loopback diagnostic은 registered_clients=0, pending_consents=0, active_grants=0, denied_redirect_origins=[]를 반환했다. 이는 완료된 OAuth 등록/승인/콜백 거부 기록이 없다는 뜻이며, metadata 또는 실패한 등록 요청이 전혀 없었다는 증거는 아니다.
- 클라우드에서 HTTPS 8446 metadata와 `/mcp` 재점검은 upstream timeout 503이었다. 443 metadata도 같은 timeout으로 해당 후보가 사용 가능한 공개 경로라고 판단하지 않는다. 외부 접속 정책과 운영자 측 정확한 metadata 응답은 추가 확인이 필요하다. 실계정 웹 게이트는 유지한다.

## 2026-10-08 방화벽 규칙 적용 후 공개 canary 검증

운영자가 NAS firewall에 시험용 TCP 8446 전체 소스 허용 규칙을 적용했다고 보고한 직후, 동일 클라우드 HTTPS 경로로 재점검했다. 이전 upstream timeout이 정상 응답으로 바뀌었다. 기존 서비스 포트나 실계정 MCP 게이트를 변경하지 않았다.

- `/.well-known/oauth-authorization-server`: **200**. 예상 HTTPS issuer/authorize/token/register/revoke, canary.read 및 PKCE S256 확인.
- `/.well-known/oauth-protected-resource/mcp`: **200**. 정확한 HTTPS `/mcp` resource 및 authorization server 확인.
- 무인증 `/mcp`: **401**, SDK invalid_token/Authentication required와 정확한 resource_metadata challenge 확인.
- 시험용 잘못된 Bearer `/mcp`: **401**. 허용되지 않은 Origin으로 metadata 요청: **403**.
- HTTPS 요청은 기본 TLS 검증을 유지했으며 검증 우회는 사용하지 않았다. 클라우드 HTTPS 프록시 경로에서 수행했다. 직접 TCP/TLS probe는 여전히 거부되어 NAS 인증서 chain/만료일을 직접 socket으로 확인한 결과라고 표현하지 않는다.
- 위 요청은 공개 합성 서버 경계 점검이며 OAuth grant나 실제 메일 읽기를 수행하지 않았다. Grok 웹 실제 인증·도구 인식·합성 읽기/요약은 방화벽 수정 후 재시도해야 한다. 실계정 웹 공개는 계속 보류한다.

## Grok 공식 웹 합성 본문 조회·한국어 요약 — 운영자 화면 확인

방화벽 규칙 적용 후 운영자가 Custom 커넥터 추가 성공을 보고했다. 이어진 실제 Grok 화면에서 다음을 확인했다. 에이전트가 사용자 Grok 계정에 직접 로그인한 결과가 아니다.

- `[CANARY] 한국어 안내`, 합성 보낸 사람과 테스트 본문이 대화 응답에 표시됐다. 시험 데이터는 1개이므로 3개 요청에 1개가 나온 것은 정상이다. 첫 목록 응답의 도구 실행 내역은 접힌 상태여서 개별 목록/검색 호출 기록은 아직 직접 확인하지 않았다.
- 두 번째 응답의 펼친 실행 내역에 **Naver Mail Canary Mail Get Message 사용함**이 표시돼 실제 본문 조회 도구 호출을 확인했다.
- 조회 후 한국어 요약에 합성 메일과 2026년 10월 9일 회의 내용이 표시돼 해당 본문·날짜의 전달/요약을 확인했다. 요약의 부가적인 첨부파일 유무 표현은 attachment 도구 결과로 검증한 것이 아니다. 모든 모델 표현의 정확성을 보장한 것으로 기록하지 않는다.
- OAuth 요구가 있는 공개 합성 서버에서 실제 Grok 도구 호출이 성공한 호환성 증거다. 승인 UI 세부 동작, 사용된 client auth method, 전체 7개 도구 목록, 토큰 만료/갱신·폐기 후 실제 Grok 동작, 양성 한국어·날짜 검색은 아직 별도 확인이 필요하다.
- 합성 테스트 결과이며 실제 네이버 메일/flags/Voice 음성 검증 성공이 아니다. 메모리만 사용하는 canary provider를 그대로 실계정 OAuth 저장소로 전환하지 않는다. production web_auth_verified 및 실제 계정 공개 게이트는 변경하지 않았다.

## Grok 공식 웹 한글 검색·기간 요청 — 운영자 화면 확인

- 펼친 실행 내역에서 **Naver Mail Canary Mail Search 사용함 한국어**를 확인했다.
- 요청은 제목 `한국어`, 2026-10-08부터 2026-10-09 이전까지의 기간이었다. 응답은 합성 보낸 사람, `[CANARY] 한국어 안내`, 2026-10-08 09:00 KST의 **1건**으로 fixture와 일치했다.
- 실제 Grok의 한글 검색 도구 호출과 양성 결과를 확인했다. 화면에는 전체 argument JSON이 없어 since/before 값의 직접 증명이나 제외 경계의 음성 테스트까지 통과한 것으로 확대하지 않는다. 날짜 포함/제외 단위 시험은 이전 자동화 기록이다.
- 합성 Custom 연결·인증이 필요한 도구 접근·본문 조회·한글 검색·한국어 본문/회의 날짜 요약의 기본 호환성을 확인했다. 실제 네이버 MIME/CHARSET/flags, 전체 도구·토큰 갱신/폐기, Voice 실제 음성은 여전히 별도 검증 대상이다.

## 단계 완료 상태와 위험

1. 기존 프로젝트/공식 문서/실제 SDK 버전 조사: 완료.
2. 읽기 전용 IMAP/MCP·인증·Docker 파일: 구현 및 자동 검증 완료.
3. NAS 설치: 실제 준비·네이버 인증·서버 시작/컨테이너 재시작 확인. 별도 합성 서버의 공개 HTTPS metadata/무인증 401 및 잘못된 토큰·Origin 차단 확인. 실제 메일 HTTPS/커넥터·NAS reboot/restore는 미검증.
4. Grok 공식 웹: 방화벽 수정 후 합성 Custom 등록 및 실제 Mail Get Message/한국어 본문·회의 날짜 요약 확인. 실제 한글 Mail Search/기간 요청 양성 결과도 확인. 전체 도구/날짜 제외 경계/실제 토큰 갱신과 실계정 OAuth 경계는 별도 검증 필요. SDK 1.30.0의 2026-07-28 지원도 없으므로 실계정 공개 배포는 계속 보류.
5. Voice Grok: 코드·모의 API·브라우저 경계 검증 완료. 실제 xAI remote MCP response 형식/협상 및 유료 모델/한국어 음성은 다음 단계.
6. 운영/복구 설명서: 작성 완료. 실제 암호화 NAS backup/복구는 미수행.

잔여 위험은 문서상의 xAI MCP 응답과 실제 응답 차이, Grok Custom의 인증 UI/OAuth 요구, 네이버 CHARSET/폴더/플래그 동작, 실제 proxy peer/Origin, NAS port/권한과 native Android 환경이다. Prompt injection의 서버 권한 확대를 차단하지만 모델 요약의 사실성/모든 악성 문구 제거를 보장한다고 주장하지 않는다. credential/토큰은 server private 파일에만 보관하고 xAI/Grok에 전달되는 메일 데이터 범위를 사용자에게 안내해야 한다.

이 브랜치는 배포 준비 구현이며, 프로젝트 전체의 최종 완료 기준인 “NAS 정상 운영 + Grok 웹 실계정 조회 + Voice Grok 실제 음성 조회”는 아직 충족하지 않았다.

## 실제 변경 파일

기존 파일 수정은 아래 3개이며, 나머지는 신규 파일이다. tracked 빌드 산출물 `.vercel/output`과 preview log는 검증 후 원래 상태로 복원하며 commit에 넣지 않는다. `package.json`, 기존 lockfile, Google OAuth, TTS/음악 서비스는 변경하지 않았다.

```text
src/components/reader-app.tsx
src/lib/nas-access.ts
src/routeTree.gen.ts
src/lib/naver-mail-contract.ts
src/lib/naver-mail-client.ts
src/lib/naver-mail.server.ts
src/routes/api/naver-mail.ts
scripts/naver-mail.test.mjs
scripts/naver-mail-ui-qa.json
docs/naver-mail-architecture.md
docs/naver-mail-validation.md
services/naver-mail/.gitignore
services/naver-mail/.dockerignore
services/naver-mail/.env.example
services/naver-mail/Dockerfile
services/naver-mail/compose.yaml
services/naver-mail/config.example.json
services/naver-mail/voice-grok.compose.override.yaml
services/naver-mail/requirements.in
services/naver-mail/requirements.txt
services/naver-mail/test-requirements.in
services/naver-mail/test-requirements.txt
services/naver-mail/README.md
services/naver-mail/RECOVERY.md
services/naver-mail/naver_mail/__init__.py
services/naver-mail/naver_mail/mail.py
services/naver-mail/naver_mail/auth.py
services/naver-mail/naver_mail/server.py
services/naver-mail/naver_mail/health.py
services/naver-mail/naver_mail/manage_tokens.py
services/naver-mail/tests/conftest.py
services/naver-mail/tests/test_mail.py
services/naver-mail/tests/test_mcp.py
services/naver-mail/tests/test_transport.py
services/naver-mail/tests/verify_container.py
```

## 2026-10-08 영구 OAuth 운영 런타임 — 클라우드 검증

공식 SDK의 7개 읽기 전용 도구를 공유하는 dual OAuth/Voice Bearer 서버를 별도 프로젝트로 구현했다. 모드 및 계정에 grant를 묶어 시험 token의 실계정 승격을 금지했다. AES-GCM SQLite 저장소, 동시 code 교환, refresh 회전·재사용 탐지, owner/전체 grant 폐기, xAI 데이터 전달 필수 동의, 숨김 승인 암호 설정과 root 전환 게이트를 추가했다. 기존 SDK/이미지의 hash 잠금은 유지하며 cryptography 50.0.2는 기존 잠금에 이미 포함된 버전을 직접 의존성으로 명시했다.

- Python 전체: **87 passed**, 1 Starlette/httpx 기존 deprecation warning, 실패/skip 없음. Fake IMAP의 UIDVALIDITY·모든 flags·SEEN 유지, 빈 INBOX를 통과시키지 않는 audit 검증 포함.
- `node --test scripts/naver-mail.test.mjs`: **11 passed**. 기존 Voice scope/페르소나/TTS/Google 흐름 계약 회귀 확인. 이번 후속 작업에는 Android/TypeScript 소스를 변경하지 않았으며 전체 앱 빌드·전체 JS suite는 이번 단계에서 재실행하지 않았다.
- `tests/verify_production_oauth_nas_stage.py`: 실제 Docker에서 root/TTY 설치, nonroot/read-only, loopback13003 분리, 원본 private 미mount, SDK 합성 도구 호출, 기존 access token의 restart 복구, refresh 회전 및 replay 후 family 폐기, 새 모드 공개·복귀 및 정책 미동의 거부 통과. 실제 계정은 사용하지 않았다.
- TLS 검증을 유지하고 로컬 test CA를 명시적으로 신뢰한 브라우저 fixture에서 PC 1280×800/모바일390×844 화면 확인. 가로 넘침 없음, 버튼44px, xAI 안내·필수 동의, 틀린 승인 암호 오류 표시 확인. 화면은 합성 데이터만 사용했다.
- 실제 NAS 설치·새 영구 provider의 Grok 연결·실제 네이버 메일 flags audit·실제 Voice 음성/remote MCP는 **미실행**. 기존 실제 canary의 Grok 검색/Get Message/한국어 요약 증거는 새 런타임의 실제 검증으로 대체하지 않는다.

[새 운영 가이드](../services/naver-mail/OAUTH_INSTALL.md)에 설치/시험 프록시 전환/실계정 제한 audit/정책 동의/실계정 전환/폐기/되돌리기와 암호화 백업을 제공한다. 공개 설치물에는 code와 compose/setup helper만 포함하며 private/state/실계정 값은 포함하지 않는다.

## 2026-10-09 실제 NAS OAuth 시험과 audit 호출 수정

운영자가 새 런타임의 `OAUTH_STAGING_COMPLETE=yes`/`MODE=validation` 및 명시적 Docker restart 출력을 제공했다. 재연결 없는 후속 Grok 화면에서 `Naver Mail OAuth Test Mail Get Message 사용함`과 예상 합성 본문이 확인됐다. 실제 NAS의 새 provider 도구 호출 및 재시작 후 연결 사용은 확인했으며 실제 refresh 만료/회전 동작 전체를 입증하지는 않는다.

실제 메일 audit 첫 호출은 `No module named naver_mail.read_only_audit`로 실패했다. 기존 이미지의 WorkingDir `/app`에서 기존 package가 새 `/code` package보다 먼저 선택되는 문제였다. 이 실행에서는 IMAP/mail audit가 시작되지 않았다. 일회성 Docker 호출에 `--workdir /code`를 추가했다. 클라우드에서 동일한 고정 이미지/nonroot/no-network 조건으로 기존 호출 오류를 재현하고 수정 호출의 audit `--help` 기동을 확인했다. 실제 계정의 audit 결과는 여전히 미확인이다. 운영 compose는 원래 working_dir /code로 설정돼 있어 변경하지 않았다.
