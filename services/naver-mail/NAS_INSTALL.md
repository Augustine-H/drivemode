# Synology DS218+ 설치 준비

이 단계는 설치 파일·Linux amd64 이미지·오프라인 설정 점검을 준비한다. 실제 NAS 배포, 네이버 로그인, 공개 Tunnel, Grok/xAI 연결은 수행하지 않았다. DSM 버전과 Docker/Container Manager 패키지 지원 여부는 NAS에서 확인해야 한다. 기존 Voice Grok/TTS/음악/백업 프로젝트를 덮어쓰지 않는다.

## 설치 묶음

클라우드에서 생성하는 release 폴더에는 다음 파일만 들어간다.

| 파일 | 용도 |
| --- | --- |
| `naver-mail-source.tar.gz` | 해당 커밋의 MCP 서비스·운영 문서·테스트 도구 |
| `naver-mail-image.tar.gz` | `voice-grok-naver-mail:1.0.0`, Linux amd64, UID/GID 10001 |
| `manifest.json` | 원본 Git 커밋·image ID·소스 SHA256·미검증 상태 |
| `SHA256SUMS` | 전송 후 무결성 점검 |

source 묶음은 전체 Voice Grok 저장소가 아니다. Voice Grok 백엔드 배포 및 Node/Python 전체 테스트에는 해당 브랜치의 전체 체크아웃이 필요하다. private 폴더·실제 `.env`·계정 정보·토큰은 포함하지 않는다. 체크섬은 전송 손상을 확인하며 배포자의 신원을 증명하는 서명은 아니다.

재생성은 전체 저장소의 깨끗한 커밋에서 `python scripts/build-naver-mail-release.py --output <새 release 디렉터리>`로 한다. 준비된 image와 tracked runtime Python 파일/requirements의 SHA256을 비교한다. 기존 release image tag가 다른 이미지를 가리키면 덮어쓰지 않고 실패한다.

## NAS 운영자 절차

2026-10-08 실제 NAS 작업 결과: DSM 7.2 build 64570 update 4, x86_64, `/volume1/docker`가 확인됐고 `0.0.0.0:3001`/`:::3001`에서 이미 listen 중이었다. 기존 3001 서비스를 중지하거나 포트를 변경하지 않는다. 후보 host port는 13001이며 아직 사용 가능 여부를 확인하지 않았다. MCP 컨테이너 내부 port는 계속 3001이다.

첫 점검은 일반 NAS 로그인 사용자로 실행돼 Docker server에 접근하지 못했다. 이는 Docker 미설치나 중지를 확정하는 결과가 아니다. [deployment/nas_inventory.sh](deployment/nas_inventory.sh)를 별도 일회성 작업에서 **root**로 실행해 Docker/Compose, 기존 publish port, 후보 13001을 확인한다. SSH 공개 키 등록 작업은 해당 NAS 로그인 사용자를 유지한다. 점검 스크립트는 설정을 변경하지 않으며 root가 아니면 명시적으로 실패한다. `not_listening`은 그 순간 TCP listener가 없다는 뜻이며 Docker publish port/range도 함께 확인하고 설치 직전에 다시 검사한다.

후속 root 점검에서 Docker 24.0.2 및 Compose v2.20.1-6047-g6817716, 3001을 점유한 `uptime-kuma`, `/volume1/docker`가 확인됐다. 13001 TCP listener는 없었고 전달된 Docker publish 목록에도 13001은 없었다. 이 시점의 점검이므로 실제 시작 직전 다시 확인한다. 기존 `uptime-kuma`/Voice Grok/TTS/music 컨테이너를 변경하지 않는다.

13001을 사용할 때 Compose host port 설정에 `NAVER_MAIL_HOST_PORT=13001`을 적용한다. 서버 내부 health Host는 `127.0.0.1:3001`로 유지하고 NAS의 HTTPS proxy upstream만 host 13001을 사용한다. 후보 포트가 사용 중이면 다른 포트를 점검하며 아직 검증되지 않은 주소를 활성화하지 않는다.

