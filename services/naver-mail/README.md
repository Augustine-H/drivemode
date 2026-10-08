# Naver Mail MCP v1.0 — 개발 구현, 실제 연동 검증 전

Python 3.12 / 공식 `mcp==1.30.0`의 Streamable HTTP `/mcp`, 내부 포트 3001을 사용한다. **실제 네이버 계정, DS218+, Grok 웹, 실제 xAI 호출 및 Android 음성 하드웨어 검증은 이번 클라우드 개발 범위에서 수행하지 않는다.** 기본 Compose는 loopback에만 연결되며 공개 배포를 하지 않는다.

## 구성과 읽기 전용 경계

- `naver_mail/mail.py`: 인증 후 모든 폴더 접근을 `EXAMINE`으로 수행한다. UID `SEARCH`, UID `FETCH`만 허용하며 본문·헤더는 `BODY.PEEK`으로 읽는다. 네이버 계정 권한이 쓰기 가능하더라도 발송/STORE/APPEND/COPY/MOVE/EXPUNGE/DELETE 명령을 제공하지 않는다. `CLOSE`도 호출하지 않는다.
- `naver_mail/server.py`: 7개 조회 도구. 기본 목록 10개, Voice Grok 기본 5개, 상한 20개. folder + UID + UIDVALIDITY로 식별한다. 단일 메일/첨부/스레드 호출에 UIDVALIDITY가 필수이며 변경 시 재조회 오류를 반환한다.
- `naver_mail/auth.py`: HTTPS, 정확한 Host/Origin, Bearer 인증, 토큰별 분당 60회, 동시 HTTP 4개, 16KiB 요청 제한. 인증/환경 구성 오류는 차단한다. Origin 없는 서버 간 요청은 인증을 요구한다. CORS 우회로 접근을 허용하지 않는다.
- 메일 응답은 64KiB 이하. 헤더 8KiB, MIME BODYSTRUCTURE 64KiB, 한 inline 본문의 전송 바이트는 최대 32KiB, 반환 텍스트는 호출당 최대 8,000자. 본문 페이지 `body_offset` 상한 16,000, 최대 24,000자 범위만 제공한다. 큰 메일의 나머지는 원래 메일 서비스에서 확인한다. 결과가 큰 검색은 명시적으로 범위를 좁히도록 오류를 낸다.
- 첨부는 BODYSTRUCTURE의 파일명/형식/크기만 반환한다. 크기는 IMAP의 **전송 인코딩된 octet 수**이며 실제 디코딩된 파일 바이트 수로 표현하지 않는다. 첨부 원본, 외부 URL, 이미지, 스크립트를 내려받거나 실행하지 않는다. HTML은 텍스트로 바꾸며 script/style/iframe/object/svg 및 숨긴 내용 등을 제거한다. 메일 텍스트 자체의 사실성이나 지시를 신뢰한다는 의미는 아니다.
- 관련 메일은 같은 폴더의 Message-ID / References / In-Reply-To가 있을 때만 헤더 검색한다. 서버 THREAD 지원이나 동일 제목만으로 같은 대화라고 추정하지 않는다. 식별자가 없으면 `supported:false`다.
- 목록은 UID 내림차순, `offset` / `next_offset` 페이지 방식이다. 이것은 수신 날짜순 정렬이나 변경 없는 스냅샷이 아니다. 조회 중 새 메일이 생기면 페이지가 이동할 수 있으므로 다시 목록을 조회한다. 날짜 `since`는 포함, `before`는 제외이며 IMAP INTERNALDATE 기준이다.
- 한국어 검색은 각 FROM/SUBJECT/BODY 조건을 UTF-8 IMAP literal로 전송하고 결과 UID를 교집합으로 합친다. 네이버의 실제 CHARSET 지원은 별도 계정 검증 대상이다. 거부 시 오류를 반환하며 검색조건을 조용히 삭제하지 않는다.
- TLS 기본 검증을 유지하며 socket timeout 12초, 작업 시간 예산 25초(진행 중 단일 socket read는 timeout까지 더 걸릴 수 있음), 연결 오류에 한 번 재연결한다. 실패 인증은 재시도하지 않는다. 계정/비밀번호/메일 텍스트/토큰/원시 IMAP 오류를 로그에 기록하지 않는다.

