# 보컬 생성 및 노래 인식

## 사용자 기능

- 설정 → 음악 생성 · NAS 연결 → 보컬 노래 만들기: 곡 분위기, 직접 쓴 한국어 가사, 10~120초 길이를 입력한다. 실제 ACE-Step 음악 모델이 보컬과 반주를 함께 생성한다. TTS를 노래 생성으로 대신하지 않는다.
- 채팅: `피아노 노래 30초 불러줘. 가사: [Verse] ...`처럼 가사를 명시한다. 가사가 없는 요청은 입력 방법을 안내한다.
- 노래 인식: 파일의 처음 30초 또는 사용자가 직접 시작한 최대 30초 마이크 녹음을 16 kHz mono PCM WAV로 변환하고 개인 NAS → Windows Worker로 전달한다. 파일은 최대 32 MB이며 사용자가 선택한 작업만 실행한다. 샘플을 미리 재생할 수 있고 ‘선택한 노래 인식’을 누르기 전에는 전송하지 않는다. 설정을 닫으면 마이크 입력을 중단한다.
- 제목·가수 찾기: 별도 동의 후 ShazamIO가 로컬에서 만든 오디오 지문을 Shazam으로 전송한다. 오디오 샘플 자체는 Shazam에 보내지 않는다. 비공식 API이며 서비스 중단·검색 실패가 가능하다. 일치가 없으면 제목을 추측하지 않는다.
- 가사 받아쓰기: Whisper Small을 로컬 CUDA로 실행한다. 파일 전체의 가사나 인터넷에서 찾은 정답 가사가 아니라, 선택한 30초 구간의 자동 받아쓰기다. 반주·발음·보컬 품질에 따라 오인식이 발생하며 반복 문장 이상 출력은 제외한다.
- 기존 Audio Awareness를 켠 사용자의 실시간 AcoustID 인식 경로는 유지한다. 새 파일 인식은 별도의 설정 항목을 사용한다.

## 실행 및 보안

기존 Stable Audio Python 환경을 변경하지 않도록 새 라이브러리는 `.music-runtime/vocal-deps`에서 별도 자식 프로세스가 사용한다. 하나의 Windows 대기열과 GPU 잠금으로 연주곡·보컬·인식을 순차 실행하고, 보컬/Whisper 실행 전에 기존 연주곡 모델의 VRAM을 해제한다. ACE-Step은 BF16 + 모델 CPU offload + VAE tiling을 사용한다.

모델 리비전은 `services/music/vocal_models.py`에 고정되어 있다. `prepare_vocal_models.py`는 명시적 설치 단계에서만 파일을 다운로드하고, 실행 중에는 `local_files_only=True`를 사용한다. HF 인증은 기존 Windows DPAPI를 사용하며 토큰을 소스나 인자로 저장하지 않는다. 모델이 준비되지 않은 Worker 요청은 503 `MODEL_NOT_PREPARED`로 거절한다.

NAS 인증/CORS/Tailscale 경계는 기존과 동일하다. WAV/MP3는 기존 해시·전체 디코딩·길이 검사를 통과한 후 보관한다. 인식 작업은 음원 산출물 없이 구조화된 인식 결과로 완료한다. API 조회와 대화 백업에 입력 샘플을 포함하지 않는다. 완료·실패·취소 시 요청의 샘플 필드를 제거하고, 자식 프로세스의 임시 요청 파일도 제거한다. SQLite/파일 시스템의 과거 페이지에 대한 보안 삭제를 보장하는 기능은 아니다.

## 2026-10-05 로컬 검증

RTX 4070 Ti, CUDA 12.6, torch 2.7.1. 수치는 API 전체 왕복과 MP3 인코딩을 제외한 모델 단계 기준이다. RAM은 자식 프로세스 working set 샘플 최댓값이며 전체 시스템 RAM이 아니다.

