# 네이버 메일 메시지 식별 대안 조사

조사일: 2026-10-09 KST. 기준: `feature/naver-mail-mcp-v1`, 인계 커밋 `e1ef916`.

## 결론과 적용 상태

현재 관찰된 서버 응답만으로 기존 `folder + uidvalidity + uid`의 영구 메시지 식별 보장을 대체할 수 있는 경로는 확인되지 않았다. 실제 계정의 UIDVALIDITY=0 / OBJECTID 미지원 증거는 인계 기록을 사용했으며 같은 진단을 다시 실행하지 않았다.

기존 `ReadOnlyMail.mailbox()`의 nonzero uint32 검사와 SEARCH/FETCH 전 차단을 유지한다. 실계정 OAuth 전환, NAS 설치·배포·재시작, 메일 조회, 고객센터 문의 전송은 수행하지 않았다. NAS 설치 코드와 validation 모드를 수정하지 않았다. 기존 Voice/Google/TTS 코드도 수정하지 않았다.

영구 메시지 식별이 필수라면 공급자의 수정 또는 명시적인 대체 식별 계약이 필요하다. 제한된 내용을 캡처한 뒤 그 캡처만 읽는 별도 기능은 설계 후보가 될 수 있지만, 기존 UID 도구의 호환 구현이나 원래 요구사항의 완료로 취급할 수 없다.

## 실제 코드가 요구하는 보장

- Python `naver_mail/mail.py`: 목록은 `uidvalidity`와 각 UID를 반환한다. 본문·첨부 메타데이터·thread는 받은 epoch를 EXAMINE 응답과 비교한다.
- TypeScript `src/lib/naver-mail-contract.ts`: `NaverMailRef`는 `folder`, `uid`, `uidvalidity`를 필수로 갖는다. 서버는 사용자의 순번 선택을 해당 참조에 묶는다.
- `ReadOnlyMail.run()`은 통신 실패 시 새 연결로 작업을 한 번 재시도한다. 연결 한정 참조를 넣으면 이 재시도 자체의 의미를 바꿔야 한다.
- `message()`는 헤더, BODYSTRUCTURE, 선택한 BODY.PEEK 부분을 별도 명령으로 읽는다. 헤더 해시를 하나 추가하는 것만으로 여러 읽기 사이의 동일 메시지를 보장할 수 없다.
- 현재 본문은 선택한 text MIME 부분의 제한된 바이트만 읽는다. 전체 RFC822 메시지나 첨부 원본은 읽지 않는다. 따라서 전체 내용 해시는 현재 취득 범위 밖이다.
- 테스트의 `uidvalidity_unsupported` 안전성 판정과 원래 UID 계약을 그대로 둬야 한다. 새 식별 유형을 기존 양의 epoch 필드에 넣어서는 안 된다.

## 표준 및 공급자 문서

