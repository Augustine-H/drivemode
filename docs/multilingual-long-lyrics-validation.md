# 영어·일본어 장시간 가사 검증 · 2026-10-10

기존 무료 생성 원곡 4개와 아라·서연 변환본 8개의 전체 길이를 로컬 Qwen3-ASR로 받아썼다. 새 음악 생성·유료 API 호출·외부 음원 전송·모델 다운로드는 없다. 정답 가사나 곡명은 ASR에 전달하지 않았다. 운영 Worker 큐를 통해 한 작업씩 실행했다.

## 측정 방법과 해석

48kHz 스테레오 WAV를 FFmpeg로 mono 16kHz PCM16으로 변환했다. 기존 받아쓰기 경로의 30초 창·3초 겹침과 보수적 병합을 유지했다. 60초는 3구간, 120초는 5구간이며 원 구간 결과와 병합 경고를 함께 보존한다.

표의 값은 **요청 가사와 자동 받아쓰기 사이의 편집 거리 비율**이다. 실제 가창의 확정 오류율이나 사람 청취 정확도가 아니다. 영어는 NFKC·소문자·구두점 분리 후 단어 단위, 일본어는 NFKC·구두점/공백 제외 문자 단위로 계산한다. 일본어 한자·가나 표기 차이도 포함하므로 발음 오류로 단정하지 않는다. 반주, 긴 음, ASR 자체 오류, 구간 병합과 실제 가사 누락이 모두 영향을 줄 수 있다. 반복 후렴을 정답에서 제거하거나 인식 결과로 정답을 고치지 않았다.

| 언어 | 길이 | 원곡 불일치 | 아라 불일치 | 서연 불일치 | 단위 |
| --- | ---: | ---: | ---: | ---: | --- |
| 영어 | 60초 | 19.15% | 23.40% | 23.40% | 단어 |
| 일본어 | 60초 | 54.17% | 52.78% | 52.78% | 문자 |
| 영어 | 120초 | 3.19% | 3.19% | 3.72% | 단어 |
| 일본어 | 120초 | 38.89% | 43.06% | 44.44% | 문자 |

## 판단과 개선 우선순위

- 영어 60초: 원곡·아라·서연 모두 `Let this song carry us home`, `You will never walk alone`, `I will find you in the light`가 Qwen 전체 받아쓰기에 없다. 독립 Whisper 원곡 분석에서도 세 구절이 나타나지 않았다. 원곡의 가사 누락 의심을 우선 기록한다. 두 인식 모델의 동의도 사람 청취로 확정된 누락이나 독립된 발음 검수는 아니다.
- 영어 120초: 첫 16행은 원곡 Qwen 출력에서 요청과 일치하지만, 반복된 두 번째 블록의 `Feels like coming home again`은 원곡과 변환본 분석에서 누락 의심이다. Whisper 원곡 분석에서도 이 두 번째 구절이 나타나지 않았다. 첫 블록에 있던 구절을 두 번째 반복의 이행으로 세지 않는다.
- 일본어 60초: 두 모델의 원곡 분석이 첫 절·후렴 위주이며, 요청된 `夕焼けが街を包んで`로 시작하는 두 번째 절·후렴은 나타나지 않는다. Qwen의 두 변환본도 같은 범위다. 첫 후렴 마지막도 요청 `また笑顔で会おうね`와 다른 문구로 인식된다. 원곡의 가사 분량·문구 준수 문제를 의심하지만 일본어 발음 오류를 확정하지 않는다.
- 일본어 120초: 두 원곡 모델 모두 요청과 다른 문구·배치로 인식한다. 예를 들어 60초 이후의 절 시작은 Qwen에서 `夕日の光が窓を照らす`, Whisper에서 `揺らぬ光が窓を照らす`이며 요청 반복 절의 시작은 `朝の光が窓を照らす`다. 두 모델이 서로도 다르므로 정확한 실제 문구는 미확정이다. 긴 출력 생성 성공을 가사 준수 성공으로 확대하지 않는다.
- 영어 60초의 `Like a warm and gentle fire`는 Qwen 원곡에서는 일치하나 변환본에서 다른 단어로 나온다. 독립 Whisper 원곡에서도 이 구절이 다르게 인식되므로 변환만의 자음 손실로 단정할 수 없다. 발음 개선 대상 후보로 남기고 현재 CFG 0.9를 유지한다.