| 보컬 길이 | 로딩 | 생성 | 최대 할당 VRAM | 최대 프로세스 RAM |
|---|---:|---:|---:|---:|
| 30초 | 6.488초 | 15.216초 | 8091.67 MiB | 12394.21 MiB |
| 60초 | 6.018초 | 13.135초 | 8244.27 MiB | 12068.90 MiB |
| 120초 | 6.419초 | 15.018초 | 8782.34 MiB | 12440.44 MiB |

각 길이의 48 kHz stereo WAV와 MP3 320 kbps를 실제 생성하고 전체 디코딩 및 길이를 확인했다. 30초 출력은 8,640,044-byte WAV이며 SHA256 `19b0236b631de06defec61419ed0a22ae7edec340b4af5adde265dd8a015f199`이다. 생성된 한국어 보컬을 Whisper가 네 줄로 받아썼으나 `꿈을`→`거물`, `햇살`→`뱃살` 등의 오류가 있어 정확한 가사 복원을 보장하지 않는다. 해당 받아쓰기 모델 단계는 6.321초, 최대 할당 VRAM 1164.10 MiB였다.

한국어 합성 **말소리** 기준 테스트도 6.925초에 완료했다. 이 음성 테스트는 노래 생성 성능의 증거로 사용하지 않는다. 연주곡에서 발생한 반복 문자 오인식은 필터 추가 후 빈 받아쓰기와 경고로 처리했다.

