# Voice Grok 공인 HTTPS 전환 · 2026-10-09

작업 버전: **1.33.0**, NAS 이미지: `voice-grok-web:1.33.0-https1`.

## 현재 단계

공인 HTTPS를 추가하는 코드 변경이다. 기존 Tailscale Serve, 내부 포트, Google 사용량 DB, 음악 DB, 브라우저 Memory/Media 구조를 보존한다. NAS 배포·DNS·DSM·공유기·인증서는 자동 변경하지 않는다. 실제 도메인과 인증서가 없으므로 외부 TLS 및 S26U 실기 테스트는 아직 완료되지 않았다.

현재 내부 포트는 웹 8097, TTS 8092, 음악 8094이다. 예시의 8765로 변경하지 않는다. 외부는 하나의 HTTPS 호스트의 기본 443을 사용한다. 웹 서버가 음악 `/api/music/health`, `/api/music/v1/jobs` 및 음원 다운로드를 내부 8094로 프록시한다. `/internal/*`은 이 프록시에 등록하지 않는다. Google TTS는 기존 `/api/google-tts`를 통해 기존 백엔드 라우팅을 유지한다.

## [DSM 설정]

1. 기존 웹/TTS/음악 설정과 암호화 복구 백업을 먼저 보관한다. 현재 Tailscale Serve 설정을 제거하거나 수정하지 않는다.
2. **제어판 → 로그인 포털 → 고급 → 역방향 프록시 → 생성**에서 Voice Grok 전용 규칙을 추가한다. 원본은 HTTPS, 확정한 호스트 이름, 포트 **443**. 대상은 HTTP, **127.0.0.1**, 포트 **8097**이다. 대상에 DSM 5000/5001 또는 음악/TTS 포트를 입력하지 않는다.
3. 요청 헤더를 프록시가 설정하도록 한다: `Host`와 `X-Forwarded-Host`는 확정한 호스트, `X-Forwarded-Proto`는 `https`, `X-Real-IP`와 `X-Forwarded-For`는 실제 원격 주소. 외부 요청의 `Tailscale-User-Login`, `Tailscale-User-Name`, `Tailscale-User-Profile-Pic`은 제거/빈 값으로 덮어쓴다. 원래 클라이언트 값을 그대로 전달하지 않는다. 이 서비스의 프록시 헤더 신뢰는 **loopback 수신**을 전제로 한다.
4. 프록시 연결 제한은 5초, 읽기/전송 제한은 130초를 초기값으로 사용한다. 응답 캐시와 스트리밍 응답 버퍼링을 끈다. 채팅/TTS 응답은 `X-Accel-Buffering: no`도 보낸다. DSM UI에서 해당 설정을 제공하지 않는 경우 임의로 DSM 관리 파일을 덮어쓰지 말고 실제 청크 전달 테스트로 확인한다. 별도 Nginx/NPM을 쓰는 운영자는 `services/web/nas/public-https.nginx.conf.example`을 참고한다.
5. HTTP 요청 본문은 **32MiB 이하**, 업로드 대기는 120초로 제한한다. 음악 API는 별도로 25,700,000바이트를 검사한다. 미디어 원본의 200MiB 한도는 브라우저 저장/원본 다운로드 한도이며 범용 NAS 업로드 API 한도가 아니다. 영상 분석은 기존 12MiB 제한을 유지한다. DSM에서 업로드 제한을 설정할 수 없다면 앞단 제한을 검증한 뒤 공개한다.
6. 현재 WebSocket은 사용하지 않는다. SSE/NDJSON은 WebSocket 옵션 없이 동작해야 한다. 향후 WebSocket 추가 시 DSM의 WebSocket 헤더 기능과 `wss://`를 검증한다.
7. NAS 방화벽은 필요한 HTTPS 접근만 허용한다. DSM·SSH·DB·Redis·Docker·Portainer 관리 접근은 기존 사설/Tailscale 정책을 유지한다.

