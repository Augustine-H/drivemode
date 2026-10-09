# NAS 전체 장애 대체 연결 검토 — 2026-10-09

검토만 수행했다. 유료 서버 생성, 인증정보 이전, 자동 전환 구현은 이번 작업에 포함하지 않는다.

## 현재 구조

- `imhmh.synology.me`의 웹과 NAS API는 NAS 전원/네트워크에 의존한다.
- `drivemode.grok.me`의 앱 호스팅은 별개지만 Google 음성, 직접 네이버 메일, Google 연결, NAS 음악 등은 NAS API에 의존한다. Grok 사이트가 열리는 것과 모든 기능의 독립 운영은 다르다.
- `src/lib/network.ts`의 HTTPS/LAN/Tailscale 순서는 동일 NAS에 대한 접속 방법 전환이다. 별도 서버의 장애 대체 목록이 아니다.
- `services/tts/DEPLOYMENT.md`의 NAS→PC 음성 대체는 NAS 웹 릴레이가 살아 있을 때 유효하다. 전체 NAS 장애에서는 릴레이도 사라진다. cloud 노드는 준비만 되어 있고 아직 생성하지 않았다.
- `src/lib/ask-grok.ts`, `src/lib/tts.ts`는 서버에서 xAI API에 직접 요청할 수 있다. Grok 호스팅의 키 설정과 NAS 우회 선택을 검증하면 기본 대화/음성만 먼저 독립 운영할 수 있다. 실제 NAS 정지 시험을 하지 않았으므로 현재 동작을 보장하지 않는다.

## 권장 구성

Grok 앱 화면 → 독립 HTTPS API 서버 → xAI/Google/네이버. 클라우드 API 서버 자체의 동작에 NAS를 필수 경유지로 두지 않는다. NAS 정상 시에는 NAS를 우선 선택하고 읽기 전용 상태 확인 실패 시 독립 서버로 다음 요청을 보낸다.

| 선택 | 적용 가능 범위 | 조건 |
| --- | --- | --- |
| Grok 서버의 직접 xAI 호출 | 기본 질문·답변과 xAI 음성 | 플랫폼 서버 키/실제 호출 검증, NAS 의존 경로 우회 필요 |
| 별도 Google Compute Engine VM | 음성, 직접 네이버 및 Google API 서버까지 확장 | 지속 디스크, TLS, 소유자 인증, 별도 연결/암호화 저장, 상시 서버 비용 |
| 집의 PC를 독립 API 서버로 운영 | NAS 기기 자체 장애 | PC 전원/로그인·자동 시작·독립 접속 경로 필요. 집 정전/인터넷 장애에는 함께 중단 |

전체 기능 대체에는 Google OAuth 콜백과 토큰 저장, 네이버 계정과 기기 등록, 암호화 키, 음성 사용량 원장, 파일 저장소도 독립 서버에서 준비해야 한다. NAS 전용 음악은 별도 복제 없이는 제공할 수 없다. Grok/NAS의 서로 다른 origin에 저장된 대화와 파일도 자동 공유되지 않는다.

## 구현 시 지켜야 할 사항

- NAS/클라우드 상태를 읽기 전용 요청으로 확인하고 요청 전에 서버를 선택한다. 이미 제출한 메일 발송이나 유료 음성 작업을 다른 서버에 자동 재전송하지 않는다. 발송 결과가 불명확하면 결과 확인 또는 새 확인 과정을 사용한다.
- 서버별 인증·일회용 승인·계정 세대를 유지한다. 실패한 서버의 승인 토큰을 다른 서버에 그대로 재사용하지 않는다.
- 음성 사용량 원장을 복제/초기화하여 한도를 중복 소비하지 않는다. 기존 cloud/nas/pc 예산과 지속 저장 계약을 유지한다.
- 현재 NAS 서버의 지속 파일 저장 구조를 그대로 Vercel 함수에 옮기는 것으로 완료하지 않는다. 첨부 업로드도 별도 설계가 필요하다.

## 공식 자료 확인

- [Google Compute Engine SMTP](https://docs.cloud.google.com/compute/docs/tutorials/sending-mail): 외부 SMTP 587/465에 플랫폼 제한을 두지 않는다. 네이버 계정의 해외 접속 정책과 실제 인증/수신은 새 서버에서 별도로 검증해야 한다.
- [Google Persistent Disk](https://docs.cloud.google.com/compute/docs/disks/persistent-disks): VM용 지속 저장을 제공한다. 백업과 암호화 운영은 별도 구성한다.
- [Vercel Functions 제한](https://vercel.com/docs/functions/limitations): 함수 요청/응답 최대 payload 4.5MB. 현재 큰 메일 첨부를 같은 방식으로 전달하는 서버의 대체에는 추가 업로드 경로가 필요하다.

현재 코드와 운영 준비에 가장 잘 맞는 다음 단계는 독립 클라우드 API 서버다. 기본 대화·음성을 먼저 검증한 뒤 메일/Google 연결, 파일 복제를 단계적으로 붙이는 편이 안전하다. 실제 VM 크기·지역·디스크·IP·전송량을 정한 뒤 견적과 생성 승인을 별도로 받는다.
