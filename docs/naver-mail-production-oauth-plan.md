# 실계정 OAuth 연동의 다음 구현 범위

현재 Grok 웹의 합성 Mail Search/Get Message와 한국어 요약은 확인했다. 운영용 `naver_mail.server`는 역할별 Bearer registry를 사용하고, 실제 Grok이 검증된 `integration.oauth_canary`는 별도 OAuth provider와 합성 데이터만 사용한다. 따라서 canary에 실계정 private를 mount하거나 운영 config의 gate만 바꾸는 방법으로 전환하지 않는다.

## 변경 대상과 보존 경계

- 공식 SDK OAuth 인증을 운영 서버에 추가하되 기존 Voice Bearer identity와 정확한 요청별 scope 검증을 유지한다. 동일 `/mcp`의 실제 읽기 전용 도구를 사용하고 웹/Voice 인증·폐기 정책을 분리한다.
- Canary의 메모리 grant/client 저장소는 실계정 운영용으로 재사용하지 않는다. 서버 재시작·동시 code exchange·refresh replay에 대응하는 제한된 영구 OAuth 상태 저장소를 구현한다. 메일 원문을 이 저장소에 기록하지 않는다.
- 승인용 인증정보는 NAS/Naver 비밀번호와 분리해 NAS private에 숨겨 입력한다. hash·client state·복구에 필요한 비밀은 최소 권한으로 보관하며 채팅/명령행/로그/Git/APK에 넣지 않는다.
- HTTPS/Host/Origin·명시적 callback origin·PKCE·resource/scope·CSRF·요청/결과 크기·인증 시도 제한을 유지한다. 실계정 승인 화면에는 메일이 xAI 데이터 처리 정책의 적용을 받을 수 있음을 안내한다.
- 기존 IMAP EXAMINE/BODY.PEEK, UIDVALIDITY, MIME/HTML 정리, 첨부 metadata, 응답 제한을 재사용한다. 발송/수정/삭제 기능은 추가하지 않는다.
- Google OAuth, 페르소나/TTS/기억 흐름과 기존 NAS proxy/Voice 컨테이너를 변경 범위에서 제외한다. 필요한 Voice 백엔드 설정은 별도 opt-in override로 준비한다.

## 전환 전 필수 검증

1. 기존 Voice scope/토큰·읽기 전용 IMAP 회귀, 운영 OAuth 등록/승인/PKCE/resource 실패 처리, 잘못된 인증 거부.
2. 동시 code 교환, refresh 회전/재사용 탐지·폐기, 제한된 영구 저장소의 재시작 복구, 비밀/메일 로그 비노출.
3. 운영 경로를 합성 계정으로 먼저 시험한 뒤 사용자 요청 범위의 실제 메일만 조회한다. 읽기 전후 SEEN/기타 flags, 한국어 검색/MIME/HTML, 크기 제한을 실제 NAS에서 확인한다.
4. 실제 Grok 읽기와 한국어 요약, 실제 xAI remote MCP/Voice 음성을 구분하여 검증한다. 성공하지 않은 항목은 완료로 표시하지 않는다.

이 문서는 다음 코드 변경의 영향 범위이며, 실계정 OAuth 구현·배포 완료 보고나 비밀 입력 요청이 아니다. 현재 production 웹 게이트와 실계정 공개 설정은 변경하지 않았다.