### 작업 스케줄러를 통한 설치 파일 준비

현재 클라우드 SSH 경로로 로그인하지 못했으므로 실제 NAS 작업은 운영자가 일회성 작업 스케줄러로 실행한다. 먼저 File Station의 `docker` 공유 폴더에 `voice-grok-naver-mail-release` 폴더를 만들고 신뢰한 두 archive를 원래 이름으로 업로드한다. 경로는 `/volume1/docker/voice-grok-naver-mail-release`다.

[deployment/nas_stage.sh](deployment/nas_stage.sh)는 root 일회성 작업용이며 신뢰한 archive의 SHA256을 `NAS_RELEASE_SOURCE_SHA256`/`NAS_RELEASE_IMAGE_SHA256` 변수에 미리 넣어야 한다. 클라우드에서 제공하는 맞춤 작업 스크립트에는 확인한 release 해시를 포함한다. NAS에 있는 변경 가능한 SHA256SUMS 파일만 신뢰해서 root 압축 해제를 실행하지 않는다.

작업은 두 파일의 pinned hash를 확인하고, 다른 이미지인 기존 `1.0.0` tag와 이미 존재하는 설치 폴더를 거부한다. 이미지를 import하고 새 `/volume1/docker/voice-grok-naver-mail`에 소스를 풀어 `services/naver-mail/compose.nas.yaml`을 만든다. NAS Compose 2.20 호환성을 위해 별도 YAML에서 host mapping 한 줄만 13001로 고정하며 port merge나 새 `!override` 태그를 사용하지 않는다. Docker CLI plugin과 standalone docker-compose를 모두 검사한다.

Voice·health·웹 토큰은 network-none/non-privileged/read-only-root 설정 관리 컨테이너에서 private 파일로만 생성한다. 검증해 압축 해제한 `naver_mail/manage_tokens.py`를 read-only로 mount해 직접 실행한다. 이미지의 `/app/naver_mail`은 UID 10001 전용 권한일 수 있으므로 capability를 제거한 root 관리 컨테이너에서 `-m naver_mail.manage_tokens`로 import하지 않는다. 이미지 권한을 완화하거나 관리 컨테이너에 추가 capability를 부여하지 않는다. Server 폴더 gid 10001/mode 0750, server 파일 0440, client 폴더 0700 및 token 0600을 설정한다. 초기 config는 loopback Host만 허용하고 trusted proxies는 비우며 웹 게이트는 false다. NAS 운영자용 설정 관리 작업만 root이며 실제 서비스 사용자 10001은 유지한다.

이 작업은 **IMAP 자격증명을 생성하지 않고 서비스를 시작하지 않는다.** `STAGING_COMPLETE=yes`, `SERVICE_STARTED=no`, `IMAP_CREDENTIALS_CONFIGURED=no` 출력 후 실제 네이버 private 설정·점검은 다음 단계다. 기존 파일을 자동으로 덮어쓰지 않으므로 실패 시 임의로 폴더 삭제/재실행하지 않고 실패 항목부터 확인한다.

### 최초 토큰 생성 시 PermissionError 복구

2026-10-08 NAS에서 archive 검증과 image load는 성공했으나, 이전 스테이징 스크립트의 최초 모듈 import가 `/app/naver_mail/__init__.py` PermissionError로 실패했다. 이 보고는 실제 NAS 스테이징 완료를 의미하지 않는다.

수정된 스크립트에 동일한 pinned archive 해시와 `NAS_STAGE_RESUME=1`을 지정하면 이미 압축 해제된 폴더를 보존하며 **토큰 생성 전 상태에 한해** 이어서 진행한다. 별도 root 일회성 작업에서 실행한다. Docker 이미지 재다운로드나 설치 폴더 삭제는 필요하지 않다.

