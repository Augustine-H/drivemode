# Audio Awareness — 구현 계약

## 현재 구조와 최소 변경

React 19 / TypeScript / TanStack Start 웹 앱이다. `use-dictation.ts`는 브라우저
SpeechRecognition 또는 MediaRecorder → xAI STT를 사용한다. `/api/ask`는 Grok
Responses SSE, `use-reader.ts`는 문장별 xAI TTS다. 실시간 Voice WebSocket이나
사용자 정의 오디오 tool은 없었다. 설정은 ReaderApp의 접이식 섹션이다.
기존 STT·페르소나·문장 재생을 보존하고 독립된 PCM 수집기를 추가한다.

## 단계와 파일

1. AudD 제거: `music-listener.tsx`, `recognize-music.ts`, 기존 음악 안내 삭제.
2. 로컬 입력: `audio-ring.ts`, `audio-capture-worklet.ts`, `use-audio-awareness.ts`.
   입력마다 최근 15초 mono PCM을 메모리에만 보관한다. 1초마다 오래된 조각을
   폐기하고 OFF·화면 숨김·권한 종료 시 스트림과 버퍼를 폐기한다.
3. 설정: `audio-awareness-settings.tsx`. 마이크와 PC 소리는 독립적으로 연결한다.
   설정 창을 닫아도 동작한다. 재실행·잠금 복귀 시 권한을 다시 연결한다.
4. 분석: `sound-worker.ts`, `sound-client.ts`의 CLAP 로컬 분류와
   `music-fingerprint-worker.ts`, `identify-music.ts`의 Chromaprint/AcoustID.
5. 질문: `audio-tools.ts` / `audio-tool-plan.ts`에서 네 가지 도구를 제한적으로
   선택하고 ReaderApp 기존 답변 경로에 결과를 넣는다. 일반 질문은 추가 호출 없다.

## 입력과 Windows

브라우저는 WASAPI를 직접 호출하지 못한다. Windows Chrome/Edge에서
getDisplayMedia로 탭/화면과 오디오 공유를 선택한다. 오디오 트랙이 없는 공유는
실패로 표시한다. 오디오를 유지하기 위해 영상 트랙은 유지하되 영상은 읽거나
저장/전송하지 않는다. 앱에 Electron/Tauri/native host가 없어 WASAPI 확장은
별도 네이티브 앱 단계다. Android에서는 마이크 입력만 보장 가능한 경로다.
앱의 답변 재생 중에는 버퍼 기록을 잠시 제외하여 자체 TTS 재인식을 줄인다.

## 모델과 비용

CLAP은 첫 분석 때 약 160MB 양자화 모델을 다운로드한다. 음성 데이터는
브라우저 Worker에서 분석하며 외부로 보내지 않는다. 분류 점수는 후보 사이의
상대 점수이며 확률이나 안전 경보가 아니다. 확실하지 않으면 가능성으로 말한다.
Gemini Audio는 더 자유로운 설명이 가능하지만 별도 API 키·오디오 업로드·요금이
필요하므로 기본 경로에 넣지 않는다. STT는 환경음 분류와 분리한다.

음악은 로컬 Chromaprint 지문만 AcoustID로 전송한다. 서버의
`ACOUSTID_APP_KEY`가 필요하고 무료 서비스는 비상업 용도에 한정된다.
AcoustID는 파일 식별 중심이라 15초 실시간/잡음 구간은 정확한 곡을 못 찾을 수
있다. 일치가 불명확하면 제목을 생성하지 않는다. ShazamKit은 Apple/Android
네이티브 SDK 경로여서 현재 Windows 웹 앱에 직접 붙일 수 없다.

음악 자동 감시는 기본적으로 외부 호출을 하지 않는다. 질문 시에만 실행한다.
설정의 음악 인식은 질문에 대한 도구 사용 허용이다. 지속적인 음악 이벤트 감지와
ShazamKit 네이티브 연동은 이후 확장 단계이며 현재 구현으로 주장하지 않는다.

Grok 오디오 도구 선택은 소리 질문에 한해 최대 한 번, 이후 기존 답변 한 번이다.
`transcribe_audio`만 사용자가 글자 변환을 요청할 때 최근 WAV를 기존 xAI STT로
보낸다. 요금은 기존 xAI API 기준이다. 취소 시 결과를 버리고 추가 호출을 막지만
이미 전송한 요청은 요금이 발생할 수 있다.

최근 소리 기억은 분석 결과/곡 정보만 현재 실행 메모리에 보관한다. 원본 PCM은
지속 저장·Dropbox 백업하지 않는다. 기억 OFF·전체 OFF·화면 숨김 시 제거한다.
곡의 인식 시각을 함께 넣어 과거 곡을 현재 재생 중이라고 단정하지 않는다.

## 근거

- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording
- https://huggingface.co/docs/transformers.js/api/pipelines
- https://ai.google.dev/gemini-api/docs/audio
- https://acoustid.org/webservice
- https://github.com/janis-me/rusty-chromaprint-wasm
- https://developer.apple.com/shazamkit/
- https://docs.x.ai/developers/tools/function-calling

## 검증 (2026-10-04)

- 변경 관련 회귀 테스트 34개, 타입 검사와 production 빌드 통과.
- 브라우저에서 공개 dog_barking.wav를 실제 CLAP으로 분석: 개 짖는 소리가
  가장 높은 후보(상대 점수 약 0.993). 인식률 99.3%라는 의미는 아니다.
- 합성 PCM의 Chromaprint WASM 실행, 실제 AudioWorklet 수집기의 15초 상한,
  OFF 시 연결·버퍼 해제 확인. 유료 API나 개인 마이크 녹음을 검증에 쓰지 않았다.
- AcoustID 실제 곡 조회는 수행하지 않았다. 키 등록 후 곡 일치 검증이 필요하다. Windows 시스템
  공유 오디오와 실제 차량 소음 정확도는 실제 장치 검증이 필요하다.
- 전체 scripts 테스트: 279개 중 269개 통과. 변경하지 않은 공유 카드 테스트
  8개(프로젝트의 고정 앱 이름과 템플릿 기대값 차이), Windows 심볼릭 링크
  권한 테스트 2개는 실패한다.