다음 실험은 음색 재학습보다 **60초의 가사 분량을 줄인 원곡 생성**, **일본어를 짧은 절·후렴 단위로 생성하는 대조군**을 우선한다. 원곡의 문구 이행이 확인된 뒤 같은 원곡으로 아라·서연 변환을 비교해야 한다. 이번 검증에서 가사 자동 교정·원곡 재생성·모델 교체·추가 유료 호출은 실행하지 않았다. 사용자의 자연스러움 평가는 그대로 유지하고 가사 정확도 판단과 구분한다.

## 독립 Whisper 교차 확인

기존에 준비된 `openai/whisper-large-v3-turbo` revision `41f01f3fe87f28c78e2fbf8b568835947dd65ed9`을 CPU float32에서 실행했다. 정답을 주지 않고 30초 비겹침 창으로 원곡 네 개 전체를 분석했다. Qwen과 다른 모델·경계로 점검하며, 이 출력으로 Qwen 결과를 덮어쓰거나 모델 답변을 섞어 점수를 좋게 만들지 않았다. CPU 분석은 GPU Worker 분석과 병행했으며 GPU 모델끼리의 동시 실행은 없다.

Whisper 일본어 120초의 30–60초 창에는 요청에 없는 `ご視聴ありがとうございました`도 출력됐다. 이것을 실제로 불린 추가 가사로 확정하지 않는다. 이런 인식 오류 가능성 때문에 교차 확인은 누락·변경 의심을 좁히는 보조 자료다.

### Whisper en-60-source

- 0–30초: Morning light is on the window, I can hear you call my name. Every road we walk together feels like coming home again. I will stay here by your side through the dark and rising tide. Evening stars are shining softly on the road
- 30–60초: The road beneath our feet When the wind calls out your name Every memory feels complete Let the music lift us higher Like a warm agenda fight We will sing into the night

### Whisper ja-60-source

- 0–30초: 朝の光が窓を照らす君の声が聞こえてくる二人で歩くこの道はいつも優しく輝い出す
- 30–60초: 君のそばにいるよ遠い明日も一緒にこの歌に想いを乗せてまた明日も出会おうね

### Whisper en-120-source

- 0–30초: Morning light is on the window I can hear you call my name Every road we walk together Feels like coming home again I will stay here by your side Through the dark and rising tide Let this song carry us home
- 30–60초: You will never walk alone Evening stars are shining softly On the road beneath our feet When the wind calls out your name Every memory feels complete Let the music lift us higher Like a warm and gentle fire I will find you in the light We will sing into the night
- 60–90초: Morning light is on the window I can hear you call my name Every road we walk together I will stay here by your side Through the dark and rising tide Let this song carry us home You will never walk alone Evening stars are shining so bright
- 90–120초: We will flee on the road beneath our feet When the wind calls out your name Every memory feels complete Let the music lift us higher Like a warm and gentle fire I will find you in the light We will sing into the night

### Whisper ja-120-source

- 0–30초: 朝の光が窓を照らす 君の声が聞こえてくる二人で歩くこの道は いつも優しく輝いてる君のそばに
- 30–60초: いるよ 遠い奴も一緒に君の名前を呼ぶたびにいつかな風が与い出す君のそばにいるよ 遠い夜も一緒にこの歌に願いを込めてまた笑顔で洗おうねご視聴ありがとうございました
- 60–90초: 揺らぬ光が窓を照らす星の光が聞こえてくる二人で歩くこの道はいつも優しく輝いてる君のそばにいるよ遠い夜も一緒にこの歌に願い
- 90–120초: 愛を込めてまた笑顔であろうね夕焼けば街を包んで星の光が道を追ってくる君の名前を呼ぶたびに静かな風が歌いだす

