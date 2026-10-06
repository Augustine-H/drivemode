# 가창 받아쓰기 대체 모델·맞춤 학습·유료 API 검토

확인일: 2026-10-06. 실제 로컬 측정과 공급자 발표를 구분한다. 유료 API 호출, 사용자 녹음 외부 전송, 맞춤 학습은 실행하지 않았다. 이 문서는 도입 판단을 위한 검토이며 제품의 자동 유료 재시도 기능이 아니다.

## 로컬 후보

| 후보 | 근거와 목적 | 현재 검토 결과 |
|---|---|---|
| [ACE-Step Transcriber](https://huggingface.co/ACE-Step/acestep-transcriber) | 음악 설명·가사 출력용 대형 Qwen Omni 체크포인트 | 앞선 NF4 비교는 6곡 모두 기존 Qwen보다 나빴다. 저장 버전 및 공식 시스템 메시지 변경도 해결하지 못했다. BF16은 5개 전체 파일에서 모두 기존 Qwen보다 나빴고 사용자 요청으로 마지막 파일을 중단했다. 현대 중국어 독창 3개 합산 CER은 10% → 6.67%지만 작은 자료의 혼합 결과이며 다른 파일의 큰 악화를 상쇄하지 못한다. |
| [VietLyrics Whisper small](https://huggingface.co/kelvinbksoh/whisper-small-vietnamese-lyrics-transcription) | 베트남어 노래에 학습한 Whisper small, Apache-2.0 모델 카드 | revision `a8dd6a34bc2fe69b1f3658919c4750297cf2b0f5`, 563,189,936바이트 가중치 다운로드 및 SHA-256 검증 완료. 일반 베트남어 음성용 PhoWhisper와 다른 후보다. 실제 전체 PCM 두 파일에서 WER 100%·86.67%로 기본 Qwen보다 악화/동률이었다. 보조 CER은 약 2.2–2.4%p 줄고 추론은 빨랐지만 정확도 교체 근거는 부족하다. 연구 논문 수치를 이 PC의 실측으로 대체하지 않는다. |
| [VocalParse](https://github.com/pymaster17/VocalParse) | Qwen3-ASR 기반 중국어 가사·음정·음표·BPM 공동 출력, Apache-2.0 | revision `4c617b1a88c8e663351d9072c549d81d7f78a36f`, 4,076,867,480바이트 가중치 검증 완료. 원래 Qwen의 config·토큰·파라미터 구조를 사용해야 한다. 제품의 HF 형식 Qwen에 그대로 덮어쓰면 안 된다. 공식 batch API의 `fcntl`/`/dev/shm` 경로와 별도 단일 파일 demo를 구분한다. 공식 원본 core를 별도 Windows 어댑터로 실행한 2개 전체 파일 CER은 38.10%·2120.83%로 악화됐다. 전체 공식 API의 Windows 지원 검증으로 주장하지 않는다. |
| [Typhoon Whisper Turbo](https://huggingface.co/typhoon-ai/typhoon-whisper-turbo) | 태국어 일반 음성에 특화된 Whisper Turbo | 이번 실측에서 제외한다. 카드의 MIT 표시와 별개로 카드가 연결하는 [추가 약관](https://opentyphoon.ai/tac) §2는 경쟁 벤치마크에 사전 서면 동의를 요구하며 §3은 제3자 경로에도 적용된다고 명시한다. 동의 없이 조건을 무시한 시험·다운로드·서비스 호출은 하지 않았다. 가창 성능은 확인되지 않았다. |
| [BiodatLab Distill Whisper Thai Large V3](https://huggingface.co/biodatlab/distill-whisper-th-large-v3) | Whisper Turbo 기반 태국어 일반 음성용 공개 모델, MIT | 3,235,581,408바이트 가중치 다운로드와 SHA-256 검증 완료. 이전 small 후보와 다른 모델이며, 저자의 일반 음성 벤치마크를 노래 실측으로 취급하지 않는다. 기존 태국어 2개 전체 파일의 CER 85.65%·669.23%로 악화됐다. ‘La La Loy’ 미리듣기는 출력과 시간을 측정했지만 정답 구간이 미확정이라 점수는 계산하지 않았다. |
| [MOSS-Music](https://github.com/OpenMOSS/MOSS-Music), [SongPrep-7B](https://huggingface.co/tencent/SongPrep-7B) | 음악 분석 및 가창 인식 목적의 다른 대형 후보 | 이번 단계는 문서 검토만 수행한다. 12 GB GPU에서 BF16 전체 CUDA 적재가 어려운 규모이며 양자화·CPU 분산 비용이 추가된다. 중국어·영어 결과를 태국어·베트남어 성능으로 일반화할 근거가 없다. |

VocalParse의 모든 707개 파라미터를 헤더 수준에서 검토했다. native HF Qwen과 음향 projection의 키 이름, LLM prefix 및 embedding 행 수가 다르다. 학습된 AST 토큰 embedding을 랜덤 초기화하거나 오류를 무시해 로딩하는 방식은 비교에 쓰지 않는다. 모델 카드의 기반 Qwen 지원 언어 목록만으로 VocalParse 자체가 태국어·베트남어 노래에 맞춰 학습됐다고 판단하지 않는다.

실험용 Windows 어댑터는 qwen-asr 0.0.6 wheel의 수정하지 않은 core 클래스만 독립적으로 불러온다. 별도 Transformers 4.57.6/tokenizers 0.22.2 환경이며 qwen-asr의 강제 정렬·VocalParse Linux batch API는 실행하지 않는다. 공개 config의 base vocabulary 151,936행을 실제 저장된 trained embedding 및 tokenizer의 152,101행에 맞춰 모델 생성 전에 지정한다. 가중치 키 변경·resize·랜덤 대체는 없다. CPU processor 시험에서 두 기존 중국어 입력의 기본 tokenizer와 `fix_mistral_regex=True` 조건은 모든 input ID·mask·feature 값이 같았다. 해당 경고를 근거 없이 숨기거나 기본 tokenizer 설정을 바꾸지 않았다. 이것은 공식 패키지의 전체 실행 환경 재현과 구분한다.

## 현대 가창 평가 자료

- 중국어: [GTSinger](https://github.com/AaronZ345/GTSinger)의 서로 다른 현대 곡 3개 전체 주석 구간, 8.0/7.1/12.46초를 mono 16 kHz로 준비했다. 전문가의 paired annotation을 정답으로 사용하며 모델 결과에서 정답을 만들지 않는다. 한 명의 무반주 보컬이므로 상업 음원의 반주·혼합 및 다른 가수로 일반화할 수 없다. 원어민의 독립 청취 재검수는 하지 않았다. 3개 모두 VocalParse의 공개 `data/gtsinger.json`에 정확한 파일 경로가 있고 기본 학습 설정은 GTSinger를 학습 자료로 사용한다. 공개된 체크포인트의 실제 split은 확정되지 않았지만 독립 holdout으로는 표시하지 않으며 VocalParse 평가에는 이 3개를 넣지 않는다.
- 태국어: 사용자가 선택한 THE TOYS의 ‘ลาลาลอย (100%) / La La Loy’를 [Apple 공식 페이지](https://music.apple.com/us/song/1829232231)의 합법적으로 제공되는 29.9755초 미리듣기로 준비했다. 실제 상업 음원 믹스다. 사용자가 태국어 가사를 제공했지만 해당 가사는 더 긴 구간이라고 확인했다. 30초 구간 정답으로 자의적으로 잘라 사용하지 않으며, 처리 시간·출력 관찰만 기록하고 CER은 계산하지 않는다.
- 베트남어: Bích Phương의 ‘Bùa Yêu’ [Apple 공식 페이지](https://music.apple.com/us/song/1384638105)의 29.9523125초 미리듣기를 준비했다. 상업 음원 믹스이며 정확한 구간 정답은 아직 검수되지 않아 WER을 계산하지 않는다. VietLyrics 모델 학습 곡과 중복 여부도 확인되지 않았다. [ViSVS 공식 저장소](https://github.com/anhuynh219/vietnamese_SVS)는 현재 원본 데이터 공개를 제한한다고 명시한다. 공개 프로젝트 페이지의 baseline·voicing tension·energy breathiness 예제는 합성 결과여서 실제 사람의 현대 가창 평가로 사용하지 않았다. [VietLyrics](https://github.com/BatmanofZuhandArrgh/VietLyrics)는 곡 메타데이터와 Zing 링크를 제공한다. 링크만으로 재배포·학습 권한을 얻었다고 해석하거나 지역 제한을 우회하지 않는다. 기존 베트남어 2곡 비교와 현대곡의 독립 정확도 검증은 구분한다.

음원과 전체 정답 가사는 무시된 로컬 평가 디렉터리에만 둔다. GTSinger의 CC BY-NC-SA 4.0 조건을 확인했으며 이 비교를 상업 모델 학습 권한으로 해석하지 않는다.

## 보컬 맞춤 학습 제안

다음은 실행 전 설계 제안이며 측정된 학습 비용·시간·성능이 아니다.

1. 먼저 베트남어 공개 가창용 small 모델을 비교한다. 효과가 없으면 Whisper small/medium의 encoder 고정 + decoder LoRA 등 작은 실험부터 시작한다. 1.7B Qwen은 LoRA/QLoRA 후보지만 음향 encoder·긴 입력 activation까지 포함한 12 GB 적합성은 짧은 실제 학습 step으로 측정해야 한다. 전체 파라미터 BF16 Adam 학습은 가중치·gradient·optimizer만으로도 GPU 여유가 부족하므로 우선순위가 낮다.
2. 언어별 1–5시간의 권리 확보된 실제 보컬과 원어민이 검수한 5–20초 단위 정답을 초기 실험 목표로 제안한다. 이는 성공에 필요한 최소량을 보장하는 수치가 아니다. 언어별 20–30분 이상의 별도 검증/시험 구간도 확보하고 곡·가수 단위로 분리한다. 같은 노래의 다른 녹음이 train/test에 섞이지 않게 한다.
3. 중국어·태국어는 엄격 CER, 베트남어는 WER와 CER을 함께 측정한다. 음절·발음 기준 보조 점수는 별도로 표시하고, 철자 오류를 제거해 주 점수를 좋게 만들지 않는다. 태국어와 베트남어 성조, 긴 모음, melisma, 반복 후렴, 랩과 코드 전환 구간을 포함한다.
4. 원곡 믹스, 분리 보컬, 실제 마이크/휴대폰 재생을 평가에 각각 포함한다. 분리 과정이 자음을 훼손할 수 있으므로 원곡 대조군을 유지한다. 무음·연주·잡음의 무관한 문구 생성률도 검사한다. 합성 보컬은 보조 augmentation으로만 표시한다.
5. 정답 가사나 곡명을 추론 힌트에 넣은 시험은 순수 받아쓰기와 분리한다. 알려진 곡의 승인된 가사 정렬은 별도 기능이며, ASR 모델 자체의 향상으로 세지 않는다. 모델 간 문장 합성이나 LLM 가사 교정으로 들리지 않은 단어를 넣지 않는다.

태국어 [PrinttoTH 공식 페이지](https://thaids.printmov.com/)는 CC BY-NC-SA 4.0 외에도 DiffSinger 외 용도에 저자 연락을 요구한다. 현재 ASR 학습에 자동 사용하지 않는다. 저자 연락이나 제한 자료 구매도 실행하지 않았다.

## 유료 받아쓰기 API

2026-10-06 공식 요금 페이지의 달러 표시 기준. 세금·가입 요금·최소 과금·옵션·계정별 계약 조건은 별도다. 아래 6분 비용은 표시 단가를 단순 곱한 추정이며 실제 청구 금액이 아니다. 노래 가사 정확도는 모두 미측정이다.

| 후보 | 표시 단가 | 같은 음원 합계 6분의 추정 | 검토 사항 |
|---|---:|---:|---|
| xAI `grok-voice-transcribe-2.0`, REST | $0.10/시간 | $0.010 | 공식 목록에 `zh`/`th`/`vi`. 파일 API `/v1/stt`, 음성 언어 힌트 가능. 스트리밍 $0.20/시간과 구분한다. [공식 가격](https://docs.x.ai/developers/models/speech-to-text), [지원 언어·API](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text). |
| ElevenLabs Scribe v2, batch | $0.22/시간 | $0.022 | 공식 목록에 Mandarin/Thai/Vietnamese. keyterm 등의 유료 옵션은 첫 비교에서 제외한다. [API 요금](https://elevenlabs.io/pricing/api), [언어 목록](https://elevenlabs.io/docs/overview/capabilities/speech-to-text). |
| OpenAI `gpt-4o-mini-transcribe` | 약 $0.003/분 | $0.018 | 저비용 대조 후보. 해당 3개 언어의 실제 가창 품질은 미측정이다. |
| OpenAI `gpt-4o-transcribe` | 약 $0.006/분 | $0.036 | 품질 대조 후보. 공급자의 일반 음성 인식 설명을 가창 정확도 보장으로 읽지 않는다. |
| OpenAI `gpt-transcribe` | 약 $0.0045/분 | $0.027 | 현재 문서의 기본 파일 받아쓰기 후보. `languages` 복수 필드 사용 등 기존 모델과 API 차이가 있다. 해당 3개 언어 코드 및 실제 가창 시험은 미실행이다. |

OpenAI의 단가와 모델별 필드는 [공식 가격](https://developers.openai.com/api/docs/pricing), [파일 받아쓰기 가이드](https://developers.openai.com/api/docs/guides/speech-to-text)로 확인했다. 정답을 prompt/keywords로 보내서 얻은 결과는 무힌트 결과와 분리한다.

유료 시험을 한다면 먼저 xAI, Scribe v2, OpenAI `gpt-transcribe`를 같은 검수된 음원으로 비교하는 것이 합리적이다. OpenAI 후보는 [현재 기본 STT 모델 문서](https://developers.openai.com/api/docs/models/gpt-transcribe)에 근거해 골랐으며 노래 성능은 아직 확인되지 않았다. 세 후보에 각각 총 6분을 보내는 표시 단가 추정은 $0.059다. OpenAI를 4o 대조 모델로 선택하면 $0.068, mini를 선택하면 $0.050이다. 앱 기본 경로를 변경하기 전에 독립 곡·마이크 입력의 개선과 처리 시간을 확인해야 한다.

실제 도입 설계는 사용자가 선택한 요청만 외부로 전송하고 공급자·예상 비용을 표시하는 방식이다. 로컬 실패만으로 자동 전송하지 않는다. 키는 기존 안전한 서버 측 인증 저장 방식을 사용하고 브라우저/소스/Git에 넣지 않는다. 요청 길이·동시 요청·월 예산 상한, 시간 초과, 입력 제거, provider별 오류 기록을 둔다. 노래 찾기용 지문 전송 승인은 이 외부 음원 전송·과금의 승인으로 확장하지 않는다.

## 적용 판단

실측 후 기존 Qwen과 제품 1.28.2를 유지한다. 전체 수치·처리 시간·메모리·정확한 오류는 [추가 검증 결과](./lyrics-followup-validation-20261006.md)에 기록했다. 작은 자료의 향상이나 학습 자료 중복 가능성이 있는 결과만으로 기본 모델을 교체하지 않는다. 국소 CER 개선은 있었지만 일관된 단어 오류율·독립 정확도 개선은 부족하므로, 검수된 현대곡 정답 확보와 제한된 유료 A/B 비교를 다음 선택지로 삼는다. 맞춤 학습은 권리·정답·독립 평가 자료를 확보한 뒤 결정한다.