[RFC 3501 §2.3.1](https://www.rfc-editor.org/rfc/rfc3501.html#section-2.3.1.1)과 [RFC 9051 §2.3.1.1](https://www.rfc-editor.org/rfc/rfc9051.html#section-2.3.1.1)은 UID와 UIDVALIDITY의 조합으로 메시지를 식별한다. UIDVALIDITY는 nonzero 값이며, 메시지의 불변 데이터와 변경 가능한 FLAGS는 구별된다. UIDNEXT나 메일 개수는 이 계약을 대체하는 식별자가 아니다.

[RFC 8474 §4–5](https://www.rfc-editor.org/rfc/rfc8474.html#section-5.1)는 OBJECTID 서버의 MAILBOXID와 EMAILID를 정의한다. EMAILID는 콘텐츠 정체성으로 복사본에 재사용될 수 있어, 독립된 메일함 occurrence의 UID 계약과도 차이를 검토해야 한다. 이 계정은 OBJECTID를 광고하지 않았으므로 현재 활용 가능한 경로가 아니다.

[RFC 5322 §3.6.4](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4)는 Message-ID 생성자의 고유성 책임을 정의한다. 이는 서버가 저장한 메일 복사본의 유일성을 증명하지 않는다. 동일 메시지의 복사, 중복 수신, 잘못된 생성자, 악의적인 헤더 재사용을 구별하는 mailbox ID로 사용할 수 없다.

네이버의 [공개 Open API 목록](https://developers.naver.com/products/intro/plan/plan.md) 및 [API 가이드](https://developers.naver.com/docs/common/openapiguide/apilist.md)에서 일반 개인 메일 읽기 API와 안정 메시지 ID 계약을 확인하지 못했다. 네이버 로그인 프로필의 이메일 주소 권한은 메일 읽기 권한이 아니다. 이것은 공개 목록 조사 결과이며 비공개 API까지 없다는 증명이 아니다. [IMAP 도움말](https://help.naver.com/service/30029/contents/21344)은 웹 도구에서 메뉴만 반환하여 UIDVALIDITY 문제의 공식 해법을 확인할 수 없었다. 고객센터 답변은 아직 없다.

## 대안별 보장 차이

| 후보 | 줄일 수 있는 위험 | 남는 문제 / 결정 |
|---|---|---|
| 0을 1, 시작 시각 또는 로컬 random epoch로 대체 | 없음 | 서버 reset을 관찰할 수 없으며 재사용 UID를 기존 메일로 잘못 식별. 금지 |
| UIDNEXT / EXISTS / 날짜 / 크기 조합 | 일부 변화 탐지 | 동일 값으로 reset·교체 가능. 관찰 값은 generation 증명이 아님. 채택 불가 |
| Message-ID + 헤더 + 크기 + INTERNALDATE 해시 | 일부 다른 메일 거부 | 동일 헤더·크기와 다른 본문, 중복 복사본, ABA 교체, 사전/사후 검사 사이 경합. 동등 보장 아님 |
| 본문 앞부분 해시 + BODYSTRUCTURE | 일부 콘텐츠 변경 탐지 | 제한 이후 본문 또는 첨부만 다른 메일을 구별하지 못함. 동등 보장 아님 |
| 전체 메시지 해시 | 취득한 전체 바이트의 동일성 비교 | 같은 바이트의 두 occurrence 구별 불가. 큰 MIME·첨부 원본 수집이 필요해 현 제한 및 개인정보 범위를 변경. 채택 불가 |
| 동일 연결·EXAMINE 세션에만 유효한 참조 | 재연결 시 잘못된 참조 재사용 방지 | 세션 중 서버 reset/재사용의 보장은 별도로 필요. 연결 유지나 짧은 TTL만으로 서버 계약을 만들 수 없음 |
| 일반 SEARCH/FETCH sequence-number 추적 | 표준 EXPUNGE 처리에 따른 세션 위치 추적 | 위치가 바뀌므로 영구 ID 아님. UID 명령과 EXPUNGE 규칙도 다름. 해당 서버의 세션 준수 확인 전 운영 채택 불가 |
| 메모리에 완성한 캡처 + opaque handle | 후속 요청이 다른 라이브 메일로 바뀌는 것을 방지 | 캡처 시점의 제한된 데이터만 읽음. 현재 메일 상태·원래 occurrence·전체 원문 보장 아님. 별도 계약의 연구 후보 |
| 사용자가 제공한 EML의 제한된 로컬 뷰 | 업로드한 파일의 캡처를 참조 가능 | 라이브 메일 검색·읽음 상태·메일함 identity 기능이 사라짐. 별도 제품 흐름이며 이번에 구현하지 않음 |

해시의 문제는 암호학적 충돌에만 있지 않다. 서로 다른 저장 메시지가 해시 입력 범위에서 완전히 같은 바이트를 가질 수 있다. 비밀 HMAC을 사용해도 이 식별 의미의 문제는 해결되지 않는다.

## 구체적인 반례

1. A의 목록 참조를 만들고 연결이 끊어진다. 서버 복구 후 다른 B에 같은 UID가 할당되고 UIDVALIDITY는 다시 0이다. 임의 epoch나 동일 epoch 캐시는 B를 A로 읽게 된다.
2. A와 B의 Message-ID, 발신자, 제목, 날짜, 크기는 동일하지만 본문은 같은 길이의 다른 문자열이다. 헤더/크기 해시는 둘을 구별하지 못한다.
3. A와 B는 본문 처음 32 KiB가 같고 나머지 또는 첨부만 다르다. 부분 본문 해시는 같으며 전체 메시지 해시는 첨부 비조회 제한과 충돌한다.
4. A의 헤더를 확인한 뒤 본문을 읽기 전에 B로 교체되고, 사후 검사 전에 A와 동일한 관찰 값으로 돌아온다. 전후 해시 비교만으로 중간 결과가 A였다고 증명할 수 없다.
5. 같은 바이트의 메시지를 삭제한 뒤 복사본을 재생성한다. 전체 바이트 해시도 원래 mailbox occurrence가 계속 존재했음을 증명하지 못한다.
6. 다른 클라이언트가 앞 메시지를 expunge하면 순번이 바뀐다. 순번을 후속 요청의 영구 참조로 쓰면 다른 메시지로 이동할 수 있다.

## 별도 스냅샷 계약의 연구 후보

다음은 구현 승인이나 실제 서버 검증 결과가 아니라, 원래 계약을 바꾸는 경우에만 검토할 설계다.

### 사용자에게 약속할 범위

“조회 시점에 캡처한 제한된 내용을 다시 읽기”만 약속한다. “같은 UID의 현재 원문 다시 읽기”나 “메일함에 계속 존재하는 같은 메일”을 약속하지 않는다. 목록의 제목·발신자와 본문이 같은 캡처에서 유래해야 하며, 일부 내용만 취득했다면 `complete=false`와 잘린 범위를 명시한다. 요약/원문 전환은 같은 캡처의 표현 전환이다. 캡처 밖 내용을 읽으려면 새 검색·새 선택이며 기존 본문에 이어붙이지 않는다.

### 취득 과정에서 아직 해결해야 하는 사항

- 목록의 헤더만 저장한 뒤 후속 요청에서 UID를 다시 읽는 방식은 스냅샷이 아니다. 사용자에게 선택 가능한 항목으로 내보내기 전에 그 항목의 제한된 읽기 뷰를 완성해야 한다.
- BODYSTRUCTURE를 알아낸 다음 text 부분을 읽는 다중 명령은 동일성 경합이 남는다. 같은 selected session에서 일반 sequence-number 명령과 EXPUNGE 추적을 적용하는 방안은 [RFC 3501 §7.4.1](https://www.rfc-editor.org/rfc/rfc3501.html#section-7.4.1)의 세션 동작을 전제로 한다. UID 명령에는 다른 EXPUNGE 규칙이 적용된다.
- 해당 서버가 세션 중 번호/불변 데이터 계약을 지킨다는 보장은 현재 증거에 없다. 0 epoch를 허용하는 새로운 reader를 바로 만들어 운영하면 기존 차단을 다른 이름으로 우회하는 결과다. 공급자 확인이나 제한된 별도 실험의 기준 없이 채택하지 않는다.
- 한 FETCH 응답의 일관된 데이터만 캡처하는 방안도 MIME 부분 선택에 선행 structure가 필요하다. 선행 structure와 다른 메시지의 본문을 섞는 문제, 응답 literal을 정확한 항목에 묶는 문제, 태그 완료 전 오류를 검토해야 한다. BODY.PEEK[]/TEXT로 전체 MIME를 받아 나중에 첨부를 버리는 방식은 첨부 원본 비조회 요건을 만족하지 않는다.
- socket 종료/BYE/timeout/reselection/계정·모드 변경/불명확한 EXPUNGE 처리 시 진행 중 캡처는 폐기한다. 기존 `run()`의 재연결 재시도로 옛 참조를 복원하지 않는다. 재시도는 새 검색 전체를 시작해 새로운 뷰로 취급한다.

### 별도 계약과 개인정보

- `reference_kind=content_snapshot`과 서버 발급 opaque random handle을 사용한다. 기존 `uidvalidity` 필드에 값을 넣거나 기존 `mail_get_message(folder, uid, uidvalidity)`의 의미를 변경하지 않는다.
- 서버 RAM만 사용하고 인증 subject, grant family, 계정, 모드, snapshot ID에 범위를 묶는다. handle 자체는 인증을 대체하지 않는다. 모든 조회에 기존 scope/owner/정책 동의를 다시 적용한다.
- 짧은 명시적 TTL, 세션당 항목/바이트 한도, 동시 캡처 제한, 중복 캡처 방지, 만료 정리를 둔다. OAuth 해제·폐기·계정/모드 전환에 관련 캡처를 모두 무효화한다. 프로세스 재시작 후 복구하지 않는다.
- 목록 선택을 위해 최대 페이지의 본문까지 먼저 읽는 것은 기존 헤더 중심 목록보다 수집 범위가 커진다. 필요한 항목 수를 줄이고 사용자 안내·정책 동의 범위를 검토해야 한다. RAM이라고 개인정보 비용이 없는 것은 아니다.
- 본문·헤더·요약·handle은 로그, SQLite OAuth 저장소, 대화 기억, 자동 백업, 브라우저 영구 저장소에 넣지 않는다. 메일별 해시도 영구 index로 저장하지 않는다. RAM 삭제는 일반 Python에서 물리 메모리의 확실한 zeroization을 뜻하지 않는다.
- 목록/본문 pagination은 해당 캡처 내부에서만 수행한다. 새 검색을 이전 snapshot의 다음 페이지인 것처럼 이어붙이지 않는다. 첨부는 같은 캡처에서 얻은 메타데이터만, thread는 근거 헤더의 관련 후보임을 표시하며 서버 보장 identity로 표현하지 않는다.

## 채택 전 필요한 시험

| 시나리오 | 합격 조건 |
|---|---|
| UID 재사용 / mailbox reset / ABA 교체 | stable UID 경로는 계속 차단. 새 설계는 다른 메일로 옛 선택을 해결하지 않음 |
| 연결 종료·재연결·프로세스 재시작 | 이전 세션의 진행 중 캡처/참조 폐기; 옛 handle로 라이브 FETCH 하지 않음 |
| 중복 Message-ID / 동일 헤더·크기 / 동일 전체 바이트 | occurrence와 콘텐츠를 혼동하지 않음; hash만으로 기존 UID 판정 통과 금지 |
| 동시 EXPUNGE / 신규 메일 / mailbox reselection | 세션 번호 추적 또는 안전 중단. UID와 일반 FETCH 규칙을 구별 |
| 큰 MIME / 중첩 multipart / HTML / 부분 transfer encoding | 제한을 넘거나 선택이 불명확하면 중단 또는 명시적 partial. 첨부 원본 조회 없음 |
| cap 초과 / expiry / 권한 폐기 / 계정·모드 전환 | handle 오류와 메모리 폐기, 다른 사용자·grant 간 재사용 불가 |
| 본문 원문/요약/이어읽기 | 동일 캡처에서 반환, 부족한 뒷부분을 다른 라이브 메일에서 채우지 않음 |
| flags 유지 | EXAMINE/BODY.PEEK 사용 및 전후 관찰, 동시 외부 변경과 클라이언트 쓰기를 구분. STORE/APPEND/삭제 명령 없음 |
| 실제 Grok / Voice | 각각 승인된 실제 데이터·정책 동의·음성 검증 필요. 합성 테스트로 성공을 대신하지 않음 |

이번 조사에서는 후보 설계를 코드로 구현하거나 위 시험을 통과했다고 주장하지 않는다.

## 이번 검증 및 다음 결정

- Desktop에서 `node --test scripts/naver-mail.test.mjs`: **11 passed**, 실패/skip 없음.
- Python **90 passed**는 인계 기록의 기존 결과다. 현재 Desktop에는 Python 3.14만 발견됐고 인계의 hash 잠금 Python 3.12 환경은 준비하지 않았다. 이번에 Python 전체 결과를 새로 얻었다고 보고하지 않는다.
- 이번 변경은 조사 문서와 인계 링크뿐이다. 앱 build/typecheck 및 NAS 실제 계정 audit는 재실행하지 않았다.
- `.grok/skills/app-data/SKILL.md`는 feature checkout과 기존 main checkout 모두에서 발견되지 않았다. 이번에는 integration 작성이나 거절 흐름을 진행하지 않고 기존 구현·표준·공급자 문서만 조사했다.
- 다음 우선순위는 기존 [고객센터 문의 초안](naver-mail-imap-support-request.md)을 사용자가 제출해 nonzero UIDVALIDITY 또는 공식 식별 계약에 대한 답변을 받는 것이다. 모델이 문의를 보내지 않았다.
- 공식 해결이 없으면 사용자가 영구 UID 보장과 다른 스냅샷 계약을 수용할지 결정한 뒤, 취득 과정의 세션 보장을 별도 연구해야 한다. 수용만으로 안전성 검증을 대체하지 않는다. 그 전까지 NAS validation 유지 및 실계정 공개 보류.