## 실행 중 오류와 복구

영어 서연 120초의 첫 받아쓰기 작업 `8609b107-c667-41cf-856a-e0ce21b4303a`는 1/5구간 이후 실패했다. 로컬 traceback은 `worker.py`의 진행 확인 `progress_path.read_text()`에서 `PermissionError: [Errno 13] Permission denied`를 가리킨다. 원곡 생성·오디오 디코딩·CUDA 추론 오류로 보고하지 않는다. 파일 ACL에는 소유자 접근 권한이 있고 이전 진행 갱신도 성공했으므로 Windows 파일 교체/접근 시점의 일시적 충돌로 추정하지만 잠금을 유발한 프로세스는 확인되지 않았다.

폴링 읽기의 일시적 PermissionError·FileNotFoundError는 다음 폴링까지 기다리도록 수정했다. 최종 진행 읽기는 50ms 간격으로 최대 4회 시도하고 지속 오류는 그대로 실패로 보고한다. 잘못된 JSON을 정상 진행으로 처리하지 않는다. 대기·실행 작업이 없음을 확인하고 소유한 로컬 Worker만 재시작했다. 기존 성공 8건은 재사용하고 실패한 받아쓰기는 새 requestId로 동일 음원·언어·모델 조건에서 다시 실행했다. 실패 결과는 `en-120-eve-failed-attempt.json`에 보존한다. 음악 생성 재실행은 없다.

관련 새 회귀 테스트 4개와 Worker 기존 테스트 11개가 통과했고, 기존 평가 의존성 경로를 포함한 전체 음악 Python 테스트 128개도 통과했다. 최종 Worker 상태는 별도 `final-health.json`으로 보존한다. 앱 버전·NAS API·웹앱·음색 모델은 변경하지 않았다.

## 구간별 Qwen 받아쓰기

아래는 ASR 원 출력이다. 시작·끝 시각은 분석 창의 경계이며 단어별 강제 정렬 시각이 아니다. 겹치는 창에 같은 구절이 나타난다고 실제 추가 반복으로 판정하지 않는다.

### en-60-source

Worker 작업 `5469e25c-e02a-4a44-9ccc-2d97590eee7e`. 요청 대비 편집: 0 대치·18 삭제·0 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: Morning light is on the window. I can hear you call my name. Every road we walk together feels like coming home again. I will stay here by your side through the dark and rising tide. Evening stars are shining softly on the.
- 27–57초: Shining softly on the road beneath our feet. When the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm and gentle fire. We will sing into the night.
- 54–60초: Through the night.

### en-60-ara

Worker 작업 `a79e9960-4a8f-4344-969d-ca81aaa4c7b7`. 요청 대비 편집: 2 대치·20 삭제·0 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: Morning light is on the window. I can hear you call my name. Every road we walk together feels like coming home again. I will stay here by your side through the dark and rising time. Evening stars are shining softly on the.
- 27–57초: Shining softly on the road beneath our feet. When the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm incandescence. We will sing into the night.
- 54–60초: Through the night.

### en-60-eve

Worker 작업 `e4a83c23-87b2-460d-b2c1-310256b18173`. 요청 대비 편집: 3 대치·19 삭제·0 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: Morning light is on the window. I can hear you call my name. Every road we walk together feels like coming home again. I will steer you by your side through the dark and rising tide. Evening stars are shining softly on the.
- 27–57초: Shining softly on the road beneath our feet, when the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm ingenerate fire. We will sing into the night.
- 54–60초: Through the night.

### ja-60-source

Worker 작업 `ef4e07d9-6c26-4801-9aef-931edc81b866`. 요청 대비 편집: 6 대치·72 삭제·0 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: 朝の光が窓を照らす。君の声が聞こえてくる。二人で歩くこの道はいつも優しく輝いたす。
- 27–57초: 君のそばにいるよ。遠い明日も一緒に。この歌に想いを乗せて、また明日まで。ね。
- 54–60초: 雨。

