# imhmh.synology.me 적용 안내

확정 주소: **https://imhmh.synology.me**. 버전 1.33.0의 NAS 배포 패키지를 사용한다. 이 문서는 입력값을 준비한 것이며 NAS 설정이나 서비스를 변경하지 않았다.

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
