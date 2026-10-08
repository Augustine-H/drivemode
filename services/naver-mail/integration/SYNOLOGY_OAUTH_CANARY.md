# Synology HTTPS와 Grok OAuth 합성 시험

Grok Custom 초기 화면에서 이름·서버 URL만 확인됐다. 이 사실만으로 Bearer 입력이 불가능하다거나 OAuth 호환성이 입증됐다고 판단하지 않는다. URL 접속 이후 인증 탐색을 실제로 검사하기 위한 별도 합성 시험 서버다.

공식 MCP SDK 1.30.0의 authorization server, client authentication, PKCE S256, resource-bound bearer 검증과 Streamable HTTP를 사용한다. NAS 운영자가 따로 정한 시험용 승인 암호가 있어야 OAuth grant를 발급한다. 실제 네이버/NAS 계정 비밀번호는 이 승인 화면에 입력하지 않는다.

## 격리와 검증 범위

- 새 프로젝트 `/volume1/docker/voice-grok-naver-mail-canary`, 별도 bridge `voice-grok-naver-canary`, loopback `127.0.0.1:13002`를 사용한다. 기존 실제 메일 서비스는 `127.0.0.1:13001`에 유지한다.
- 원래 검증된 Linux amd64 이미지 ID를 재사용하고 공개 canary Python 파일만 별도 read-only로 mount한다. 실제 mail private, `.env`, NAS 관리자 계정은 mount하지 않는다. 앱은 IMAP client를 만들지 않으며 `imap.json`이 존재하는 private 입력을 거부한다.
- 시험 private에는 salt/scrypt hash, 초기 HTTPS issuer/단일 proxy IP config, 별도 health token만 저장한다. 승인 암호 평문은 저장하지 않는다. UID 10001은 읽기만 가능하다.
- OAuth clients/codes/tokens는 bounded memory에만 보관한다. 코드 60초/승인 요청 5분/access 10분/refresh 1시간. 재시작하면 등록과 grant가 사라져 커넥터를 다시 연결해야 한다. 이것은 production OAuth 저장소가 아니다.
- 콜백은 기본적으로 `https://grok.com` origin만 허용한다. 다른 origin을 자동으로 허용하거나 wildcard를 추가하지 않는다. 인증된 NAS 내부 `/diagnostic`는 거부된 origin 이름과 개수만 반환하고 URL query·client secret·토큰·암호를 출력하지 않는다.
- SDK 1.30의 form 모델 호환 보정: Basic 요청의 client ID를 form에 반영하고 revoke의 생략된 optional client_secret은 빈 값으로 보정한다. SDK client authenticator가 기존 method/secret 검증을 그대로 수행한다. Public/Post/Basic의 올바른 인증과 잘못된 secret 거부를 검사한다.
- HTTPS/Host/Origin, 16 KiB 요청 제한, 전체 120/min·동시 처리 4, no-store·외부 referrer 차단(same-origin)·CSP·CSRF cookie를 적용한다. Trusted proxy는 별도 Docker network의 gateway IP 하나다.

OAuth 단위/SDK 시험 및 실제 Docker root/TTY setup, non-root/read-only, health/재시작, 전체 NAS 스테이징 스크립트는 클라우드에서 검사한다. 실제 NAS canary/DSM HTTPS/Grok/xAI 결과는 별도로 기록한다. `grok_web_verified`는 자동으로 true가 되지 않는다. 운영 mail config의 `web_auth_verified:false`도 변경하지 않는다.

## 1. 설치 파일과 SSH 준비

`scripts/build-naver-canary-release.py`는 깨끗한 Git commit의 고정 공개 파일만 tar로 생성한다. Archive UID/GID 0, 파일 0644/폴더 0755를 명시하며 private 파일을 포함하지 않는다. 사용자에게 전달하는 pinned SHA256·고정 commit URL을 확인한 후에만 root 압축 해제한다.

SSH 대화형 터미널에서 `deployment/nas_canary_stage.sh`를 한 번 실행한다. `NAS_CANARY_BUNDLE_SHA256`와 `NAS_CANARY_ISSUER=https://<기존 DDNS>:8446`을 미리 지정하고 bundle을 release 폴더에 준비한다. 값이 아닌 환경 변수 이름을 코드에 저장하며 실제 승인 암호를 script/명령행에 넣지 않는다.

작업은 image ID, 기존 프로젝트/network 보호, 후보 13002·8446 충돌부터 확인한다. 그 뒤 새 소스를 풀고 시험용 승인 암호를 숨겨 두 번 입력받는다. 네이버/NAS 비밀번호와 다른 16자 이상 암호를 정하고 직접 기억한다. DSM 작업 스케줄러는 대화형 입력을 제공하지 않으므로 이 installer를 실행하지 않는다.