DSM 항목은 설치 버전에 따라 이름이 다를 수 있다. [Synology 역방향 프록시 안내](https://kb.synology.com/index.php/en-us/DSM/help/DSM/AdminCenter/system_login_portal_advanced?version=7), [Nginx 스트리밍·버퍼링·timeout 문서](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

## [공유기 설정]

1. NAS의 내부 주소를 고정 예약하고 **WAN TCP 443 → NAS TCP 443** 규칙만 추가한다. 이미 443을 사용하는 다른 서비스가 있다면 호스트별 프록시 규칙으로 분리하고 기존 서비스를 덮어쓰지 않는다.
2. 8097/8092/8094, 5000/5001, 22, DB/Redis/Docker 포트는 인터넷 포워딩하지 않는다. IPv6도 동일하게 방화벽을 확인한다.
3. 공인 IP/DDNS가 실제로 이 공유기를 가리키는지 확인한다. 통신사의 CGNAT이면 이 포워딩으로 접속할 수 없으므로 공개 가능한 회선/별도 승인된 진입 구조가 먼저 필요하다.
4. 외부 HTTP API는 만들지 않는다. HTTP를 명시적으로 운영해야 하는 경우 HTTPS로만 리디렉션한다. 인증서 발급 방식에서 필요한 포트 예외는 별도로 판단한다.

## [인증서 설정]

1. **제어판 → 보안 → 인증서 → 추가**에서 해당 도메인의 공인 인증서를 등록한다. Let's Encrypt/Synology 지원 인증서 등 신뢰 가능한 체인을 사용한다.
2. **인증서 → 설정**에서 새 Voice Grok 역방향 프록시 호스트에 인증서를 할당한다. 다른 서비스의 인증서 할당을 바꾸지 않는다.
3. 도메인 일치, 전체 체인, 만료일, 갱신 방법을 확인한다. 자체 서명 인증서 경고를 무시하거나 인증서 검증을 끄지 않는다. Unicorn Pro의 HTTPS 필터링과 브라우저 인증서 신뢰는 S26U에서 실제 확인해야 한다.

## [Voice Grok 설정]

1. **NAS 운영자 준비:** 기존 비공개 `runtime.json`에 `publicOrigin`, `sessionSecret`, `pairingHash`, `musicClientToken`을 추가해야 한다. 기존 `login`, `origin`, `backends`, `xaiApiKey`는 그대로 둔다. `sessionSecret`은 64~128자의 안전한 난수 문자열, `pairingHash`는 등록 코드의 SHA-256이다. `musicClientToken`은 기존 NAS 음악 **클라이언트** 키이고 bridge/worker 키가 아니다. 이 값은 소스·로그·배포 ZIP에 넣지 않는다.
2. 운영자용 `prepare-public-config.mjs`는 기존 runtime과 음악 키 파일을 읽어 같은 비공개 폴더에 **후보 파일**과 등록 코드 파일을 만든다. 기존 runtime·서비스·네트워크를 변경하지 않는다. 실제 도메인이 정해진 후 운영자가 비공개 환경에서 수행한다. 사용법: `node prepare-public-config.mjs PRIVATE_RUNTIME HTTPS_ORIGIN PRIVATE_MUSIC_TOKEN PRIVATE_OUTPUT_DIRECTORY`. 후보 내용은 비공개로 검토한 뒤 기존 runtime의 사본을 보존하고 운영자가 적용한다. ZIP에는 이 두 파일을 절대로 포함하지 않는다.
3. 선택적으로 인증서가 유효한 LAN HTTPS 호스트를 `lanOrigin`에 지정할 수 있다. 웹 프로세스는 계속 127.0.0.1:8097에서 수신한다. LAN도 프록시 인증과 올바른 전달 헤더를 사용한다. HTTP LAN에는 공개 인증 쿠키를 보내지 않는다.
4. 새 코드로 NAS 웹 이미지를 빌드/배포한 뒤 기존 config-init 절차로 runtime을 적용한다. 읽기 전용 runtime 볼륨은 원본 파일 변경만으로 즉시 갱신되지 않는다. 서비스 재배포는 운영자가 실행한다. 음악/TTS 데이터 볼륨을 삭제하거나 초기화하지 않는다.
5. Google Cloud OAuth 클라이언트에 **새 호스트의 `/api/google-workspace/callback`**을 승인된 리디렉션 URI로 추가한다. 기존 사설 URI는 제거하지 않는다. 기존 OAuth 암호화 저장소는 유지한다. 새 연결/재동의는 공개 호스트에서 수행한다.
6. 새 공개 주소에서 **기기 등록 코드**를 입력한다. 코드는 브라우저 저장소에 저장하지 않는다. 접근 쿠키는 15분, 갱신 쿠키는 갱신 시점부터 7일이며 Secure/HttpOnly로 관리된다. 쿠키에는 무작위 기기 ID가 연결되고 서명/호스트/만료를 검증한다. 비공개 session secret 교체는 모든 공개/LAN 세션을 무효화한다. 개별 기기 목록/원격 개별 폐기는 이번 구현에 포함하지 않는다.
7. 앱 **설정 → 서버 연결 · HTTPS · 진단**에서 HTTPS 주소를 저장하고 기본 **자동** 모드를 선택한다. LAN과 기존 Tailscale 웹 주소는 같은 NAS에 대한 복구 경로만 등록한다. 자동은 HTTPS → LAN → Tailscale이며 직접 지정한 모드는 다른 경로로 바꾸지 않는다. Tailscale VPN을 앱이 자동으로 켜지는 않는다. 빌드 기본 주소가 필요하면 `VITE_VOICE_GROK_API_BASE_URL`을 사용한다. 서버 측 주소는 비공개 runtime의 `publicOrigin`으로 설정하며 `.env`를 만들지 않는다.
8. LAN 호스트는 그 호스트에서 별도로 기기를 등록해야 한다. 서로 다른 호스트의 인증 쿠키는 공유되지 않는다. HTTPS 화면에서 HTTP 사설 주소는 Mixed Content로 차단되므로 인증된 LAN HTTPS 또는 같은 공인 도메인의 로컬 DNS를 사용한다.
9. 기존 `drivemode.grok.me` 화면에서 설정한 NAS 주소를 API로 사용하는 방법도 지원한다. 정확히 허용한 Origin과 credentialed CORS만 사용한다. 다른 사이트 쿠키를 차단하는 브라우저에서는 인증이 실패할 수 있으므로 공개 호스트 자체에서 사용하는 경로가 가장 안정적이다. **기존 주소의 데이터를 지우지 않는다:** 새로운 origin에는 IDB/OPFS/localStorage가 자동 이전되지 않는다. 기존 화면에서 Memory 백업과 Media 원본/manifest를 내보내고 새 화면에서 복원·원본 검증한다. 기기 등록과 음악 연결 키는 백업에 포함하지 않는다.
10. 기존 음악 작업의 source는 그대로 보존한다. 현재 설정에 등록한 같은 NAS의 경로와 기존 저장 음악 주소에 한해서 조회를 이어갈 수 있다. 생성 POST 전송 실패는 자동 재전송하지 않는다. 불명확한 접수 결과는 기존 요청 번호로 조회/확인한다.

## [S26 Ultra 확인]

1. Unicorn Pro **ON**, Tailscale **OFF**에서 새 HTTPS 주소를 연다. 인증서 경고가 없고 기기 등록이 성공해야 한다.
2. Wi-Fi에서 채팅 첫 글자 시간, TTS 첫 음성 시간과 끊김을 기록한다. Leda 실시간 재생과 기존 WaveNet fallback/80·90·100% 경고는 별도 확인한다. quota 설정·DB를 초기화하거나 한도를 임의로 바꾸지 않는다.
3. LTE/5G에서 같은 검사를 반복한다. Wi-Fi → 5G → Wi-Fi, 화면 꺼짐 후 복귀, 백그라운드 복귀에서도 대화가 보존되고 다음 요청이 재연결되어야 한다. 중간에 끊긴 유료 생성/음성 요청은 중복 방지를 위해 자동 재시작하지 않는다.
4. 이미지·음성·음악·영상의 저장/재생/내보내기·다운로드를 확인한다. 음악/영상 탐색을 확인하고 음원 요청의 Range 응답이 206인지 기록한다. NAS 음악 저장과 기기 파일의 Synology Drive 백업을 구분해서 확인한다. Memory/Media에는 이번 변경으로 범용 NAS 동기화 API를 새로 만들지 않았다.
5. HTTPS 장애 시 **인증된 LAN HTTPS**로 fallback을 확인한다. HTTPS·LAN 장애 시, 필요할 때 기존 Tailscale을 수동으로 사용할 수 있는 환경에서 fallback을 확인한다. Unicorn Pro를 유지한 상태에서 Android Tailscale을 자동 실행하는 것은 목표에 포함하지 않는다.
6. 인증 없는 요청/잘못된 코드/만료 세션 차단, 관리자·internal 경로 접근 차단, 과대 업로드 차단을 확인한다. 진단 복사에는 토큰·본문·음성·Memory 내용이 들어가지 않는다.

## 검증 범위와 남은 작업

| 검사 | 결과 |
|---|---|
| TypeScript | 통과 |
| ESLint | 오류 0, 기존 경고 13 |
| Node 회귀/네트워크 테스트 | 457개 통과 |
| 실제 NAS 음악 API 테스트 | 로컬 임시 저장소/FastAPI에서 12개 통과; 실 NAS 접속 테스트 아님 |
| 기본 Vercel 빌드 및 NAS Node 빌드 | 통과 |
| 개발/운영 빌드 desktop·mobile 렌더 | 내용 표시·가로 넘침 없음·console/page 오류 없음; baseline 일치 |
| NAS 운영 코드 인증 통합 | 등록·갱신·401·CSRF·관리 경로 격리·CORS·기존 Serve 인증 통과 |
| Android APK/AAB 빌드 | Android 네이티브 소스 없음; 대상 아님 |
| 공인 DNS/TLS/DSM/S26U/Unicorn Pro | 설정·실기 검증 대기 |

검증 파일은 `artifacts/public-network-built-verification.json`, `screenshots/https-dev.json`, `screenshots/https-built.json`, `.grok/https-final-tests.log`, `.grok/https-music-tests.log`, `.grok/https-final-lint.log`에 기록되어 있다. 이전의 `npm test`는 Windows에서 인용된 glob 때문에 scripts 테스트를 0개 실행했으므로 이번 변경에서 테스트 파일을 명시적으로 수집하도록 고쳤다. ESLint는 생성된 배포 산출물/가상환경을 제외하고, 기존 빈 catch 5곳의 의도를 주석으로 명시했다. 동작은 변경하지 않았다.

코드 수준: 인증/CSRF/host·device·만료 검증, 자동·수동 fallback, POST 재전송 방지, 음악 Range 전달/초기 청크 전달을 자동 테스트한다. 기존 TTS 테스트는 mock Google 클라이언트로 Leda/WaveNet/ledger 동작을 검사하므로 Google 실제 지연이나 S26U 호환성을 증명하지 않는다.

공인 DNS·공인 TLS·DSM buffering/timeout·Unicorn Pro·Wi-Fi/5G 지연·실제 Google 음성·Synology 외부 백업은 운영 환경 설정 후의 미검증 항목이다. 실기 테스트 A~E가 완료되기 전에는 “전환 최종 완료”로 판단하지 않는다.

[Nginx 업로드 제한 공식 문서](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).
