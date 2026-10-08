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

## 단계 완료 상태와 위험

1. 기존 프로젝트/공식 문서/실제 SDK 버전 조사: 완료.
2. 읽기 전용 IMAP/MCP·인증·Docker 파일: 구현 및 자동 검증 완료.
3. NAS 설치·HTTPS 노출: 준비 문서만 완료, 실제 설정/실행 미수행.
4. Grok 공식 웹: 미실행. Custom 인증 방식이 불명확하고 SDK 1.30.0의 2026-07-28 지원이 없으므로 실계정 공개 배포 보류.
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