복구는 원본 archive의 모든 소스 파일과 현재 파일을 비교한다. 심볼릭 링크, 변경된 소스·Compose·config, 기존 토큰·IMAP 자격증명·알 수 없는 private 파일을 거부한다. 기존 토큰을 덮어쓰거나 회전하지 않는다. 소스와 private 검사 후 `RESUME_SOURCE_AND_PRIVATE_CHECK=passed`, 마지막에 `STAGING_COMPLETE=yes`를 확인한다. 성공한 프로젝트에는 복구 스크립트를 다시 실행하지 않는다.

클라우드의 실제 Docker에서 `tests/verify_nas_stage.py --release <검증된 release 폴더>`로 새 스테이징, 원래 PermissionError 재현, 중간 상태 복구, 변경된 소스·기존 자격증명·토큰 거부, 토큰 분리 및 파일 권한을 검사한다. 실제 NAS 결과와 구분하며 네이버·Grok·xAI 연결은 하지 않는다.

1. 원래 NAS의 컨테이너·listen 포트·Tailscale Serve/Tunnel·백업 구성을 기록한다. 알려진 포트는 TTS 8092, 음악 8094, 앱 8097, HTTPS 8445다. 실제 3001 사용 여부는 미확인이다. 충돌하면 새 서비스의 host port만 변경한다.
2. 별도 공유 폴더에 네 파일을 전송한다. `sha256sum -c SHA256SUMS`로 점검한다. 경로는 예를 들어 `/volume1/docker/voice-grok-naver-mail-release`다.
3. `docker load -i naver-mail-image.tar.gz`로 이미지를 import한다. Container Manager UI import의 지원 확장자가 다르면 gzip을 풀어 `.tar`를 import한다. image ID는 manifest와 비교한다. 이미지 load만으로 서비스가 시작되거나 공개되지 않는다.
4. `tar -xzf naver-mail-source.tar.gz`로 풀고 `services/naver-mail`로 이동한다. 처음에는 기존 Compose 파일과 병합하지 않고 새 MCP 프로젝트만 구성한다.
5. `private/server`를 새로 만들고 `config.example.json`을 바탕으로 config를 작성한다. `allowed_hosts`에는 health용 `127.0.0.1:3001`을 반드시 포함한다. Host port가 달라도 컨테이너 내부 health port는 3001이다. `web_auth_verified:false`, `token_file:/run/secrets/tokens.json`, `credentials_file:/run/secrets/imap.json`을 유지한다. Origin과 proxy CIDR는 실제 배치에 맞춰 지정한다. 이 초기 점검은 웹 게이트를 켠 설정을 거부한다.
6. NAS의 안전한 관리 경로에서 `private/server/imap.json`의 `username`과 `password`를 입력한다. 네이버 IMAP 활성화와 앱 비밀번호가 필요하다. 채팅·Git·명령행 인자·스크린샷에 값을 넣지 않는다. Shell history에 평문 비밀번호를 남기는 heredoc/echo 명령을 사용하지 않는다.
7. 별도 Voice·health·웹 토큰을 파일로 생성한다. 아래 명령은 값 대신 파일만 생성한다. 기존 NAS 인증 mount를 이 프로젝트에 재사용하지 않는다.

```sh
docker run --rm --network=none --user "$(id -u):$(id -g)" \
  --cap-drop=ALL --security-opt=no-new-privileges:true --read-only \
  -v "$PWD/private:/private" \
  -v "$PWD/naver_mail/manage_tokens.py:/token-helper.py:ro" \
  --entrypoint python voice-grok-naver-mail:1.0.0 \
  /token-helper.py add --registry /private/server/tokens.json \
  --id voice-v1 --client voice --output /private/clients/voice-v1
```

