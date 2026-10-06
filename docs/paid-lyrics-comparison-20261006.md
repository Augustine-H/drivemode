# 한국어·영어·일본어 유료 가창 API 비교 준비

2026-10-06, 제품 1.28.2. 사용자는 유료 API 실험을 한국어·영어·일본어 노래로 우선 진행하도록 요청했다. 같은 입력의 로컬 Qwen 기준 검증은 완료했고 유료 비교 입력·요청 코드도 준비했다. 현재 PC의 프로세스/사용자/시스템 환경변수와 해당 작업의 암호화 저장소에는 API 키가 없어 실제 유료 호출은 0회다. 외부 음원 전송과 과금도 실행하지 않았다. 유료 인식률 개선이나 비교 완료를 주장하지 않는다.

## 고정 입력과 Qwen 기준

| 입력 | 길이 | 현재 Qwen 결과 | 정답 범위 |
|---|---:|---:|---|
| 사용자 한국어 실제 녹음 | 30초 | 받아쓰기 출력 확보, CER 미산출 | 기존 사용자 가사의 정확한 녹음 끝 구간이 미확정. 긴 정답에 맞춰 출력이나 음원을 임의로 자르지 않음 |
| Auld Lang Syne 가창 | 25초 | WER 4.76%, 21단어 중 오류 1개 | 기존 고정 구간 정답 및 원본 timed lyrics 기준 |
| Pretender 사용자 일본어 녹음 | 35.968초 | 엄격 CER 4.81%, 104자 중 오류 5개 | 기존 전체 녹음에 대응한 사용자 일본어 원문 기준, 새 원어민 청취 검수는 미실시 |

Qwen은 현재 Worker의 실제 제품 경로에서 언어를 명시하고 `fullFile=true`, `identify=false`로 실행했다. 음원 파일은 16 kHz 단일 채널 PCM16으로 메타데이터 없이 고정하고 동일 SHA-256 입력을 유료 API에도 사용하도록 준비했다. 제품 경로와 공급자 원본 출력의 비교이며 공급자 내부 분할·필터 차이를 통제한 순수 모델 구조 비교는 아니다. 정답·곡명은 추론 입력에 사용하지 않는다. 엄격 표기 점수를 주 지표로 사용하며 가나/한자 표기를 유리하게 바꿔 점수를 개선하지 않는다.

## API 실행 범위

- xAI `grok-voice-transcribe-2.0`: `/v1/stt`, `language`, multipart의 file을 마지막에 둠. [공식 API](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
- OpenAI `gpt-transcribe`: `/v1/audio/transcriptions`, `languages[]`만 전달하며 singular `language`와 혼용하지 않음. [공식 파일 받아쓰기](https://developers.openai.com/api/docs/guides/speech-to-text).
- ElevenLabs `scribe_v2`: `/v1/speech-to-text`, `language_code`, 음향 태그·diarization 비활성. keyterm·entity·transcript_edit 유료 옵션은 사용하지 않음. [공식 API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).

서비스당 3개 파일, 총 90.968초이며 전체 최대 9회다. 표시 단가 $0.10/시간, $0.27/시간, $0.22/시간을 곱한 총 예상은 약 $0.014909다. 세금·가입 요금·최소 과금·계약 조건은 별도이며 실제 청구액으로 표시하지 않는다. [xAI 가격](https://docs.x.ai/developers/models/speech-to-text), [OpenAI 가격](https://developers.openai.com/api/docs/pricing), [ElevenLabs 가격](https://elevenlabs.io/pricing/api).

추정 비용 예약 상한은 $0.10, 자동 재시도는 없다. 이 상한은 공급자 최종 청구의 강제 한도가 아니다. 요청 전 입력 hash와 실행 원장을 저장해 같은 요청의 재실행을 막는다. 인증/결제/모델 접근 오류가 나면 해당 공급자의 추가 음원 요청을 멈추고 다른 모델로 대체하지 않는다. 완료 응답의 오류율·처리 시간·usage를 기록할 준비를 마쳤으나 현재 실제 공급자 응답은 없다.

## 인증과 검증

이 PC에서만 접근하는 입력 화면을 열었다. API 키는 Windows 사용자에 묶인 DPAPI로 저장하고 값은 화면·로그·소스·Git에 다시 출력하지 않는다. 비어 있는 입력은 저장을 거절한다. 등록 상태만 반환하며 Origin·Host·난수 세션 검사를 적용한다. 키 등록 자체는 API 호출·구독·결제를 수행하지 않는다.

격리된 임시 저장소에서 DPAPI 왕복 및 암호문에 평문 키가 없는 것을 확인했다. 브라우저에서 입력 화면과 빈 입력 오류 상태를 확인했다. 실제 네트워크를 쓰지 않는 MockTransport로 multipart 순서, 가사/곡명 힌트 부재, 동일 요청 중복 방지를 확인했다. Mock 응답을 실제 유료 결과로 집계하지 않았다.

남은 실행 조건은 사용할 공급자의 유효한 API 키 및 계정의 API 결제/권한이다. 한국어 정확도 점수는 정확한 30초 구간 가사가 확인된 뒤 계산한다. 제품 기본 경로와 버전은 변경하지 않았다.

[안전하게 추출한 준비 상태·로컬 실측](./paid-lyrics-comparison-20261006.json)