구간 경계 병합 경고가 있어 병합 문자열 점수에 중복 인식이 포함될 수 있다.

### ja-60-ara

Worker 작업 `e2fe3725-f9b5-40d4-81c8-aa6149ad4942`. 요청 대비 편집: 4 대치·71 삭제·1 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: 朝の光が窓を照らす。君の声が聞こえてくる。二人で歩くこの道はいつも優しく輝いてす。
- 27–57초: 君のそばにいるよ。遠い明日も一緒に。この歌に思いを乗せて、また明日も出会うね。
- 54–60초: 胸。

구간 경계 병합 경고가 있어 병합 문자열 점수에 중복 인식이 포함될 수 있다.

### ja-60-eve

Worker 작업 `aee05cfc-eee8-4d2d-9334-4b35ff48861e`. 요청 대비 편집: 5 대치·70 삭제·1 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: 朝の光が窓を照らす。君の声が聞こえてくる。二人で歩くこの道はいつも優しく輝いたす。
- 27–57초: 君のそばにいるよ。遠い明日も一緒に。この歌に想いを乗せて、また明日まで逢おうね。
- 54–60초: ね。

구간 경계 병합 경고가 있어 병합 문자열 점수에 중복 인식이 포함될 수 있다.

### en-120-source

Worker 작업 `30b92dab-230e-4911-bb37-aa8899710158`. 요청 대비 편집: 1 대치·5 삭제·0 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: Morning light is on the window. I can hear you call my name. Every road we walk together feels like coming home again. I will stay here by your side through the dark and rising tide. Let this song carry us home.
- 27–57초: This song carry us home. You will never walk alone. Evening stars are shining softly on the road beneath our feet. When the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm and gentle fire. I will find you in the light.
- 54–84초: I will find you in the light. We will sing into the night. Morning light is on the window. I can hear you call my name. Every road we walk together, I will stay here by your side. Through the dark and rising tide, let this song carry us home. You will never.
- 81–111초: You will never walk alone. Even stars are shining softly on the road beneath our feet. When the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm and gentle fire. I will find you in the light.
- 108–120초: I will find you in the light. We will sing into the night.

### en-120-ara

Worker 작업 `05c9663b-f93b-4b9c-9280-b809b0104488`. 요청 대비 편집: 1 대치·5 삭제·0 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: Morning light is on the window. I can hear you call my name. Every road we walk together feels like coming home again. I will stay here by your side through the dark and rising tide. Let this song carry us home.
- 27–57초: This song carry us home. You will never walk alone. Evening stars are shining softly on the road beneath our feet. When the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm and gentle fire. I will find you in the light.
- 54–84초: I will find you in the light. We will sing into the night. Morning light is on the window. I can hear you call my name. Every road we walk together, I will stay here by your side through the dark and rising tide. Let this song carry us home. You will never.
- 81–111초: You will never walk alone. Even stars are shining softly on the road beneath our feet. When the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm and gentle fire. I will find you in the light.
- 108–120초: I will find you in the light. We will sing into the night.

### en-120-eve

Worker 작업 `5ae0555a-113a-41fe-92b4-b6086d6da5ee`. 요청 대비 편집: 2 대치·5 삭제·0 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: Morning light is on the window. I can hear you call my name. Every road we walk together feels like coming home again. I will stay here by your side through the dark and rising tide. Let this song carry us home.
- 27–57초: This song carry us home. You will never walk alone. Evening stars are shining softly on the road beneath our feet. When the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm and gentle fire. I will find you in the light.
- 54–84초: I will find you in the light. We will sing into the night. Morning light is on the window. I can hear you call my name. Every road we walk together, I will stay here by your side through the dark and rising tide. Let this song carry us on. You will never.
- 81–111초: You will never walk alone. Even stars are shining softly on the road beneath our feet. When the wind calls out your name, every memory feels complete. Let the music lift us higher, like a warm and gentle fire. I will find you in the light.
- 108–120초: I will find you in the light. We will sing into the night.