같은 명령의 ID·역할·출력 경로만 바꿔 `health-v1`/`voice`/`/private/server/health-token`, `web-v1`/`grok_web`/`/private/clients/web-v1`를 생성한다. `private/server`는 먼저 만들어 둔다. 초기 token 파일은 0600으로 생성되므로 다음 권한 정리가 필요하다. UID가 없는 DSM 계정이어도 실제 numeric UID/GID로 컨테이너를 실행하며 사용자명 매칭을 가정하지 않는다.

8. 관리자 권한으로 server 디렉터리의 그룹을 10001로 맞춘다. 운영자(또는 root)가 소유하고 gid 10001, 디렉터리 0750, 파일 0440으로 두면 container가 읽고 운영자만 교체할 수 있다. Client token은 별도 0700 폴더·0600 파일로 유지한다. Voice Grok에 설치할 토큰은 별도 앱 UID 1000이 읽을 수 있도록 안전하게 전송/권한 설정하며 server private 전체를 앱에 넘기지 않는다. DSM ACL은 POSIX mode와 별도로 확인한다.
9. 아래 오프라인 점검을 실행한다. 네이버나 HTTPS에 접속하지 않으며 실제 production UID 10001로 private mount를 읽는다. failed면 서비스를 시작하지 않는다.

```sh
docker run --rm --network=none --read-only --user 10001:10001 \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  -v "$PWD/private/server:/run/secrets:ro" \
  -v "$PWD/deployment:/check:ro" --entrypoint python \
  voice-grok-naver-mail:1.0.0 /check/private_check.py
```

`deployment`와 소스 파일은 비밀이 아니며 archive의 0755/0644 권한을 유지한다. 검사 성공은 형식·읽기 권한·분리된 token hashes만 의미한다. 실제 앱 비밀번호 인증, DSM ACL의 다른 사용자 접근, proxy 실제 peer, host port 사용 여부는 이 도구가 확인하지 않는다.

10. Compose v2는 `docker compose`, 구버전 Docker 패키지는 설치된 `docker-compose` 명령으로 문법을 점검한다. 이미지 import 경로에서는 새 빌드를 하지 않는다.

```sh
docker compose config --quiet
docker compose up -d --no-build naver-mail
docker compose exec -T naver-mail python -m naver_mail.health
docker compose restart naver-mail
docker compose exec -T naver-mail python -m naver_mail.health
```

health는 인증된 HTTP 생존 검사이며 네이버 로그인 성공이 아니다. 설치된 Docker가 restart/health/mem_limit/read_only/log rotation 설정을 반영하는지 확인한다. 공개 라우트 없이 loopback에만 노출되어야 한다. raw private 파일이나 container 전체 환경을 로그/채팅으로 출력하지 않는다.

## 공개 연결 전 별도 검증

- 실제 네이버의 한국어·UNSEEN·날짜 검색과 BODY.PEEK 전후 **전체 FLAGS**·UIDVALIDITY 비교.
- 실제 trusted proxy peer, Host/Origin·TLS·무인증 401, 토큰 회전·폐기 확인.
- 실계정과 분리된 공개 합성 canary에서 Grok Custom의 인증 UI/호환성 증명. 증명 전 실계정 공개 라우트와 웹 게이트를 켜지 않는다.
- 실제 xAI remote MCP 협상·scope 헤더·응답 형식 확인 후 기존 NAS 앱에 `voice-grok.compose.override.yaml` 적용. `NAVER_MAIL_ENABLED`는 초기 false로 유지한다.
- [RECOVERY.md](RECOVERY.md)에 따라 private 파일은 인증된 암호화 백업에만 포함하고 새 NAS 폴더에서 복구 검증.

NAS 서비스만 롤백할 때는 해당 프로젝트의 `docker compose stop naver-mail`로 중지한다. 기존 Voice Grok 설정을 적용했다면 `NAVER_MAIL_ENABLED=false`로 돌린다. 공유된 전체 NAS 프로젝트의 `down`, `prune`, 기존 컨테이너 삭제는 하지 않는다. 복구 시 오래된 폐기 토큰을 다시 활성화하지 않는다.
