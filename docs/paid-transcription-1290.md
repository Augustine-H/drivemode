# 1.29.0 선택형 유료 가사 받아쓰기

설정 → 음악 생성 · NAS 연결 → 노래 제목·가수 찾기 / 가사 받아쓰기에서 Qwen, OpenAI, xAI, ElevenLabs를 선택할 수 있다. 기본은 로컬 Qwen이다. 채팅·음성 명령으로 유료 모델을 자동 선택하지 않는다.

유료 모델은 예상 비용과 음원 외부 전송 안내를 확인하고 동의를 체크해야 제출할 수 있다. 공급자나 입력 파일을 바꾸면 동의가 초기화된다. NAS가 광고한 사용 가능한 공급자만 선택할 수 있다. 키는 기존 Windows 사용자별 DPAPI 등록 또는 Worker 프로세스 환경변수에서 읽으며 NAS, 브라우저, 소스코드에 전달하지 않는다.

파일 전체 받아쓰기는 최대 10분이다. 유료 경로는 음원을 선택한 공급자에 한 번 전송하며, 실패·타임아웃 시 자동 재시도나 다른 모델로 전환하지 않는다. 요청 전 로컬 시도 기록을 독점 생성한다. 응답이 불확실하면 비용 발생 여부도 불확실하므로 새 요청 전에 상태를 확인해야 한다. 취소해도 이미 공급자에 전송된 요청이나 과금은 되돌릴 수 없다. 작업 종료 후 NAS와 Worker의 입력 음원 필드는 삭제한다. 원문 가사 결과와 비밀정보 없는 처리 기록은 보존한다.

## 실제 연결 검증 — 2026-10-06

기존 Samson Go Mic 일본어 30초 WAV를 앱 화면에서 공급자마다 한 번씩 제출했다. 세 경로 모두 앱 → NAS → Windows child process → 공급자 API → NAS → 앱 결과 표시까지 완료했고 HTTP 200이었다. 유료 처리에는 로컬 GPU 모델 로딩이 필요하지 않다.

| 공급자 | API 왕복 시간 | 예상 USD |
|---|---:|---:|
| OpenAI | 2.332초 | 0.002250 |
| xAI | 1.333초 | 0.000833 |
| ElevenLabs | 1.734초 | 0.001833 |

합계 추정 $0.004916이며 실제 청구액은 확인하지 않았다. 시간은 API 호출 구간이며 전체 대기·전처리·NAS 폴링 시간이 아니다. 10분 입력, 공급자 장애 및 실서비스 중 취소는 이번 실제 음원 검증 범위 밖이다. 동의 차단, 공급자 변경 시 동의 초기화, NAS 결과, 로컬 단일 시도 기록, 양쪽 입력 필드 삭제와 Worker 정상 상태를 확인했다. [집계 기록](./paid-transcription-1290-integration.json)에 음원·가사·키는 포함하지 않았다.

Python 76개 테스트, 음악 관련 TypeScript 11개 테스트, typecheck, production build가 통과했다. 개발·프로덕션 화면은 데스크톱과 모바일에서 렌더링 및 콘솔 오류 검사를 통과했다. 실패·타임아웃·중복 시도 차단은 mock 기반 단위 테스트로 검증했다.

## 일본어 평가 수정

`japanese_evaluation.py`의 새 보조 정책 v2는 줄별로 pykakasi를 적용해 줄바꿈 앞 가나 중복을 방지한다. 일본어에 붙은 영문 `I'm sorry`도 동일한 제한적 표기 진단으로 처리한다. 선택형 평가 의존성은 `services/music/evaluation-requirements.txt`에 고정했다. 엄격 CER이 주 지표이며 사전의 읽기 오류가 가능한 히라가나 진단은 보조용이다. 기존 동결 벤치마크와 무효 표시를 덮어쓰지 않았다. 이 수정은 받아쓰기 모델의 인식률 개선을 의미하지 않는다.

단가와 요청 규격은 [OpenAI 문서](https://developers.openai.com/api/docs/guides/speech-to-text), [OpenAI 가격](https://developers.openai.com/api/docs/pricing), [xAI 문서](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text), [xAI 가격](https://docs.x.ai/developers/models/speech-to-text), [ElevenLabs API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert), [ElevenLabs 가격](https://elevenlabs.io/pricing/api)을 참고한다. 표시 단가는 계정 요금제·청구 단위와 다를 수 있다.
