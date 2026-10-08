# 네이버 IMAP UIDVALIDITY 동작 문의 초안

아래 문안을 네이버 메일 고객센터에 사용자가 직접 제출할 수 있다. 이 작업에서 문의를 전송하지 않았다. 계정 ID, 비밀번호, 애플리케이션 비밀번호, OAuth token, 메일 내용, NAS 주소 또는 SSH 키를 첨부하지 않는다.

## 문의 문안

네이버 개인 메일 IMAP 서버 `imap.naver.com:993`에서 SSL/TLS 인증 후 INBOX를 읽기 전용 EXAMINE으로 열었을 때 UIDVALIDITY가 0으로 반환되는 것을 확인했습니다.

확인한 사항은 다음과 같습니다.

- TLS 연결 및 애플리케이션 비밀번호 로그인은 성공합니다.
- EXAMINE INBOX 후 UIDVALIDITY 응답은 정수 0입니다.
- 로그인 후 CAPABILITY 점검에서 OBJECTID, CONDSTORE, QRESYNC, IMAP4REV2는 광고되지 않았습니다. 다른 capability 전체가 미지원이라는 뜻은 아닙니다.
- 이 진단에서는 메일 본문 조회, 발송, 삭제, 이동, STORE/APPEND 또는 플래그 변경 명령을 실행하지 않았습니다.

IMAP의 UIDVALIDITY는 메일함 재생성 및 UID 재사용을 구분하는 0이 아닌 32비트 값으로 이해하고 있습니다. 현재 클라이언트는 잘못된 메시지 식별을 방지하기 위해 0 응답 시 메일 조회를 차단하고 있습니다.

다음을 확인해 주실 수 있을까요?

1. UIDVALIDITY=0 반환이 정상 동작인지, 계정/메일함별 문제인지 확인 부탁드립니다.
2. 정상적인 nonzero UIDVALIDITY를 제공받는 공식 설정 또는 해결 방법이 있나요?
3. UIDVALIDITY=0이 의도된 동작이라면, 메일함 재생성·삭제/재생성·서버 복구 후 UID의 재사용 및 식별 안정성에 대한 공식 보장이 있나요?
4. 일반 네이버 메일에서 사용할 수 있는 공식적인 대체 메일함/메시지 고유 식별자 또는 읽기 전용 API가 있나요?

## 참고 및 작업 보류 조건

- [RFC 9051 — IMAP4rev2](https://www.rfc-editor.org/rfc/rfc9051.html): UIDVALIDITY 및 메시지 UID 식별 조건.
- [RFC 8474 — OBJECTID](https://www.rfc-editor.org/rfc/rfc8474.html): capability OBJECTID, MAILBOXID, EMAILID.
- 위 확인은 한 계정의 실제 NAS 진단 결과이다. 네이버 전체 계정의 동일 동작을 일반화하지 않는다.
- CONDSTORE/QRESYNC는 변경 추적 기능으로, 미지원 여부만으로 메시지 식별 문제를 해결하거나 악화한다고 판단하지 않는다. OBJECTID 미지원 때문에 해당 표준 대체 식별 경로는 현재 사용할 수 없다.
- 0을 임의 epoch로 바꾸거나 기존 UIDVALIDITY 검사를 제거하지 않는다. 공식 해결 또는 안전성 요건을 만족하는 별도 설계·검증 전에는 실계정 OAuth 전환/공개를 보류한다.
- 내용/헤더 hash나 단기 스냅샷은 별도 설계 후보일 뿐, 기존 folder+UID+UIDVALIDITY의 의미와 안전성을 동일하게 보장했다고 주장하지 않는다. 실제 계정으로 이 방식을 구현·배포하지 않았다.