### ja-120-source

Worker 작업 `8f8979a8-8507-454a-94fc-b7a8848a8018`. 요청 대비 편집: 23 대치·75 삭제·14 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: 朝の光が窓を照らす。君の声が聞こえてくる。二人で歩くこの道はいつも優しく輝いてる。君のそばに。
- 27–57초: 君のそばにいるよと、いつも一緒に。君の名前を呼ぶたびに、いつかの風が鳴いだす。君のそばにいるよと、夜も一緒に。この歌に願いを込めてまた。
- 54–84초: 何願いを込めてまた笑顔で洗おうね。夕日の光が窓を照らす星の光が聞こえてくる。二人で歩くこの道はいつも優しく輝いてる。君のそばに。
- 81–111초: 君のそばにいるよと夜も一緒にこの歌に願いを込めてまた笑顔で会おうね。夕焼けは街を包んで星の光が道を照ってくる君の名前を呼ぶたびに。
- 108–120초: 名前を呼ぶたびに静かな風の歌い出す。

구간 경계 병합 경고가 있어 병합 문자열 점수에 중복 인식이 포함될 수 있다.

### ja-120-ara

Worker 작업 `3f5787f9-e15f-4332-8729-67cef0dfe997`. 요청 대비 편집: 30 대치·74 삭제·20 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: 朝の光が窓を照らす。君の声が聞こえてくる。二人で歩くこの道はいつも優しく輝いてる。君のそばに。
- 27–57초: 君のそばにいるよと、いいやつも一緒に。君のお名前を呼ぶたびに、いつかな晴れれば肌に出す。君のそばにいるよと、いい夜も一緒に。この歌に願いを込めてまた。
- 54–84초: に願いを込めてまた笑顔で洗おうね。床の日差が窓を照らす星の微笑が聞こえてくる。二人で歩くこの道はいつも優しく庇える。君のそばに。
- 81–111초: 君のそばにいるよと夜も一緒にこの歌に願いを込めてまた笑顔で会う。夕焼けが街を包んで星の光が道を照ってくる君の名前を呼ぶたびに。
- 108–120초: 名前を呼ぶたびにしずるかな風が歌い出す。

구간 경계 병합 경고가 있어 병합 문자열 점수에 중복 인식이 포함될 수 있다.

### ja-120-eve

Worker 작업 `bc9b2a0f-3fd6-4082-a68f-f4ebfa83351e`. 요청 대비 편집: 44 대치·70 삭제·14 삽입. 이 값은 가창 오류 분류가 아니다.

- 0–30초: 朝の光が窓を照らす。君の声が聞こえてくる。二人で歩くこの道はいつも優しく輝いてる。君のそばに。
- 27–57초: 君のそばにいるよと、いいやつも一緒に。君の名前を呼ぶたびに、いつかなぜか、はだい出す。君のそばにいるよと、いい夜も一緒に。この歌に願いを込めてまた。
- 54–84초: に願いを込めてまた笑うねあらおね夕日のひげが窓を照らす星の光が聞こえてくる二人で歩くこの道はいつも優しく被んでる君のそばに。
- 81–111초: 君のそばにいるよと夜も一緒にこの歌に願いを込めて笑顔で歩こう。夕焼けは街を包んで、星の光が道を照ってくる。君の名前を呼ぶたびに。
- 108–120초: 名前を呼ぶたびにしずるかな風が歌い出す。

구간 경계 병합 경고가 있어 병합 문자열 점수에 중복 인식이 포함될 수 있다.

## 보존 자료

로컬 `artifacts/multilingual-long-2026-10-10/lyrics-validation/`에 요청 가사, 입력/원본 해시, Worker ID·결과·측정, 구간별 원문, 병합 원문, 문자/단어 편집 거리와 문장별 단순 출현 진단을 보존했다. 전체 정답 가사는 무시된 로컬 자료에 두며, 단순 출현 횟수를 개별 가사 행의 이행 증거로 사용하지 않는다.
