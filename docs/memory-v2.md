# Voice Grok Memory v2 · 1.22.0

## 조사 결과

조사 기준은 변경 전 `d3e0bf3`이다. React 19 / TypeScript / TanStack Start / Vite 웹 앱이다. 기존 STT 입력 → ReaderApp → xAI Responses SSE → 말풍선 → 문장별 TTS 경로를 유지했다. 네이티브 앱이나 별도 계정/서버 DB는 추가하지 않았다.

| 기존 항목            | 실제 위치와 값                                                                                               | v2                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 일반 질문 API        | `src/routes/api/ask.ts`, `src/lib/ask-grok.ts`, `/v1/responses`, `grok-4.5`, `store:false`                   | 동일 API, 공통 Context Builder                                            |
| 최근 대화            | `ask-prompt.ts`: 마지막 4턴, 공백 정리 후 턴당 180자. ReaderApp 및 메일에서도 4턴 선택                       | 고정 턴 수/180자 절단 제거, 전체 턴을 토큰 예산 안에서 선택               |
| 가져온 페르소나 기억 | `persona-memory.ts`: 최대 60파일, 파일당 16,000자, 합계 60,000자                                             | 기존 파일 호환성과 업로드 보호 한도 유지. 별도의 요약/장기 기억 계층 추가 |
| 기억 검색            | `memoryForQuestion`: 단어·한글 2글자 겹침, 12,000자 기본 한도. 실제 단독/그룹 질문은 4,000/3,000자 + 방 기록 | 메모리 인덱스, 관련도·중요도·최근 사용 시점 점수, 토큰 예산               |
| 페르소나 템플릿      | 최대 60,000자, 요청 검증 61,000자                                                                            | 저장 원본 유지. 요청에는 정의 예산 적용                                   |
| 출력                 | 일반 90 / 최신 정보 140 / 호출 응답 40토큰. 응답 문자열 700자 절단                                           | 일반 512 / 상세 설명 1,024 / 호출 40토큰. 700자 절단 제거                 |
| 저장                 | `nangdok-v1` localStorage 전체 JSON. 폴더 핸들·메일 등은 기존 별도 IndexedDB                                 | 대화/기억/정의/설정을 IndexedDB로 분리. 기존 별도 저장소 유지             |
| 백업                 | `nangdok-backup.ts`: v1, 복원 시 방당 마지막 2,000개만 유지                                                  | schemaVersion 2, 요약·장기 기억·설정 포함, 2,000개 절단 제거              |

기존 Dropbox 요약 업로드용 `summarize-conversation.ts`는 별도 사용자 기능이므로 유지한다. Audio Awareness, 이미지/영상 입력, 웹 검색, 호출, 초대와 전달은 기존 모듈을 유지한다.

## 변경 파일과 역할

