# Naver Mail MCP 백업·복구

서버는 메일 본문·검색 결과·첨부를 디스크에 캐시하지 않는다. 복구 대상은 이미지/소스/잠금 파일/Compose, private `config.json`, IMAP 자격증명, hash token registry, 별도 health token 및 클라이언트별 token 파일이다. 웹 backend token 파일과 HTTPS proxy/Tunnel 인증 설정도 독립적으로 포함한다. 네이버 메일 자체는 네이버 계정의 데이터이며 이 서비스가 백업하지 않는다.

private 데이터는 **인증된 암호화 백업**에만 넣고 복구 키는 archive와 다른 저장소에 보관한다. 평문 archive, Git, Docker image layer, 공개 배포 ZIP, APK, 로그, 화면 캡처에 넣지 않는다. 기존 Voice Grok encrypted recovery 절차/기존 저장 위치는 이 작업에서 변경하지 않았다. 기존 백업에 새 service/private 경로가 자동 포함된다고 가정하지 말고 NAS 운영자가 경로를 추가한 후 별도 검증한다.

registry/토큰 회전 중에는 서로 다른 세대가 백업되지 않도록 짧게 관리 변경을 중단하고 일관된 파일 묶음을 암호화한다. 네이버 앱 비밀번호가 철회되었거나 토큰이 폐기된 경우 오래된 백업을 그대로 활성화하지 않는다. 폐기 기록을 확인하고 계정 비밀번호와 클라이언트 토큰을 새로 생성한다. `web_auth_verified:false`는 새 공개 환경에 대한 인증 재검증 전 유지한다.

복구 순서:

1. 격리된 NAS 폴더/네트워크에 이미지 또는 hash 잠금 파일로 빌드한 서비스 파일을 복원한다.
2. archive 무결성과 암호화 인증을 확인한 뒤 private 파일을 접근 제한 폴더에 복원한다. UID/GID 10001, server 파일 0440, 폴더 0750, read-only mount를 검증한다. web client token은 web UID만 읽을 수 있는 별도 경로에 복원한다.
3. 실제 listener와 기존 컨테이너를 확인하고 새 loopback host port를 선택한다. 기존 TTS/music/web 구성과 HTTPS proxy 경로를 덮어쓰지 않는다.
4. 외부 공개 전에 인증된 health와 무인증 거부, token 회전, 서버 restart를 검증한다. health는 IMAP 정상 인증을 의미하지 않는다.
5. 격리된 상태에서 계정 인증을 확인하고 선택한 메일의 UIDVALIDITY/FLAGS를 조회 전후 비교한다. UIDVALIDITY가 바뀌었으면 이전 선택을 폐기하고 목록을 다시 읽는다.
6. HTTPS/Origin/proxy 경계를 검사하고 canary로 Grok 웹 인증 호환성을 재확인한 후에만 공개 라우트를 활성화한다. Voice Grok 서버의 MCP 주소와 token file을 업데이트한다.
7. 실제 Voice Grok 요청/음성 및 Google 회귀를 확인한다. 평문 검증 staging과 임시 token을 안전하게 정리하고 외부 클라이언트의 오래된 토큰을 철회한다.

이번 클라우드 작업은 합성 token registry의 재시작/회전과 격리 Docker 재시작을 검증한다. **실제 NAS encrypted backup 생성/복구, 계정 인증, proxy 복구는 수행하지 않았다.**
