# imhmh.synology.me 적용 안내

확정 주소: **https://imhmh.synology.me**. 버전 1.33.0의 NAS 배포 패키지를 사용한다. NAS 웹 앱 업데이트는 완료했으며 공개 인증 설정·DSM 프록시·공유기·인증서는 아직 변경하지 않았다.

## NAS 배포 결과 · 2026-10-09

DSM `https://imhmh.synology.me:5119`의 기존 로그인 세션으로 확인했다. 기존 역방향 프록시 목록에는 Naver MCP Canary의 8446 규칙 한 개가 있었으며, 이를 변경하지 않았다. 443의 기존 HTTP 응답이 어느 앞단에서 만들어지는지는 이 목록만으로 확정할 수 없다.

웹 프로젝트 `/volume1/docker/voice-grok-web`에 ZIP 업로드 완료를 확인하고 별도 폴더에도 압축을 풀었다. 기존 `app`, `compose.yaml`, `start.mjs`는 각각 `app.bak_https_20261009`, `compose.yaml.bak_https_20261009`, `start.mjs.bak_https_20261009`로 보관했다. 새 앱 파일 적용 후 웹 프로젝트만 일시 중지하고 빌드·재생성했다. 음악/TTS 프로젝트와 비공개 runtime, Google 데이터 볼륨은 유지했다.

DSM 빌드 종료 코드 0, 이미지 `voice-grok-web:1.33.0-https1`, 웹 컨테이너 시작을 확인했다. 기존 Tailscale 앱은 1.33.0을 표시하고 `/health`는 정상 JSON, `/api/network/status`는 `public:false`, `authenticated:true`를 반환했다. Google TTS 상태는 인증/API 정상, 활성 backend NAS, 한도 100000, 초과 유료 사용 OFF였다. 이번 확인에서 유료 채팅·음성 생성을 호출하지 않았다.

실 NAS의 데스크톱·모바일 렌더 검사는 HTTP 200, 표시 내용 있음, 가로 넘침 없음, console/page 오류 없음으로 통과했다. 두 화면을 직접 확인했다. 증거는 `screenshots/https-nas-live.json`, `screenshots/https-nas-live.png`, `screenshots/https-nas-live-mobile.png`에 있다. S26 실제 기기 검증은 아니다.

**남은 순서:** 아래 비공개 공개 인증 설정 준비/적용 → DSM 443 프록시 수동 설정 및 인증서 할당 → Google OAuth 공개 callback 추가 → 공개 경로 인증 검사 → S26 확인. 웹 앱 업데이트만으로 공인 HTTPS가 활성화되지는 않는다.

## 공개 적용 직전 확인

원본 지시서 §32의 자동 변경 금지는 **DSM 방화벽, 공유기 포트포워딩, 인증서**이다. 앞서 DSM 프록시까지 모두 수동 작업이라고 설명한 범위는 지나치게 넓었다. 프록시 규칙은 준비할 수 있지만, 브라우저 자동화의 공개 접근 확대/지속 인증 생성 정책에 따라 실제 적용 직전 확인이 필요하다.

DSM에서 저장하지 않은 `Voice Grok HTTPS` 초안을 준비했다: `https://imhmh.synology.me:443` → `http://127.0.0.1:8097`. Host와 X-Forwarded-Host는 도메인으로 고정, X-Forwarded-Proto는 https, X-Real-IP/X-Forwarded-For는 `$remote_addr`이다. 외부 Tailscale 신원 헤더 3개는 DSM 입력란에서 비인증 값 `-`로 덮어쓰도록 준비했다. 공개 호스트의 인증은 별도 서명 세션을 요구하며 이 신원 헤더로 통과하지 않는다. 연결 5초, 보내기/읽기 130초, HTTP 1.1이다. 현재 DSM UI에는 버퍼링 및 업로드 한도 항목이 없어 적용 후 실제 스트리밍/크기 제한 검증이 필요하다. 아직 저장하지 않았다.

기존 Nginx Proxy Manager의 Compose 매핑은 8180→80, 8181→81, 8443→443으로 확인했다. DSM의 443과는 다른 포트이며 이 프로젝트는 수정하지 않았다. 실제 공유기의 WAN 443 전달 대상은 아직 확인하지 않았다.