제목 인식 검증은 [Monkeys Spinning Monkeys — Kevin MacLeod](https://commons.wikimedia.org/wiki/File:Monkeys_Spinning_Monkeys_(ISRC_USUAN1400011).mp3), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) 음원의 첫 20초를 mono 16 kHz로 변환해 사용했다. Shazam은 제목 `Monkeys Spinning Monkeys`, 아티스트 `Kevin MacLeod & Kevin`을 반환했다(서비스 메타데이터 그대로 표시). 모델 단계 0.744초. 직접 생성한 연주곡은 1.799초에 일치 없음으로 처리했다. 테스트 음원은 제품 소스에 포함하지 않는다.

초기 실패 기록: Whisper는 `temperature=None`의 Transformers 비교 오류로 실패해 `temperature=0.0`을 명시했다. ACE-Step 첫 로딩은 다운로드 필터에서 제외된 `tokenizer/chat_template.jinja` 때문에 실패했으며, 같은 공식 리비전의 파일을 추가하고 오프라인 재검증했다. 다른 모델이나 유료 서비스로 자동 대체하지 않았다.

로컬 검증 자료는 `.music-runtime/vocal-verification` 및 Worker의 해당 `job.json`/`vocal-result.json`에 보관한다. NAS가 새 작업 유형을 지원한다고 응답하기 전에는 새 생성·인식 버튼을 비활성화하며 채팅 보컬 요청도 안내만 표시한다. 아래 NAS 검증까지 완료했다.

보컬 폼은 기존 대화 작업 카드에 접수 식별자를 먼저 보관한 후 제출한다. 인식 파일의 POST 결과가 네트워크 오류로 불분명하면 샘플/옵션 해시별 접수 식별자만 sessionStorage에 남긴다. 같은 파일을 재선택해 다시 누르면 같은 식별자를 재사용하며, 접수 성공 응답 후 해당 식별자를 제거한다. 샘플 본문이나 연결 키는 sessionStorage에 저장하지 않는다.

Python 테스트 36개, Node 테스트 11개, typecheck/build 및 신규 파일 lint가 통과했다. 개발 화면과 최신 프로덕션 빌드 모두 1280×720 및 390×845에서 내용 표시·가로 넘침·콘솔 오류를 확인했다. 기존 NAS의 지원 정보가 없을 때, 유효한 가사/파일/동의를 입력해도 새 요청 버튼이 비활성화되는 것을 확인했다. 생성된 30초 MP3는 브라우저에서 duration=30, currentTime=7.684, readyState=4, error=null로 실제 재생했다.

보컬 테스트 후 기존 Stable Audio로 5초 연주곡을 새로 생성하고 WAV/MP3 검증을 통과해 모델 전환 회귀를 확인했다. 실제 마이크 권한 허용/녹음은 사용자 주변 소리를 수집하지 않기 위해 이번 자동 검증에 포함하지 않았다.

## NAS 적용 및 앱 통합 검증

DSM 로그인 복구 후 전용 프로젝트에 `voice-grok-music-service:vocals-v1`(이미지 `fb87fb77100f`)을 빌드해 적용했다. 기존 토큰·데이터·loopback 포트·Tailscale/CORS 경계를 유지했다. 공용 compose의 localhost 기본값이 운영 Tailscale 호스트를 거절하는 400 오류를 발견해, 배포용 compose에 기존 승인된 개인 NAS 호스트를 복구했다. 개인 주소는 저장소의 공용 compose에 하드코딩하지 않는다. `/health`의 `supportedTasks`는 instrumental/song/recognition이며 Worker는 READY로 복구했다.

최신 프로덕션 앱의 설정에서 실제 요청 3개를 제출하고, 새로고침 후 NAS 조회로 결과가 복구되는 것을 확인했다.

| 작업 | NAS 작업 ID | 모델 단계 | 배정 후 NAS 완료 |
|---|---|---:|---:|
| 한국어 보컬 30초 | `640e9186-5f13-4fec-baa2-b1bffd09e66c` | 로딩 6.818초 / 생성 12.069초 | 34.232초 |
| 제목·가수 찾기 20초 | `618695e3-cf90-4b7f-bbc2-4ace85e7ca72` | 1.845초 | 6.426초 |
| 한국어 보컬 가사 받아쓰기 30초 | `b19d44a7-aa71-400e-ae83-ae9d4391bdb6` | 9.274초 | 15.050초 |

대기열 및 서비스 재시작 후 브리지 재접속 대기를 포함한 접수→완료는 각각 72.034 / 41.929 / 35.718초였다. 보컬의 최대 할당 VRAM은 8091.59 MiB, 최대 자식 프로세스 RAM은 12134.84 MiB였다. 제목 결과는 `Monkeys Spinning Monkeys · Kevin MacLeod & Kevin`이며, 받아쓰기 결과는 표시되지만 일부 단어 오류가 있다.

보컬 WAV/MP3를 인증된 NAS API에서 내려받아 Worker의 크기 및 SHA256과 일치함을 확인했다. WAV SHA256은 `3f0a82022e5f315e9bf8c72baee0524f56d3f527f7aea83007edc4de58570e1b`, MP3는 `9443382919f9e0dc10049632b685930a4450fad8f75b356100235984e0d5594d`이다. 앱 MP3 재생은 duration=30, currentTime=25.243, paused=false, readyState=4, error=null로 확인했고, WAV 앱 저장 성공 안내도 확인했다. 다운로드 버튼은 무결성 확인 후 다운로드 요청을 완료했으나 자동화의 다운로드 이벤트 수신은 타임아웃해 브라우저 다운로드 파일 경로까지는 검증하지 않았다.

인식 작업의 공개 API 및 완료된 Worker job.json에 입력 audioBase64가 없고 자식 요청 파일도 남지 않는 것을 확인했다. 보컬 음원의 라이브러리 메타데이터는 ACE-Step으로 저장하도록 수정했다. 최종 build/typecheck가 통과했고, 개발 및 최신 프로덕션 PC/모바일 화면에서 실제 내용과 깨끗한 콘솔을 확인했다. 테스트 음원과 결과는 `.music-runtime/vocal-verification`에만 보관한다.

## 1.26.0 출시

새 사용 기능을 추가하는 minor 출시로 앱 표시·package.json·package-lock.json 버전을 1.26.0으로 맞췄다. 기존 기억/미디어 저장 및 백업 형식을 유지한다. NAS 배정 중인 `DISPATCHED` 상태도 작업 기록 복원에서 허용하도록 수정하고 회귀 검사를 추가했다. 출시에는 보컬 생성·파일/마이크 인식 UI·Windows 실행 및 모델 준비 도구·NAS API 확장과 검증 문서를 포함한다. 비밀키·모델 가중치·실제 음원·런타임 로그·개인 QA 파일은 업로드 범위에서 제외한다.
