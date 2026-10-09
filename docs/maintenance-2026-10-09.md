# 2026-10-09 운영 소스 정리와 MCP 폐기

## 소스와 검증

- 운영 버전 1.34.7의 직접 네이버 IMAP/SMTP 통합 소스를 GitHub main과 codex/public-https에 반영했다(145bbf5).
- 기존에 추적되던 생성된 .vercel/output을 소스 관리에서 제외했다. 로컬 실행 파일은 보존했다. 로그, 첨부와 QA 산출물은 Git 업로드에서 제외한다.
- 테스트 495개, 타입 검사, 기본 운영 빌드 통과. 개발 및 운영 빌드 데스크톱/모바일 렌더링에서 콘솔 오류와 가로 넘침이 없고 기준 화면과 차이가 없다.
- I:/Drivemode-naver 작업 폴더를 삭제했다. 미커밋 및 무시된 파일이 없는 것을 먼저 확인했다. feature/naver-mail-mcp-v1 브랜치와 원격 이력, 기존 태그/설치물 이력은 보존했다.

## NAS MCP 폐기

사용자가 MCP 전용 컨테이너, 이미지, 폴더, 예약 작업, SSH 키의 영구 삭제를 승인했다. 운영 웹/Google/TTS/음악 및 직접 네이버 메일은 보존한다.

- 20:13:22–20:13:34 KST 정상 종료(0): MCP 컨테이너 3개(voice-grok-naver-oauth-mail-oauth-1, voice-grok-naver-canary-canary-1, voice-grok-naver-mail-naver-mail-1), 이미지 voice-grok-naver-mail:1.0.0, /volume1/docker/voice-grok-naver-mail 및 -canary/-oauth/-release 폴더 4개 삭제.
- 20:17:11–20:17:13 KST 정상 종료(0): manhak 계정의 MCP 전용 authorized_keys 항목(codex-naver-mail-nas-2026-10-08) 제거. 다른 키는 보존한다.
- 예약 작업 Task 22, voice-grok-naver-mail-release, naver-mail-nas-ssh, voice-grok-naver-mail-release2 및 Task 21을 대체한 일회성 정리 작업을 삭제했다. 목록에서 5개 모두 사라졌음을 확인했다.
- 각 정리 종료 시 운영 웹 실행 및 /run/google/naver/credentials.enc 존재를 확인했다. MCP 중지 뒤에도 운영 앱의 실제 네이버 목록 조회가 정상이다.
- 사용자 확인 후 Naver MCP Canary 역방향 프록시(HTTPS 8446 → 13003)를 삭제했다. 목록에는 운영 HTTPS 443 → 8097 규칙만 남아 있다.
- 사용자 확인 후 빈 MCP 네트워크 voice-grok-naver-mail_default, voice-grok-naver-oauth, voice-grok-naver-canary를 삭제했다. 각 네트워크의 연결된 컨테이너가 0개임을 먼저 확인했다. 최종 목록에서 MCP 컨테이너/네트워크는 없고 운영 웹·TTS·음악 서비스는 실행 중이다.

## 실제 수신 검증

사용자가 받는 사람=연결된 네이버 본인, 참조=지정한 카카오 주소, 숨은참조=지정한 Gmail 주소와 테스트 제목/본문을 승인했다. 확인 화면과 일회용 실행을 거쳐 메일 1건만 보냈다. 주소와 메일 내용은 이 문서에 기록하지 않는다.

- 20:11:44 KST 네이버 발송 서버 접수 확인.
- 네이버 받은메일함에 실제 도착했고 본문 읽기 뒤에도 안읽음을 유지했다.
- 연결된 Gmail에서 정확한 테스트 제목/날짜 검색으로 실제 수신을 확인했다.
- CC 카카오 받은메일함 및 전달된 원문 BCC 헤더의 직접 확인은 별개다. 로컬 실제 SMTP 프로토콜 테스트에서는 BCC envelope 포함 및 MIME BCC 헤더 비노출이 검증됐다.

## 기기 검증과 이전 배포

실제 휴대폰 마이크로 중요 표시 설정/해제, Wi-Fi→5G 전환 후 음성 응답, 앱 종료·재실행 후 연결/대화 복구는 기기 조작이 필요해 사용자의 검증 결과를 요청했다. 브라우저 새로고침 후 운영 1.34.7과 Google 연결 복구는 확인했다. 자동화 테스트의 네트워크 전환/저장 복구 통과와 실제 5G 검증을 혼동하지 않는다.

drivemode.grok.me는 Grok 로그인 게이트를 표시했다. 접근 가능한 NAS 배포와 별개의 배포이며 현재 Grok 게시 버전은 확인하지 못했다. GitHub push 자체를 Grok 게시 완료로 보고하지 않는다.