공개 인증 설정을 활성화한 후에만 프록시를 적용한다. 새 인증 비밀을 채팅·공개 파일·로그에 넣지 않는다. 기존 인증 없는 공개 API를 임시로 허용하는 방식은 사용하지 않는다.

## 먼저 확인할 기존 서비스

2026-10-09 이 PC에서 확인한 결과: DNS A 조회 성공, HTTPS 인증서 검증 성공, `/`는 403, `/health`와 `/api/network/status`는 404. 이 응답만으로 DSM 설정, 공유기 포워딩 대상 또는 현재 서비스의 정체를 확정할 수 없다. 휴대폰 외부망 검증 결과도 아니다.

DSM 역방향 프록시 목록에서 `imhmh.synology.me:443`을 사용하는 기존 규칙을 확인한다. 기존에 사용하는 서비스가 있으면 덮어쓰지 않는다. 도메인의 전체 `/` 경로를 Voice Grok에 연결하므로 같은 호스트를 다른 앱과 공유하는 경로 구성은 이번 구현의 대상이 아니다. 충돌하는 서비스가 필요하면 별도 호스트를 확정한 후 진행한다.

## NAS 런타임 준비

1. 기존 비공개 runtime과 음악 클라이언트 키 파일을 사용하는 `prepare-public-config.mjs`에 HTTPS 주소 인수로 `https://imhmh.synology.me`를 지정한다. 기존 파일이나 키를 새로 만들거나 초기화하지 않는다.
2. 생성된 비공개 후보에서 `publicOrigin`이 정확히 `https://imhmh.synology.me`인지 확인한다. 기존 `origin`은 Tailscale 주소 그대로 보존한다. session secret, 등록 코드, 음악 키는 문서·ZIP·채팅에 넣지 않는다.
3. 기존 데이터/설정 백업 후 운영자가 후보 runtime과 새 NAS 이미지를 적용한다. 공개 전에는 프록시와 내부 포트의 외부 접근 제한을 확인한다.

## DSM 입력값

| 항목 | 입력값 |
|---|---|
| 이름 | Voice Grok HTTPS |
| 원본 프로토콜 | HTTPS |
| 원본 호스트 이름 | imhmh.synology.me |
| 원본 포트 | 443 |
| 대상 프로토콜 | HTTP |
| 대상 호스트 이름 | 127.0.0.1 |
| 대상 포트 | 8097 |
| Host / X-Forwarded-Host | imhmh.synology.me |
| X-Forwarded-Proto | https |
| 인증서 | imhmh.synology.me에 유효한 기존/신규 공인 인증서 |

실제 원격 IP 헤더 설정, Tailscale 신원 헤더 제거, 버퍼링·캐시 해제, 업로드 한도, timeout은 [전체 전환 안내](public-https-transition.md)의 DSM 항목을 함께 적용한다. 별도 Nginx 운영자는 패키지의 `imhmh.synology.me.nginx.conf.example`을 참고한다. DSM 자동 생성 파일에 붙여 넣지 않는다.

현재 HTTPS 응답이 있으므로 공유기 443 규칙을 무조건 새로 추가하지 않는다. 운영자가 현재 대상이 이 NAS인지 확인한다. 웹 8097, TTS 8092, 음악 8094 및 DSM 관리 포트를 공개하지 않는다.

## Google 및 앱 입력값

- Google OAuth 승인된 리디렉션 URI에 `https://imhmh.synology.me/api/google-workspace/callback`을 추가한다. 기존 Tailscale URI는 유지한다.
- 앱의 HTTPS 서버 주소는 `https://imhmh.synology.me`, 연결 모드는 자동으로 지정한다.
- 기기 등록은 공개 호스트 자체에서 수행한다. 기존 주소의 Memory/Media 데이터는 삭제하지 않고 내보내기·복원 절차로 옮긴다.

## 적용 후 성공 기준

등록 전 `/api/network/status`는 공개 연결 상태 JSON, `/health`는 401을 반환해야 한다. 등록 후 `/health`는 200과 `voice-grok` 상태 JSON을 반환해야 한다. HTML 로그인 페이지나 404 응답은 성공이 아니다.

그다음 S26 Ultra에서 Unicorn Pro ON / Tailscale OFF로 Wi-Fi와 5G의 채팅·TTS 첫 응답, 음악 재생·탐색, 화면 복귀를 확인한다. 현재 확인한 HTTP 응답 시간은 채팅/TTS 지연 측정값이 아니다.