| 파일                                                           | 변경 내용                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/lib/context-budget.ts`                                    | 텍스트 토큰 추정, 영역별 예산, 최근 원문 턴 선택                                                     |
| `src/lib/grok-context.ts`                                      | system → developer 페르소나 → user 참고 기억 → user 요약 → 최근 대화 → 현재 질문 통합, 수치 진단     |
| `src/lib/memory-engine.ts`                                     | 세 계층 상태, 발췌 요약, 명시적 기억/선호, 문서 인덱스와 검색                                        |
| `src/lib/use-memory-v2.ts`                                     | 페르소나별 접근 가능한 기록 캐시, 스트리밍 중인 턴 제외, 요약 갱신, 검색 fallback                    |
| `src/lib/app-storage.ts`                                       | IndexedDB 6개 저장소, 원자적 이전, 순차 쓰기, localStorage fallback                                  |
| `src/lib/sentences.ts`                                         | 숫자·날짜의 점을 구분하는 원문 문장 경계                                                             |
| `src/lib/voice-formatter.ts`                                   | 전체 답변에서 음성 문장만 선택, 마크업 제거, 뒤쪽 경고 우선                                          |
| `src/components/memory-settings.tsx`                           | 접힌 기억 설정, 사용량 진단 UI                                                                       |
| `src/components/reader-app.tsx`                                | 초기 이전/저장, 단독·그룹·전달·메일 기억 연결, 전체 표시/음성 분리, 설정 저장·취소 및 백업/삭제 연결 |
| `src/lib/ask-prompt.ts`                                        | 4턴/180자 제거, 전체 답변 지침과 기존 언어·소리·미디어 방어 유지                                     |
| `src/lib/ask-grok.ts`                                          | 비스트리밍 요청 통합, 전체 답변/voiceText/usage 반환                                                 |
| `src/routes/api/ask.ts`                                        | 스트리밍 요청 통합, 전체 텍스트 delta와 별도 voiceText/최종 진단 전송                                |
| `src/lib/ask-stream.ts`                                        | 분리된 텍스트·음성·진단 수신                                                                         |
| `src/lib/transcript.ts`                                        | 기존 Turn에 선택적 voiceText 추가                                                                    |
| `src/lib/use-reader.ts`                                        | 재생 시 voiceText 또는 기존 텍스트 fallback                                                          |
| `src/lib/use-mail-replies.ts`                                  | 메일 답장에도 같은 기억 사용, 최근 턴 예산, 음성 답장에 Voice Formatter                              |
| `src/lib/room-context.ts`                                      | 확정 삭제 후 공유 기록의 접근권도 제거하여 기억 재생성 방지                                          |
| `src/lib/persona-memory.ts`                                    | 기존 기억에 중요도·생성/사용 시각 선택 필드 호환                                                     |
| `src/lib/nangdok-backup.ts`                                    | v1 읽기 호환, schemaVersion 2 출력, 설정 허용 목록, 원문 전부 복원                                   |
| `src/lib/app-meta.ts`, `package.json`, `package-lock.json`     | 앱 버전 1.22.0                                                                                       |
| `scripts/memory-v2.test.mjs`, `scripts/ask-stream-v2.test.mjs` | 신규 16개 회귀 테스트                                                                                |

## Memory v2 구조

- **Recent:** 현재 방의 최근 원문 턴을 전체 문장/턴 상태로 선택한다. 가장 오래된 턴부터 context에서 제외한다. 저장된 원문은 바꾸거나 지우지 않는다. 질문 길이에 따라 선택되는 턴 수가 달라진다.
- **Summary:** 최근 예산에서 제외된, 이 페르소나가 알고 있는 기록을 40턴씩 묶어 약 600추정토큰의 원문 발췌 요약으로 저장한다. 결정·프로젝트·선호·약속·작업 상태 문장을 우선한다. 요약은 로컬 처리이며 자동 외부 AI 요청이 없다. 원본 턴 ID를 보관하고, 생성 실패 시 이전 상태와 원문을 유지한다.
- **Long-Term:** 가져온 MD 기억과 별도로 명시적 기억 요청/명확한 선호 진술을 저장한다. 이 계층은 페르소나 말투/템플릿과 독립적이다. 페르소나 정의 변경은 기억을 지우지 않는다. 확정된 전체 대화 삭제는 해당 앱 대화에서 생성한 기억도 지우며 외부에서 가져온 기억은 기존 정책대로 유지한다.
- **Retrieval:** 페르소나 ID마다 `knownTurns`가 허용한 개인 방·참여한 방·전달 기록만 인덱싱한다. 다른 사람의 비공개 방을 섞지 않는다. 원본을 변경하지 않는 작은 검색 조각을 만든다. 질문에 일치하는 문서를 우선하고, 주제가 생략된 후속 질문에는 최근 맥락을 이용한다. 점수는 질문 겹침×3 + 최근 맥락 겹침×0.5 + 중요도×2 + 최근 사용/생성 시각 감쇠다. 명시적 장기 기억을 사용하면 lastUsedAt를 갱신한다. 매 질문마다 DB 전체를 읽지 않는다.

## Context 구성과 비용

| 순서 | 영역                                                     | 기본 예산 (추정 토큰)                  |
| ---- | -------------------------------------------------------- | -------------------------------------- |
| 1    | 앱 system 지침                                           | 별도 고정 지침                         |
| 2    | 페르소나 developer 정의                                  | 4,000                                  |
| 3    | 관련 장기 기억/접근 가능한 과거 기록/소리 및 미디어 참고 | 2,400                                  |
| 4    | 관련 대화 요약                                           | 1,200                                  |
| 5    | 최근 원문 대화                                           | 6,000, 설정에서 3,000 / 6,000 / 12,000 |
| 6    | 현재 질문                                                | 2,400                                  |

ASCII 약 4자당 1토큰, 비ASCII 코드포인트당 2토큰으로 계산한 **텍스트 추정치**다. xAI 실제 tokenizer가 아니며 이미지·영상 프레임·웹 검색 결과 토큰을 합산한 청구량은 아니다. 전체 진단에는 텍스트 메시지 지침/참고 데이터 래퍼도 포함한다. 실제 출력 토큰은 API usage가 있을 때 별도로 표시한다.

최근 턴은 절단하지 않는다. 너무 큰 턴은 context에서 제외하고 요약/검색 계층을 이용한다. 페르소나·기억·요약·현재 질문은 해당 예산에 맞춰 원문의 일부를 선택하므로 아주 긴 템플릿/질문 전체가 매번 전달되지는 않는다. 입력과 출력 상한이 종전보다 높아 실제 API 비용이 늘 수 있다. 추가 요약 API 호출을 만들지는 않았다. 날씨·뉴스 웹 검색은 종전처럼 요청당 최대 1회다.

기억/요약은 JSON으로 감싼 `REFERENCE_DATA` user 메시지다. 그 내용을 system/developer 지침으로 승격하지 않는다. 상위 앱 지침은 기록 속 명령을 실행하지 않도록 명시한다. 수치 진단만 UI에 표시하고 기억 원문을 console에 출력하지 않는다.

## Full Response / Voice Response

API의 공개 output text 전체를 화면과 대화 기록에 남긴다. 숨겨진 reasoning을 추출하지 않는다. `voiceText`는 별도 필드다. 첫 완성 문장부터 재생하고 첫 두 문장을 순서대로 추가한다. 세 번째 자리는 전체 응답 완료 후 뒤쪽 경고 문장, 없으면 세 번째 문장을 읽는다. 음성은 최대 3개 **전체 문장**이며 TTS의 기존 길이별 전송 조각은 별도다. 단순 700자 절단을 하지 않는다. 숫자/날짜와 문장 끝을 보존하고, 코드·이미지 마크업은 읽지 않는다. 짧은 음성의 핵심을 먼저 말하도록 모델에 지시하며 의미 요약을 위한 두 번째 유료 API 호출은 없다.

기존 '음성만' 표시 옵션은 유지된다. 전체 문자를 보려면 설정의 대화 표시 옵션을 사용할 수 있다. 이전에 저장된 Turn은 voiceText가 없어도 기존 재생 방식으로 읽힌다.

## Migration / 백업

`voice-grok-memory-v2` IndexedDB에는 `conversations`, `summaries`, `personaMemories`, `personaDefinitions`, `settings`, `metadata` 저장소가 있다. 정의 저장소에서 가져온 기억을 분리하고 기억 저장소에서 다시 결합한다. 최초 로드 때 기존 `nangdok-v1`을 읽고 한 readwrite transaction으로 이전한다. 메타데이터도 같은 transaction에 기록하므로 중간 성공 상태를 완료로 보지 않는다. 대화가 threads 없이 turns만 있는 오래된 형식도 보존한다.

기존 localStorage 원본과 별도 설정 키는 지우지 않는다. DB 불가/할당량 오류면 localStorage에 저장하고 최신 fallback 표시를 남긴다. 나중에 DB가 복구되면 이 최신 fallback을 먼저 반영한다. 둘 다 실패하면 살아 있는 대화는 계속하고 파일 백업 안내를 표시한다. 쓰기는 순차 처리하고 UI 갱신은 250ms 묶으며, 창을 떠나거나 숨길 때도 저장을 시도한다. 저장소 업그레이드 시 연결을 닫는다. 브라우저 강제 종료/저장소 삭제까지 영구 보장을 할 수는 없다.

새 파일은 기존 앱/백업 식별자 `app:"nangdok", version:1`을 유지하고 `schemaVersion:2`를 추가한다. personas, threads, roomMembers, memoryV2의 summaries/longTerm/사용 옵션, 허용한 UI/audio settings를 포함한다. v1 파일도 읽고 기본 v2 옵션으로 이전하며 원문 대화를 2,000개에서 자르지 않는다. 인증 토큰·API 키를 새 settings 백업에 넣지 않는다. 기존 페르소나 잠금 필드의 형식은 유지한다.

## Responses API 결정

이미 Responses API를 사용하므로 endpoint를 바꾸지 않았다. 이번에는 `previous_response_id`와 서버 저장을 켜지 않고 `store:false`의 stateless 요청을 유지한다. 방 전환/그룹/전달/로컬 복원에서 연결 상태가 잘못 섞이는 위험과 서버 보존 정책 변경을 피하고 앱의 Memory Engine을 먼저 완성했다.

2026-10-04 확인한 xAI 공식 문서: [Generate text](https://docs.x.ai/developers/model-capabilities/text/generate-text), [API comparison](https://docs.x.ai/developers/model-capabilities/text/comparison), [WebSocket mode](https://docs.x.ai/developers/advanced-api-usage/websocket-mode). WebSocket은 같은 연결에서 store:false 연속 요청을 지원하지만 연결 종료 후 HTTP/재접속 복구와 같은 문제는 별도다. 앱의 장기 기억은 이런 서버 연속성 기능과 독립적이다.

## 검증

- TypeScript 검사, 배포용 build 성공. 변경 코드 lint 오류 없음. 기존 ReaderApp/useReader hook 경고는 남아 있다.
- 신규 16개 테스트: 원문 30턴/180자 이상 보존, 예산, 날짜/소수, 요약/선호, 관련도/중요도/최근 사용, 긴 MD 검색, prompt 역할 경계, 날씨/뉴스, 스트리밍 음성 안정성·경고·코드 블록, 700자 이상 전체 답변, v1/v2 2,100턴 복원, Unicode SSE/usage/연결 오류.
- 관련 기능 테스트는 기존 52개 + 신규 16개 = 68개 성공. 초대/나가기의 기억 권한, 사진·영상 참조와 전달, Audio Awareness, 호출/내비 필터, 페르소나, 메일, 자동/기기 백업 포함.
- 전체 scripts 테스트: 295개 중 285개 성공, 10개 실패. 기존 baseline과 같은 8개 Grok PWA/share-card 기대 제목 불일치와 2개 Windows symlink EPERM이며 Memory v2 추가 실패는 없다.
- 실제 브라우저 격리 테스트 13항목: 2,100턴 legacy→IndexedDB, 가져온 MD/설정/복구 원본, v2 사실/요약 저장·복원, DB 불가 fallback, 이중 저장 실패 보고, 최신 fallback 우선. 이 일괄 저장/읽기 검증은 약 172ms였다 (이 기기의 테스트 데이터 기준).
- 5,000문서 검색 인덱스 생성 약 25–31ms, 20회 질의 평균 1ms 미만 (숫자만 로그). 매 질의 storage read 없음. 5,000개 원문 기반 Context Builder는 약 1ms, 선택된 텍스트 요청 JSON은 17,579바이트였다 (고정 테스트 데이터 기준).
- 실제 UI에서 질문에 최근 원문, 커피 선호와 오래된 프로젝트 결정/요약이 들어가는 것을 확인했다. 700자 이상 전체 답변이 화면에 남고 별도 짧은 음성이 전달되는 것을 확인했다. 모델/TTS 응답은 mock으로 검사하여 유료 요청을 발생시키지 않았다.
- 개발 및 배포 화면 실제 렌더 확인. 배포용 기억 설정 저장·재실행/취소 확인. 390px iframe의 개발/배포 렌더와 가로 넘침 없음 확인. 독립 앱 화면의 uncaught console error 없음. 모바일 iframe 조작은 브라우저 도구 제약이 있어 실제 휴대폰 음성 테스트로 간주하지 않는다.

## 알려진 제한

1. 발췌 요약/키워드 검색은 의미 임베딩이나 생성형 요약이 아니다. 동의어·아주 모호한 지시어·여러 번 바뀐 선호를 완벽하게 해결하지 않는다. 근거 없는 기억을 만들지 않도록 원문을 남긴다.
2. 명시적 기억은 자동으로 오래된 사실을 수정·통합하지 않는다. 중요도/마지막 사용은 검색 우선순위이며 진실 여부의 보증이 아니다.
3. 긴 템플릿의 모든 규칙이나 단일 매우 긴 질문은 기본 context 예산 밖일 수 있다. 가져온 파일 보호 한도는 종전과 같다. 전체 기억 보기/개별 정리 UI와 정확한 tokenizer는 후속 작업이다.
4. Voice Formatter의 경고 선택은 한국어 키워드 규칙이다. 모든 위험 문장/동의어를 의미적으로 판별하지 않는다. 음성은 화면 전체 답변과 길이가 다르다.
5. 처음에는 저장 대화를 한 번 읽고 인덱싱한다. 수천 건의 말풍선 자체 렌더는 기존 UI 방식으로 남아 있으며 가상 목록은 이번 범위에 넣지 않았다.
6. 유료 xAI 실제 응답 품질, 실기기 마이크/STT/TTS, Dropbox 운영 데이터는 이번 자동 검사에서 호출하지 않았다. 기존 관련 로직과 mock 경로를 검증했다.
7. GitHub push와 grok.me 게시 갱신은 별개다. 배포 환경에서 게시를 갱신해야 1.22.0이 공개 사이트에 반영된다.