`CANARY_OWNER_SETUP=passed`, `CANARY_HEALTH_CHECK=passed`, `CANARY_RESTART_RECOVERY=passed`, `CANARY_STAGING_COMPLETE=yes`가 필요하다. 이 시점의 `PUBLIC_HTTPS_CONFIGURED=no`, `GROK_WEB_VERIFIED=no`는 정상이다. 실패하면 기존 디렉터리를 삭제하거나 installer를 임의로 반복하지 않고 실패 항목을 확인한다.

## 2. DSM 역방향 프록시

DSM 7.2 **제어판 → 로그인 포털 → 고급 → 역방향 프록시 → 생성**에서 새 규칙을 만든다.

| 항목 | 값 |
| --- | --- |
| 이름 | Naver MCP Canary |
| 소스 프로토콜 | HTTPS |
| 소스 호스트 이름 | 기존 인증서의 DDNS 이름 |
| 소스 포트 | 8446 (설치에서 사용 가능 확인 후) |
| 대상 프로토콜 | HTTP |
| 대상 호스트 이름 | 127.0.0.1 |
| 대상 포트 | 13002 |

대상을 실제 mail 13001로 설정하지 않는다. 경로를 `/mcp`만으로 제한하지 않는다. `/.well-known/...`, `/register`, `/authorize`, `/consent`, `/token`, `/revoke`도 같은 소스에서 canary로 전달해야 한다.

사용자 지정 **요청** 헤더에서 `Host`를 `<기존 DDNS>:8446`, `X-Forwarded-Proto`를 `https`로 설정한다. 이미 해당 header가 있으면 값을 확인/수정하고 중복을 만들지 않는다. Authorization 고정 값을 proxy에 추가하지 않는다. NAS backend가 SSL을 검증하는 외부 공개 요청이라는 경계는 정확한 gateway IP와 HTTPS source rule로 구성한다.

**제어판 → 보안 → 인증서 → 설정**에서 새 역방향 프록시에 DDNS 이름과 일치하는 유효한 공개 CA 인증서를 지정한다. 사설/만료/이름 불일치 인증서에서 검증을 끄지 않는다. 기존 DSM/Voice Grok 인증서 연결이나 proxy 규칙을 덮어쓰지 않는다.

외부 접속이 필요한 경우 운영자가 공유기에 **TCP 8446 → NAS 8446**만 추가한다. 기존 DSM 5119/SSH 710 및 다른 서비스 설정은 유지한다. 이 작업은 자동 설치 script에 포함하지 않는다. NAS firewall도 해당 HTTPS 경로의 실제 허용 여부를 확인한다.

## 3. 공개 HTTPS 사전 점검과 Grok 연결

HTTPS certificate 검증 성공과 unauthenticated `/mcp` 401을 확인한 후 Grok Custom에 시험 이름과 `https://<기존 DDNS>:8446/mcp`를 입력한다. 실제 mail URL, 토큰 또는 계정 값을 URL에 넣지 않는다.

OAuth 승인 페이지가 나타나면 **합성 시험 서버 연결 승인** 문구를 확인하고 SSH에서 직접 설정한 시험용 암호만 입력한다. 성공하면 `[CANARY]` 합성 메일 목록·한글 본문·요약을 요청한다. 실제 메일 계정은 연결되지 않은 상태다. 연결/인증/7개 도구/합성 읽기/요약/무인증 401 각각의 실제 결과를 확인한다.

승인 화면이 안 나오거나 연결 실패 시 화면의 오류와 authenticated local diagnostic의 counts/거부 origin을 확인한다. OAuth issuer·callback·client method·프로토콜·NAS proxy를 구분해서 수정하며, 실제 mail 공개나 인증 제거로 우회하지 않는다. 인증 호환성을 입증하지 못하면 실계정 공개 배포를 보류한다.

## 운영 제한

실제 NAS에서 이미 확인된 PIDs cgroup 미지원 때문에 이 시험 Compose의 pids_limit도 적용되지 않을 수 있다. 기존 kernel/서비스를 변경해 경고를 숨기지 않는다. 메모리 384 MiB·read_only·cap_drop·log rotation 설정과 실제 적용은 구분한다.

시험 종료는 **canary 프로젝트의 canary 서비스만** 중지하고 새 proxy/NAT 규칙을 운영자가 제거한다. 실제 mail/Voice Grok 프로젝트에 down/prune/restart를 실행하지 않는다. 저장된 canary private는 승인 암호 hash/health token을 포함하므로 Git·공개 release·로그에 추가하지 않는다.

## 확인된 Grok 결과

2026-10-08 운영자 화면에서 방화벽 8446 허용 후 Custom 추가 성공 보고와 실제 **Mail Get Message** 호출, 합성 한국어 본문·회의 날짜 요약을 확인했다. 이는 합성 서버의 인증된 도구 호환성 증거다. 전체 도구 호출·양성 한국어 검색·실제 token lifecycle·네이버 읽기/flags 검증은 별도이며 production gate를 자동 변경하지 않는다. 구체적인 성공·미검증 항목은 [검증 기록](../../../docs/naver-mail-validation.md)을 기준으로 확인한다.