## SDK와 클라이언트 호환성

2026-10-08 공식 문서 조사: 요청된 [MCP 2026-07-28 규격](https://modelcontextprotocol.io/specification/2026-07-28)은 문서에 존재하지만 공식 Python SDK 안정판 1.30.0의 실제 지원 목록은 `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`다. 이 구현은 검증된 `2025-11-25`로 고정하고 SDK를 임의로 패치해 새 규격을 지원한다고 표시하지 않는다. 합성 클라이언트가 2026-07-28로 initialize하면 2025-11-25를 반환하는 협상과, 미지원 버전 HTTP 헤더 거부를 자동 검증했다. **클라이언트가 협상된 구버전을 지원하지 않으면 사용할 수 없다.**

[xAI remote MCP 문서](https://docs.x.ai/developers/tools/remote-mcp)는 Responses API에서 Streamable HTTP/SSE, `server_url`, `server_label`, `allowed_tools`, `authorization`/`headers`를 설명한다. `require_approval`과 `connector_id`는 미지원으로 명시되어 있으므로 보내지 않는다. Voice Grok는 `headers.Authorization`과 별도 scope 헤더를 이용한다. 실제 xAI가 협상하고 tool-call output을 반환하는 형식은 유료 API 통합 검증이 필요하다. 자동 테스트의 xAI 응답은 모의 응답이다.

[Grok 커넥터 문서](https://docs.x.ai/grok/connectors)는 Custom URL과 필요한 인증을 설정하라고 설명하지만 Custom에서 임의 Bearer 헤더나 scope 헤더를 입력할 수 있다는 근거는 제공하지 않는다. 웹 Bearer/OAuth 호환성은 미확인이다. 표준 OAuth 서버/동적 등록은 v1에 구현하지 않았다. 따라서 `web_auth_verified:false`가 기본이고 웹용 토큰은 기본 거부한다. **실제 웹 인증 호환성을 입증할 때까지 실계정 서비스의 공개 배포를 중단한다.** 브라우저/네트워크 인증을 제거하거나 OAuth 로그인을 흉내 내어 해결하지 않는다.

## 클라우드 개발 및 자동 테스트

계정 없이 HTTPS와 공식 MCP SDK의 실제 통신을 점검하는 도구는 [integration/README.md](integration/README.md)에 있다. 합성 데이터로 인증·토큰 회전·프로세스 재시작을 검증하며, 기본 endpoint 점검은 메일을 읽지 않는다.

저장소를 그대로 사용한다. 로컬 PC 파일이나 인증정보가 필요하지 않다.

```sh
cd /workspace/drivemode/services/naver-mail
UV_CACHE_DIR=/workspace/.uv-cache uv venv /workspace/.venvs/naver-mail
UV_CACHE_DIR=/workspace/.uv-cache uv pip sync --python /workspace/.venvs/naver-mail/bin/python --require-hashes test-requirements.txt
PYTHONPATH=. /workspace/.venvs/naver-mail/bin/python -m pytest -q tests
cd /workspace/drivemode
node --test scripts/naver-mail.test.mjs
npm test
npm run typecheck
npm run build
```

프로덕션 잠금 파일과 테스트 잠금 파일에는 전이 의존성 버전과 SHA-256이 포함되어 있다. 일반 NAS 빌드는 `docker compose build`. 클라우드 프록시가 자체 CA를 요구할 때만 신뢰받는 시스템 CA를 **BuildKit secret**으로 제공한다. 인증서/해시 검증을 비활성화하지 않는다.

```sh
DOCKER_CONFIG=/workspace/.onboarding/docker-client docker build \
  --network=host --build-arg HTTPS_PROXY --build-arg HTTP_PROXY --build-arg NO_PROXY \
  --secret id=ca_bundle,src=/etc/ssl/certs/ca-certificates.crt \
  -t voice-grok-naver-mail:test .
DOCKER_CONFIG=/workspace/.onboarding/docker-client \
  /workspace/.venvs/naver-mail/bin/python tests/verify_container.py
```

컨테이너 검증은 합성 계정/임시 토큰, `network=none`, 포트 미노출로 수행한다. 인증된 health, 무인증 health 401, 비특권 실행과 Docker 재시작을 검증하며 네이버 로그인은 하지 않는다. `/health`는 HTTP 서비스 생존만 확인하고 IMAP 연결 성공을 의미하지 않는다.

## NAS 설치 준비 — 실제 실행은 별도 단계

검증된 이미지와 설치 묶음을 사용한 상세 절차는 [NAS_INSTALL.md](NAS_INSTALL.md)에 있다. [deployment/private_check.py](deployment/private_check.py)는 실제 container UID로 private mount 형식·권한을 검사하며 IMAP에 접속하지 않는다.

DS218+는 x86-64 플랫폼이다. 저장소의 기존 서비스 포트는 TTS 8092, 음악 8094, 웹 8097 및 Tailscale HTTPS 8445 등으로 문서화되어 있다. 새 서비스 내부/기본 host 포트는 3001로 선언상 겹치지 않는다. **실제 NAS listener/Container Manager/Serve/Tunnel 설정은 조사하지 않았다.** 설치 전에 `docker ps`, listen socket, 기존 Compose와 HTTPS 경로를 확인하며 기존 서비스를 변경하거나 중지하지 않는다.

1. 별도 `/volume1/docker/voice-grok-naver-mail` 프로젝트로 소스를 설치한다. private 폴더는 배포 archive/Git과 분리한다.
2. `private/server/config.json`은 `config.example.json`을 바탕으로 실제 Host, Origin, proxy 주소를 정확히 설정한다. 원격 클라이언트 TLS 헤더는 **명시한 신뢰 proxy IP/CIDR에서 온 경우만** 신뢰한다. Docker bridge나 tunnel gateway 실제 peer를 확인하고 가능한 `/32`로 제한한다. 전체 인터넷을 trusted proxy로 지정하지 않는다.
3. `private/server/imap.json`에는 `username`, `password` 문자열이 필요하다. 네이버 설정에서 IMAP을 활성화하고 계정의 애플리케이션 비밀번호를 안전한 NAS 관리 경로에서 입력한다. 일반 계정 비밀번호를 사용하거나 채팅/Git에 값을 쓰지 않는다. [네이버 공식 도움말](https://help.naver.com/service/30029/contents/21344)을 실제 계정 설정과 함께 확인한다.
4. token registry에 **서로 다른** Voice Grok 토큰과 웹 토큰을 등록한다. 웹 토큰은 호환성 검증 전 사용할 수 없다. 건강검사 토큰은 voice 역할의 별도 토큰을 만들어 `private/server/health-token`에 저장한다. 값이 아닌 hash만 `tokens.json`에 저장한다.
5. 디렉터리 소유자/그룹을 10001로 맞추고 폴더 0750, server 파일 0440(쓰기 가능한 운영 사본은 관리자가 안전하게 교체)을 사용한다. 컨테이너 UID/GID 10001이 읽을 수 있어야 한다. 운영자에게만 수정 권한을 준다. web 컨테이너의 token은 web UID 1000이 읽을 수 있는 별도 private 경로에 저장한다.
6. `docker compose config --quiet`, 이미지 빌드와 health 검증을 진행한다. restart `unless-stopped`, read-only root, cap-drop, no-new-privileges, 384MiB, PID 64, 로그 5MiB×3을 설정했다. 기존 DS218+ kernel의 CPU CFS quota 이슈를 피하기 위해 CPU quota를 지정하지 않았다.
7. HTTPS proxy/Tunnel은 별도로 준비한다. `/mcp`만 지정된 loopback service로 연결하고 TLS 인증서 검증과 Bearer/Host/Origin 검증을 유지한다. 외부 `/health` 노출은 불필요하다. Cloudflare Access의 대화형 브라우저 인증이 xAI/Grok 서버 요청과 호환된다고 가정하지 않는다. 공개 서비스 대신 먼저 **합성 데이터 canary**로 인증 호환성을 확인한다. Tunnel 자격증명도 private mount로만 제공한다.
8. 실제 Grok Custom이 Bearer를 지원하지 않거나 SDK protocol negotiation이 거부되면 **실계정 공개 연결은 중단**하고 OAuth 또는 다른 지원 방식 구현을 별도 작업으로 진행한다. `web_auth_verified`는 canary에서 인증/무인증 거부/툴 검색이 확인되고 검토된 경우에만 true로 바꾼다.

토큰 관리 명령은 값을 출력하지 않고 private 파일에 쓴다. 운영 설정 편집을 원자적으로 수행하며 동시에 두 운영자가 registry를 수정하지 않는다.

```sh
python -m naver_mail.manage_tokens add --registry private/server/tokens.json \
  --id voice-v1 --client voice --output private/clients/voice-v1
python -m naver_mail.manage_tokens add --registry private/server/tokens.json \
  --id health-v1 --client voice --output private/server/health-token
python -m naver_mail.manage_tokens add --registry private/server/tokens.json \
  --id web-v1 --client grok_web --output private/clients/web-v1
```

회전은 새 ID/토큰 생성 → 대상 클라이언트의 private token 파일 안전 교체 → 새 토큰 호출 확인 → `revoke --registry ... --id old-id` 순서다. registry는 요청마다 재읽으므로 서버 재시작이 필요 없다. atomic replace 후 파일 소유권과 읽기 권한을 다시 확인한다. 폐기된 token을 보관한 클라이언트의 호출은 401이어야 한다. 도구 실행 중인 기존 요청까지 소급 취소하지는 않는다.

## Voice Grok 연결 준비

기존 서버 인증은 loopback Tailscale Serve가 주입한 사용자 identity + 설정된 NAS login/origin을 검증한다. 새 `/api/naver-mail`도 이 경계를 사용하고 Origin을 추가 검사한다. 이것은 인터넷 직접 공개된 앱에 임의 forwarded header를 신뢰하라는 뜻이 아니다. 다른 배포 환경에서는 검증된 앱 사용자 인증 어댑터가 필요하며 기본적으로 403으로 차단된다.

기존 NAS web Compose와 startup/runtime 설정은 수정하지 않았다. `voice-grok.compose.override.yaml`을 기존 web 배포 폴더 옆에 복사하여 두 Compose 파일로 구성한다. 아래 서버 환경 설정이 필요하다.

- `NAVER_MAIL_ENABLED=true`: 운영자가 사용자 데이터 처리 안내 및 인증 준비를 확인한 뒤에만 활성화.
- `NAVER_MAIL_MCP_URL=https://실제주소/mcp`: 공개적으로 xAI 서버가 접근 가능한 인증된 HTTPS 주소.
- `NAVER_MAIL_TOKEN_FILE=/run/naver-client/token`: backend private 파일. `VITE_` 변수, 브라우저, APK, 도구 응답에 값을 제공하지 않는다.
- 기존 `XAI_API_KEY`: 기존 private runtime binding을 사용한다. 새 키를 코드에 넣지 않는다.

네이버 서버의 IMAP 비밀번호는 Voice Grok 서버나 Android에 전달하지 않는다. 앱의 MCP 토큰과 Grok 웹 토큰은 분리하고 서로 다른 ID로 회전한다. 개발 중 모든 기능은 기본 비활성화이며 cloud dev endpoint는 인증되지 않은 요청을 403으로 거부한다.

음성/텍스트 예: “네이버에서 최근 메일 다섯 개 보여줘”, “네이버 메일 안 읽은 목록”, “첫 번째 메일 요약해줘”, “첫 번째 메일 원문 읽어줘”, “첫 번째 메일 첨부파일 목록”. 일반 Gmail/Google/보이스 메일 흐름은 기존 경로를 사용한다. 결과는 별도 임시 패널에 표시하며 설정·페르소나·TTS를 유지한다. 이 메일 원문/요약은 threads/localStorage/sessionStorage/기억/백업으로 전달하지 않는다. 닫기/새로고침 시 결과를 폐기하며 선택 메타데이터도 메모리에만 15분 보관한다. 원문을 별도로 복사하여 저장하는 사용자의 동작까지 막는 것은 아니다.

실행은 모델의 읽기 전용 계획 → 서버 검증 → 하나의 scoped xAI 원격 MCP 호출 → 필요 시 tool 없는 요약 순서다. 첫/번호/마지막 메일의 선택은 서버가 목록과 일치하는지 확인한다. 서버가 승인한 도구+전체 인자를 인증된 scope 헤더로 묶어 다른 UID/폴더 접근을 거부한다. 메일이나 제목의 프롬프트 인젝션은 추가 도구나 비밀 유출 권한을 얻지 못한다. 모델 요약이 항상 정확하거나 모든 악성 문구를 인지한다는 보장은 없으므로 결과는 확인이 필요하다. 실제 메일 데이터는 xAI의 처리 정책을 적용받는다.

## 별도 실제 통합 검증과 보류 조건

실계정 검증에서는 테스트용 메일의 UIDVALIDITY와 **전체 FLAGS**를 먼저 기록하고 목록/검색/읽기/첨부/스레드 후 정확히 비교한다. 테스트 메일을 생성·삭제하는 행위는 이 MCP로 하지 않는다. 사용자가 미리 준비한 메일을 사용한다.

1. 네이버 정상/잘못된 app-password 인증, UTF-8 검색과 한국어 MIME, 날짜/UNSEEN, 원문 BODY.PEEK 후 SEEN 및 기타 flag 유지.
2. NAS의 실제 port 충돌, UID 10001 권한, private mount와 메모리 한도, health, registry 회전, Docker restart 후 auth/flags 보존.
3. 합성 canary HTTPS: 인증 없는 POST/GET/DELETE 차단, 잘못된 Origin/Host와 spoofed proxy 헤더 거부, 크기/빈도 한도 확인.
4. Grok `connectors` → New Connector → Custom: **지원되는 실제 인증 UI 확인**, URL 입력, 도구 7개 인식, 검색·본문·요약, 폐기 토큰/무인증 차단, 협상된 MCP 버전 기록. 실패 시 실계정 공개 배포를 중단하고 원인을 기록한다.
5. Voice Grok: 인증된 NAS 사용자로 텍스트/실제 Android 음성 요청 → 한국어 목록·선택·요약·TTS, 페르소나 유지, Google 회귀, reload/백업/기억에 메일 데이터 없는지 검증. 다른 NAS identity와 Origin은 403, Android network 응답에 backend token이 없는지 검사한다.

각 단계는 실제 성공 후에만 완료로 표시한다. 자동 fixture 시험은 위 통합 성공을 대체하지 않는다. [검증 기록](../../docs/naver-mail-validation.md)과 [백업/복구](RECOVERY.md)를 참고한다.

## 선택 설치: 재시작에 대응하는 OAuth

[OAUTH_INSTALL.md](OAUTH_INSTALL.md)에 별도 13003 시험 모드 설치, Grok 검증, 실계정 읽기 전용 검사와 동의, 전환·되돌리기·폐기·백업 절차를 정리했다. 기존 13001 서버와 Google/TTS 흐름은 유지한다. 새 영구 OAuth 런타임의 실제 NAS/Grok 검증과 실제 메일 flag 검사는 아직 실행하지 않았다.
