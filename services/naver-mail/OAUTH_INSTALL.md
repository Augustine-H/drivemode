# 영구 OAuth 런타임 설치 및 전환

기존 서버와 canary를 유지하는 선택 설치다. 기존 이미지 `voice-grok-naver-mail:1.0.0`의 고정 ID를 확인하고 공개 Python 코드만 읽기 전용으로 추가한다. 새로운 프로젝트는 `/volume1/docker/voice-grok-naver-mail-oauth`, 컨테이너는 `voice-grok-naver-oauth-mail-oauth-1`, 내부 포트는 3001, 호스트 주소는 **127.0.0.1:13003**이다. 3001의 uptime-kuma, 기존 13001 메일 서버, 13002 canary는 변경하지 않는다.

## 1. 시험 모드 설치

공개 설치 명령 파일 전체를 **NAS SSH 터미널**에 붙여 넣는다. Windows PowerShell 프롬프트라면 먼저 `ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -p 710 manhak@imhmh.synology.me`로 접속한다. DSM 작업 스케줄러로 실행하지 않는다.

설치 도중 새로운 메일 접근 승인 암호를 두 번 숨겨 입력한다. 16자 이상이며 NAS·네이버 비밀번호와 다른 암호를 사용한다. 암호, API 키, 개인 키 및 token 값은 채팅이나 Git에 보내지 않는다. 설치는 기존 디렉터리·네트워크가 있으면 중단하며 덮어쓰지 않는다. 실패 시 출력 상태만 전달하고 임의 삭제하거나 재설치하지 않는다.

성공 출력은 `OAUTH_STAGING_COMPLETE=yes`, `MODE=validation`, `REAL_MAIL_ACCOUNT_CONNECTED=no`, `PROXY_CUTOVER_PERFORMED=no`다. 이 단계에는 실제 네이버 인증정보가 mount되지 않는다. 새로운 서버는 합성 메일만 제공한다.

## 2. 새 코드의 실제 Grok 검증

기존 시험 역방향 프록시 `https://imhmh.synology.me:8446`의 대상 포트만 **13002 → 13003**으로 변경한다. 기존 Host/X-Forwarded-Proto 헤더, 인증서, HTTPS 포트포워딩을 유지한다. 원래 메일 서버 13001을 대상으로 지정하지 않는다. 문제 발생 시 프록시 대상을 13002로 돌리면 기존 canary로 복귀한다.

Grok에서 이전 canary 연결을 해제하고 `https://imhmh.synology.me:8446/mcp`를 새로 연결한다. NAS에서 정한 **메일 접근 승인 암호**를 입력한다. 시험 모드 안내가 있어야 한다. 기존 fixture의 한국어 검색, 본문 조회·요약을 재검증한다. 새 컨테이너만 재시작한 뒤 같은 연결에서 조회가 유지되는지 확인한다. 무인증 `/mcp`는 401이어야 한다. 실제 Grok refresh 토큰 사용·만료 복구는 별도로 확인한다.

## 3. 실제 메일 읽기 전용 검사 — 아직 실행하지 않은 별도 단계

아래 명령은 실제 INBOX에서 최근 메일 **최대 한 통**의 제한된 본문과 첨부 metadata를 읽는다. 메일 값은 출력하지 않으며 EXAMINE/BODY.PEEK를 사용한다. 검사 중 다른 메일 클라이언트가 flags를 바꾸면 검사 실패가 가능하므로 재확인한다. INBOX가 비어 있으면 `needs_sample`이며 통과로 처리하지 않는다.

NAS SSH에서 실행한다. 이 문서의 명령은 Docker Compose 플러그인 환경을 기준으로 한다.

```sh
sudo sh -c '
set -eu
umask 077
oauth_project=/volume1/docker/voice-grok-naver-mail-oauth
docker run --rm --read-only --user 10001:10001 --cap-drop=ALL \
  --security-opt=no-new-privileges:true --network=voice-grok-naver-oauth \
  --workdir /code -e PYTHONPATH=/code:/app -v "$oauth_project/code:/code:ro" \
  -v /volume1/docker/voice-grok-naver-mail/services/naver-mail/private/server:/run/mail-private:ro \
  --entrypoint python voice-grok-naver-mail:1.0.0 \
  -m naver_mail.read_only_audit > "$oauth_project/read-only-audit.json"
cat "$oauth_project/read-only-audit.json"
'
```

통과에 필요한 6개 검사는 UIDVALIDITY, SEEN, 기타 모든 flags 유지, 안전한 텍스트, 응답 제한, 첨부 metadata만 조회다. 한 통의 검사 결과이며 계정 전체·모든 메일 형식의 보증이 아니다. 한국어 실제 메일은 별도 검색·요약으로 검증한다.

## 4. 실계정 모드 전환

새 시험 모드의 실제 Grok 검증과 위 검사에 성공한 뒤에만 실행한다. `--acknowledge-xai-policy`는 요청한 메일 내용이 xAI로 전달될 수 있음을 확인하는 운영자 선택이다. 검사 결과는 root 소유이며 10분 이내여야 한다. 오래되면 3단계를 다시 수행한다. 실제 인증정보를 화면에 출력하거나 새 파일에 복사하지 않는다.

```sh
sudo sh -c '
set -eu
oauth_project=/volume1/docker/voice-grok-naver-mail-oauth
docker run --rm --read-only --network=none --user 0:10001 --cap-drop=ALL \
  --security-opt=no-new-privileges:true -v "$oauth_project:/project" \
  -v "$oauth_project/enable-real.py:/enable-real.py:ro" \
  --entrypoint python voice-grok-naver-mail:1.0.0 /enable-real.py \
  --audit-report /project/read-only-audit.json --acknowledge-xai-policy
docker compose -p voice-grok-naver-oauth -f "$oauth_project/compose.yaml" \
  -f "$oauth_project/compose.real-mail.yaml" up -d --no-build --force-recreate mail-oauth
'
```

이 변경은 **새 컨테이너만** 기존 private/server 디렉터리를 읽기 전용으로 mount한다. 시험 모드의 OAuth grant는 자동 폐기된다. Grok에서 새로 연결·승인하고 xAI 데이터 전달 동의를 체크해야 실제 메일을 읽는다. Voice는 기존 서버 측 `voice` registry만 인정하며 web static token은 OAuth 승인을 대신할 수 없다. Android에 서버 token을 전달하지 않는다. 실제 Grok 메일 조회·요약 및 Voice 음성은 실행 결과를 별도로 기록한다.

## 5. 폐기·되돌리기

전체 웹 grant 폐기: `sudo docker exec voice-grok-naver-oauth-mail-oauth-1 python -m naver_mail.oauth_admin revoke-all`. Voice 토큰 회전·폐기는 기존 원본 registry 관리 절차를 이용한다. owner.json의 hash가 안전하게 회전되면 재시작 시 모든 웹 grant가 폐기된다. key 파일을 단순 교체하면 기존 DB를 복호화할 수 없어 서버가 실패하므로 그렇게 회전하지 않는다.

실계정 모드를 되돌릴 때는 다음 순서를 사용한다. 컨테이너를 먼저 중지하고 기본 compose만으로 다시 만들면 실제 private mount가 제거된다. 모드 변경으로 이전 실계정 grant도 폐기된다.

```sh
sudo sh -c '
set -eu
oauth_project=/volume1/docker/voice-grok-naver-mail-oauth
docker compose -p voice-grok-naver-oauth -f "$oauth_project/compose.yaml" stop mail-oauth
docker run --rm --read-only --network=none --user 0:10001 --cap-drop=ALL \
  --security-opt=no-new-privileges:true -v "$oauth_project:/project" \
  -v "$oauth_project/enable-real.py:/enable-real.py:ro" \
  --entrypoint python voice-grok-naver-mail:1.0.0 /enable-real.py --rollback-validation
docker compose -p voice-grok-naver-oauth -f "$oauth_project/compose.yaml" \
  up -d --no-build --force-recreate mail-oauth
'
```

기동 직후 건강 상태가 starting이면 잠시 기다려 확인한다. 인증된 건강 검사: `sudo docker exec voice-grok-naver-oauth-mail-oauth-1 python -m naver_mail.oauth_health`. 실패 시 실계정 연결 성공으로 보고하지 않는다. 프록시는 13002로 복귀할 수 있다.

## 보안·백업 및 검증 범위

- 공식 MCP Python SDK 1.30.0과 잠금된 cryptography 50.0.2를 사용한다. 요청한 미래 규격 이름을 지원했다고 주장하지 않는다. 기존 Grok canary는 실제 도구 실행으로 확인했으며 새 영구 provider는 별도 실제 검증 대상이다.
- client/code/access/refresh 상태만 AES-GCM으로 암호화한 SQLite에 기록한다. 메일 본문·첨부 원본·IMAP 비밀번호는 저장하지 않는다. DB 디렉터리 UID 10001:10001/0700, 파일 0600, private root:10001/0750, private 파일 0440이다.
- HTTPS/Host/Origin, 고정 grok.com callback origin, PKCE/S256, mail.read scope, resource, CSRF를 검사한다. 승인 암호 5회 실패 시 15분 잠금; client/pending/토큰 개수, 요청 빈도·동시 실행·본문 크기를 제한한다.
- access 10분, refresh 24시간, grant family 최대 7일. refresh 재사용 시 해당 family를 폐기한다. 클라이언트는 만료 시 재승인이 필요할 수 있다.
- 백업은 새 컨테이너를 중지한 상태에서 state와 private를 **함께**, 외부에 공개되지 않는 암호화된 NAS 백업으로 보관한다. Git/공개 tar/APK에 포함하지 않는다. 기존 네이버 private는 기존 백업 정책으로 분리 관리한다. 복구 시 권한을 유지하고 시작 후 revoke-all하여 과거 백업 토큰의 부활을 막는다. 메일 원문 백업은 이 서버에서 만들지 않는다.
- Docker 읽기 전용 rootfs, 비특권 UID, cap-drop, loopback publish, 재시작·건강 검사·384MiB 제한·로그 순환을 설정했다. DS218+의 pids_limit 미지원 경고는 별도 운영 제한이며 PID 제한이 적용됐다고 보고하지 않는다.
- 클라우드 자동화: Python 87개, Voice 계약 회귀 11개 통과. 실제 Docker 설치/숨김 TTY 입력/SDK 도구/재시작 후 토큰/refresh 회전·재사용 거부/모드 전환·복귀 통과. PC·모바일 승인 화면, 동의 필수·잘못된 암호 거부 확인. Docker 시험은 합성 계정이며 실제 NAS 설치·새 provider의 Grok 연결·실제 flags 검사는 아직 미실행이다.
