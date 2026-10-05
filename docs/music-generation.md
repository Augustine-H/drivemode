# Voice Grok 로컬 음악 생성 — 구현·검증 기록

검토일: 2026-10-05 (한국시간). 사용자가 제공한 무료 우선 음악 생성 설계서 기준.

## 현재 단계

Phase 1: Hugging Face 인증·모델 다운로드·RTX 4070 Ti CUDA 추론 및 30/60/120초 실제 음악 생성 검증 완료.
각 음원의 44.1 kHz 스테레오 PCM 24-bit WAV 원본과 320 kbps MP3를 생성하고 전체 프레임을 디코딩해 길이·유효값·비무음을 확인했다.
Phase 2: Windows Music Worker REST API 구현 및 실제 생성·다운로드·재시작 검증 완료. 현재 PC 내부에서 인증을 거쳐 접근한다.
Phase 3: NAS 큐·음원 보관 서비스와 Windows outbound bridge 구현 및 DS218+ 실제 저장·다운로드 검증 완료.
Phase 4: 기존 Windows 사용자의 로그인 자동 시작 구성 및 예약 작업 실행 검증 완료.
Phase 5: Voice Grok 채팅 요청·작업 카드·재생·다운로드·기존 NAS 작업 복원 구현 및 실제 PC 브라우저 연동 검증 완료. 1.25.0 출시 반영을 진행한다.
청취에 의한 음악적 품질 평가, 휴대폰 실제 연결·마이크·재생, 공개 서비스 재게시, WOL은 별도 단계다.

## 공식 자료와 모델 결정

- [Stable Audio 3 공식 소스](https://github.com/Stability-AI/stable-audio-3), 고정 commit `3a82c807b69cf4b7c5c05270011a5d5e47abac18`.
- [Small Music 모델](https://huggingface.co/stabilityai/stable-audio-3-small-music): 1차 후보 `small-music`, 최대 120초. 공식 구현의 모델 설정에서 저장소 ID·샘플레이트를 읽고 다운로드된 snapshot revision을 기록한다.
- [공식 모델 비교·설치](https://github.com/Stability-AI/stable-audio-3#models): Small 모델로 시작. Medium은 추가 Flash Attention 의존성과 플랫폼 검증이 필요하므로 초기 대상에서 제외한다. 공식 성능 수치는 이 PC에서의 실측치로 사용하지 않는다.
- [공식 의존성](https://github.com/Stability-AI/stable-audio-3/blob/3a82c807b69cf4b7c5c05270011a5d5e47abac18/pyproject.toml): PyTorch/torchaudio 2.7.1. CUDA 12.6 Windows wheel을 격리 환경에 설치한다. Python 3.12.14 사용.
- [라이선스 안내](https://stability.ai/license): Community 조건 충족 시 무료 사용 가능. 적용 범위는 실제 모델 약관을 따른다. 모델 페이지는 Stability 조건 및 포함된 Gemma 조건 동의를 요구한다. 계정 소유자가 직접 동의해야 한다.
- [기존 Open 1.0](https://huggingface.co/stabilityai/stable-audio-open-1.0)은 최대 47초이므로 120초 요구의 기본 모델로 선정하지 않는다.

로컬 생성의 `$0`는 음악 생성 API 비용만 뜻한다. 전기·장비 비용은 포함하지 않는다.
클라우드 대체 호출 코드는 없으며 월 API 예산 기본값은 `$0`로 유지한다.

## 구현 파일

- `services/music/provider.py`: CUDA 전용 공식 모델 어댑터, 1–120초 입력 제한, 원본 WAV 검증·원자적 저장, FFmpeg MP3 인코딩, 파일 SHA-256, 실제 모델 provenance.
- `services/music/preflight.py`: CUDA kernel 실행, VRAM·RAM·버전, FFmpeg, 모델 접근 권한 확인. 토큰 값은 출력하지 않는다.
- `services/music/download_model.py`: 공식 Hugging Face snapshot 다운로드와 시간·파일 목록 기록. 다운로드와 오프라인 추론 시간을 분리한다.
- `services/music/diagnostics.py`: 실패 단계와 traceback을 기록하며 토큰·서명 URL의 비밀값을 제거한다.
- `services/music/benchmark.py`: 30·60·120초 실제 생성, 모델 로딩 시간, 생성 시간, 프로세스 RAM·CUDA 메모리·GPU 사용률 표본, WAV/MP3 검증, 실패 시 기존 WAV 보존. 실행별 독립 폴더와 단계별 JSON 기록.
- `services/music/setup.ps1`: 별도 Python 환경 설치·검사. 앱 Node 환경과 분리.
- `services/music/requirements-win-cu126.lock`: 이 PC에 설치한 전체 의존성 버전 고정. CUDA wheel은 setup에서 공식 PyTorch 저장소로 먼저 설치한다.
- `services/music/tests/test_provider.py`: 입력 제한, 잘못된 출력 거절, 실제 WAV/MP3 왕복, 인코딩 실패 시 원본 보존.
- `services/music/connect-huggingface.ps1`: 마스킹된 로컬 입력창에서 토큰을 받고 공식 모델 접근 검사 후 Windows DPAPI CurrentUser로 암호화해 `%LOCALAPPDATA%/VoiceGrok/Music/huggingface.dpapi`에 저장한다. 토큰은 채팅·코드·명령행·평문 파일에 기록하지 않는다.
- `services/music/credentials.py`: 이 Windows 사용자의 암호화된 토큰을 메모리에서 복호화하여 현재 Python 프로세스의 `HF_TOKEN`에만 설정한다. 명시적으로 전달한 기존 `HF_TOKEN`을 우선한다. 추후 Worker 자동 시작도 같은 Windows 사용자로 실행해야 한다.

큰 의존성·가중치·벤치마크 음원은 `.music-runtime/` 아래 또는 Hugging Face 사용자 캐시에 보관하며 Git에 추가하지 않는다. 비밀값을 담는 `.env` 파일은 생성하지 않는다.

개발자 재실행 경로(프로젝트 루트 기준):

```powershell
./services/music/setup.ps1 -Uv ./.music-runtime/bootstrap/bin/uv.exe -Python 3.12
./.music-runtime/venv/Scripts/python.exe services/music/preflight.py
./.music-runtime/venv/Scripts/python.exe services/music/download_model.py
./.music-runtime/venv/Scripts/python.exe -m unittest discover -s services/music/tests -v
./.music-runtime/venv/Scripts/python.exe services/music/benchmark.py
```

## 후속 단계에 적용할 설계 보완

1. **모델 검증이 먼저:** 접근 권한 설정 → 짧은 생성 → 30/60/120초 측정 → 청취 평가 후 Worker·NAS·UI로 연결한다. 무음/NaN/길이 검사는 음질 평가를 대신하지 않는다.
2. **NAS 통신:** 사용자는 Synology HTTPS 주소와 Tailscale 가능 여부를 제공했다. HTTPS GET은 200/HTML을 반환했으며 음악 API는 아직 없다. DSM 자격증명을 앱에 넣지 않고 전용 Music API와 별도 인증을 둔다. 브라우저/배포 서버에서 NAS까지 가능한 연결 경로를 먼저 확정한다. Tailscale은 배포 서버가 자동으로 접근할 수 있다는 뜻이 아니다.
3. **상태 판별:** health 실패는 PC 전원 꺼짐을 증명하지 않는다. Worker 장애·네트워크 장애와 구분할 수 없으면 `UNKNOWN`으로 남긴다. 이 경우 WOL 시도는 가능해도 자동 절전 권한을 부여하지 않는다.
4. **절전 기본값 OFF:** WOL 패킷 전송만으로 기동 원인을 증명할 수 없다. boot/session 식별, 사용자 활동, 다른 GPU 작업, 잠자기 직전 재검증을 확보하기 전에는 자동 절전을 활성화하지 않는다. 원래 켜져 있던 PC는 항상 제외한다.
5. **영속 작업 큐:** NAS의 로컬 컨테이너 볼륨에 SQLite와 단일 scheduler를 두는 구성을 우선 검토한다. DB 파일을 SMB 공유로 직접 열지 않는다. Worker에는 한 번에 GPU 작업 한 개만 전달한다. `requestId` 고유키와 payload hash로 동일 요청은 재사용, 같은 키의 다른 요청은 충돌 처리한다.
6. **재시작·취소:** 임대 만료만으로 실행 중인 GPU 작업을 재발행하지 않는다. Worker의 영속 `jobId` 상태를 조회하여 재조정한다. 취소는 요청과 완료를 구분하고, 결과 저장과 경합할 때 파일을 보존한다.
7. **업로드 복구:** WAV 생성 성공과 NAS 업로드 성공을 분리한다. 업로드 실패 시 로컬 spool 유지, hash 검증·원자적 commit 후에만 NAS 보관 완료로 표시한다. 다운로드 요청은 보관 완료로 간주하지 않는다.
8. **사용자별 보안:** 현재 웹앱은 `VITE_AUTH_ENABLED=false`이다. NAS 공용 서버 토큰을 인증 없는 웹 프록시로 노출하면 안 된다. 기존 사용자의 실제 인증 방식이나 별도 개인 접속 인증을 확정한 후 API 연결한다.
9. **보존:** 대화에서 참조를 제거해도 NAS 음원은 삭제하지 않는다. 앱의 기존 generated-media 30일 기본 정책이 NAS 보존 정책에 적용되지 않도록 분리한다.

## 완료 판정

### 실측 및 실행 결과

- Windows 11, RAM 47.91 GiB, RTX 4070 Ti, CUDA에서 확인한 VRAM 12,281 MiB.
- Python 3.12.14, PyTorch/torchaudio 2.7.1+cu126, NVIDIA driver 610.88.
- GPU 텐서 연산 `2² + 3² = 13` 실제 실행 성공.
- FFmpeg 7.1, WAV → MP3 인코딩 및 디코딩 검증 성공.
- Python 테스트 10개 통과(음원 보존 5개, DPAPI 암호화·복호화·손상·우선순위 4개, 오류 비밀값 제거 1개). 설치 패키지 44개의 의존성 검사 통과.
- 토큰 입력창의 WinForms 초기화 검사 통과. 모델 접근 검사를 통과한 토큰만 저장한다. 사용자가 값을 입력하는 창을 스크린샷으로 수집하지 않는다.
- 공식 `StableAudioModel` import 및 실제 CUDA 추론 성공. 선택적 Flash Attention 미설치·weight_norm 폐기 예정 경고는 있었으나 생성 실패는 없었다. 모델 교체·CPU 대체·유료 API 호출은 하지 않았다.
- 기존 앱 `npm run typecheck`, `npm run build` 통과. 기존 번들링 경고는 있음. 웹앱 UI 변경은 없다.
- 초기 인증 전 HTTP 401 / `GatedRepoError` 실패 기록은 `.music-runtime/benchmarks/20261004T174450Z-3295244e/benchmark.json`에 보존했다. 이후 사용자가 로컬 입력창에서 토큰을 연결했고 공식 저장소 접근 검사와 실제 다운로드에 성공했다.
- 성공 실행: `.music-runtime/benchmarks/20261004T180843Z-60026c37/benchmark.json`, 상태 `COMPLETED`. 실제 생성 파일 6개와 SHA-256·전체 디코딩 결과를 기록했다.
- 브라우저 HTMLAudioElement에서 WAV/MP3 6개 모두 재생 시간 증가와 중간 위치 탐색 후 재생을 확인했다. 결과는 같은 폴더의 `playback-result.json`에 보존했다. 음소거 재생으로 기술적 재생 가능성을 검사했으며 청취 평가는 수행하지 않았다. 최초 탐색 실패는 임시 Python 기본 HTTP 서버가 byte range를 지원하지 않아 발생했고, 범위 전송을 지원하는 로컬 검증 서버로 교체한 뒤 음원 변경 없이 모두 통과했다.
- 공식 snapshot: `0fef1392cd842149a2b6d445e181c97608faac06`. 다운로드 667.844초(약 11분 8초), 캐시에서 모델 로딩 31.018초. 처음 다운로드에 지연이 있었으나 설정을 바꾸거나 대체 경로를 사용하지 않고 원래 요청이 완료됐다.
- 모델 로딩 중 CUDA 할당 최고 2,178.61 MiB, 프로세스 RAM 표본 최고 5,141.52 MiB. 다운로드 시간을 모델 로딩 시간에 포함하지 않았다.

| 생성 길이 | CUDA 생성 시간 | CUDA 할당 최고 | CUDA 예약 최고 | 프로세스 RAM 표본 최고 | MP3 변환·검증 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 30초 | 16.999초 | 1,726.55 MiB | 2,622 MiB | 4,226.43 MiB | 0.522초 |
| 60초 | 0.908초 | 1,736.71 MiB | 2,622 MiB | 3,561.68 MiB | 0.821초 |
| 120초 | 0.906초 | 1,751.29 MiB | 2,706 MiB | 2,858.58 MiB | 1.609초 |

동일 프로세스에서 30 → 60 → 120초를 각각 한 번 실행한 값이다. 첫 호출과 후속 호출 조건이 다르므로 반복 평균이나 길이별 일반 성능으로 해석하지 않는다. 생성 시간은 공식 `generate()` 호출과 CUDA 동기화까지이며 CPU 배열 복사·WAV 저장·MP3 변환은 제외한다. 모델 로딩 시간은 Python import 이후 공식 `from_pretrained()` 호출부터 측정했다. RAM은 약 0.5초 간격 표본이므로 순간 최고값을 놓칠 수 있다. 전체 GPU 메모리 표본 최고는 4,264 MiB이며 다른 앱 사용량도 포함한다. 짧은 후속 생성의 GPU 사용률 표본은 각 2개뿐이다.

설정: FP16, batch 1, steps 8, CFG 1.0, seed 1042, chunked decode, torch compile 비활성화, 캐시 기반 오프라인 추론. 프롬프트는 `Instrumental 1980s synthwave, rainy Seoul night drive, warm analog synth chords, steady drums, 100 BPM, no vocals`.

WAV 길이는 각각 정확히 30/60/120초, 크기는 7,938,044 / 15,876,044 / 31,752,044 bytes다. MP3 크기는 1,202,720 / 2,402,263 / 4,802,394 bytes이며 전체 디코딩 후 길이도 일치했다. 실제 생성 API 비용은 $0.

품질 참고: 절대 샘플값 0.999 이상 비율은 각각 약 0.00079% / 0.01937% / 0.01674%다. 이 수치만으로 가청 왜곡을 판정할 수 없다. MP3 디코딩 peak는 1.0087 / 1.0211 / 1.0303으로 1.0을 조금 넘는다. 원본을 보존했고 자동 음량 보정은 적용하지 않았다. 재생·디코딩 성공과 음악적 품질 평가는 구분한다.

## Phase 2 — Windows Music Worker API

사용자가 Windows Music Worker API 구현을 승인해 진행했다. FastAPI 0.142.2 / Uvicorn 0.54.0을 기존 Python 환경에 추가했다. 기존 웹앱 화면·인증·DB는 변경하지 않았다. 요청 시 모델을 한 번 로딩하고 같은 프로세스에서 재사용한다. 캐시 기반 오프라인 추론이며 모델 자동 다운로드·다른 모델 대체·유료 API 호출은 하지 않는다.

### 실행과 인증

- 기본 주소: `http://127.0.0.1:8093`. 실행기는 loopback 주소만 사용하며 LAN·인터넷·Tailscale에 노출하지 않는다. 방화벽 변경·작업 스케줄러 등록은 하지 않았다.
- `services/music/start-worker.ps1`로 실행한다. Ctrl+C 정상 종료는 진행 중인 작업을 마무리하고 종료하며, 남은 대기 작업은 다음 시작 시 계속 처리한다. 강제 종료된 실행 중 작업은 `INTERRUPTED`로 남겨 자동 재생성을 막는다.
- Hugging Face 토큰과 별개인 384-bit 난수 API 키를 첫 실행에 생성한다. `%LOCALAPPDATA%/VoiceGrok/Music/worker-api.dpapi`에 Windows DPAPI CurrentUser 및 별도 entropy로 암호화한다. 키를 콘솔·소스·환경 파일·URL·로그에 쓰지 않는다. 동일 Windows 사용자로 실행해야 한다.
- 모든 경로에 `Authorization: Bearer <worker API key>`가 필요하다. `/health`, 음원 다운로드, `/openapi.json`도 포함한다. `worker_auth.worker_token()`으로 같은 사용자 컨텍스트의 로컬 클라이언트가 복호화한다. 자동 회전은 하지 않으며 손상된 키는 오류로 처리한다.
- CORS를 열지 않았고 `Origin` 헤더가 있는 브라우저 요청은 403으로 거절한다. NAS는 아래 Phase 3의 outbound bridge로 연결하며 Worker 자체의 공개 범위를 넓히지 않는다.
- 요청 본문 최대 16 KiB, 동시에 처리하는 HTTP 요청 최대 32, 미완료 작업 최대 8개, 새 작업 시작 전 여유 디스크 최소 2 GiB. 음원 경로에는 서버가 만든 UUID만 사용한다.

### API 계약

| 메서드·경로 | 결과 |
| --- | --- |
| `GET /health` | 프로세스 sessionId, 모델 상태, 진행 중 작업, 상태별 개수, 새 작업 접수 가능 여부. 정상 200, 소비자/GPU 오류로 접수 중단 시 503 |
| `POST /v1/jobs` | 새 요청 202 + job, 동일 요청 재전송 200 + 기존 job, 동일 requestId의 다른 내용 409 |
| `GET /v1/jobs?limit=20&offset=0` | 최신 작업부터 목록, limit 최대 100 |
| `GET /v1/jobs/{id}` | 작업 상태, 측정치, 모델 정보, 오류, 파일 메타데이터·다운로드 경로 |
| `POST /v1/jobs/{id}/cancel` | 대기 작업 즉시 취소(200), 진행 중이면 취소 요청(202), 이미 종료된 작업은 그대로 반환 |
| `GET /v1/jobs/{id}/audio/wav` | 검증된 WAV 원본. MP3 생성 실패·생성 중 취소 후에도 보존된 WAV 접근 가능 |
| `GET /v1/jobs/{id}/audio/mp3` | 검증된 MP3 |
| `HEAD /v1/jobs/{id}/audio/{wav,mp3}` | 파일 정보, Content-Length·ETag·SHA-256 |
| `GET /openapi.json` | 인증된 OpenAPI 명세. 외부 CDN을 쓰는 Swagger UI는 비활성화 |

설계서의 짧은 경로도 같은 처리기로 연결한다: `POST /generate`, `GET /jobs`, `GET /status/{id}`, `POST /cancel/{id}`. 본문 형식은 아래 공통 계약을 사용한다. 외부 요청 식별자는 `requestId`, Worker의 응답·조회 식별자는 서버가 발급한 `job.id`다.

```json
{
  "requestId": "music-request-001",
  "prompt": "Instrumental synthwave, rainy Seoul night drive, no vocals",
  "duration": 30,
  "seed": 1042,
  "bitrate": 320
}
```

`requestId`: 1–100자 영숫자 및 `_ . : -`. `prompt`: 공백 제거 후 비어 있지 않은 최대 2,000자. `duration`: 1–120 정수 초. `seed`: 0–2,147,483,647(기본 1042). `bitrate`: 128/192/256/320 kbps(기본 320). 알 수 없는 필드·잘못된 타입은 422다. 현재 모델 요청은 프롬프트 중심이며 별도 `instrumental`/가사 파라미터는 없다. 연주곡 요청은 프롬프트에 명시한다.

본문을 정규화한 hash와 requestId를 SQLite 트랜잭션으로 함께 저장해 동시 중복 요청도 한 작업만 생성한다. 같은 requestId의 내용을 바꾸려면 새 식별자로 제출해야 한다. 실패 작업 역시 자동 재시도하지 않는다. Worker 오류/종료/디스크 부족으로 접수를 막은 상태에서는 중복 POST도 거절될 수 있으므로 기존 작업은 GET으로 조회한다.

작업 상태:

```text
QUEUED → LOADING → GENERATING → VERIFYING_WAV → ENCODING → COMPLETED
             └──────── CANCEL_REQUESTED → CANCELLED
오류: FAILED / 실행 중 프로세스 종료 후 복구: INTERRUPTED
```

CUDA 호출 자체를 중간에 강제 중단하지 않는다. 진행 중 취소 요청은 즉시 `CANCEL_REQUESTED`로 기록하고, 추론이 끝난 후 WAV를 보존한 다음 MP3 변환을 생략한다. 이미 인코딩 중이라면 변환을 끝낸 파일까지 보존하고 `CANCELLED`로 마무리한다. 취소와 오류가 겹치면 실제 오류를 `FAILED`로 기록한다.

하나의 비동기 작업 스레드와 Windows 사용자 범위의 파일 잠금으로 이 Worker의 중복 실행·동시 GPU 작업을 막는다. 로딩/추론 오류 발생 시 추가 GPU 작업을 중단하고 health를 503으로 반환한다. MP3 인코딩 실패는 WAV를 남기고 해당 작업만 실패 처리한다. 단계·오류 타입·비밀값을 제거한 원인과 traceback은 로컬 SQLite에 남기고, API에는 traceback을 제외한 오류를 반환한다. 성공률/진행률을 추정한 가짜 숫자는 반환하지 않는다.

### 보관과 복구

기본 데이터: `.music-runtime/worker/`. `jobs.sqlite3`가 최신 상태의 기준이며 `audio/{jobId}/original.wav`, `preview.mp3`, `job.json`에 파일과 종료 시 스냅샷을 보관한다. `worker.log`에 jobId·단계·최종 상태를 기록하며 2 MiB × 최대 4개로 순환한다. 프롬프트·자격증명은 작업 로그에 기록하지 않는다. 원본 라이브러리 경고는 실행 프로세스의 stderr에 출력될 수 있다.

대기 작업은 재시작 후 이어서 처리하고, 이미 진행 중이던 작업은 자동 재발행하지 않는다. 파일 쓰기와 SQLite 기록은 서로 다른 트랜잭션이므로 그 사이 강제 종료 시 미등록 파일이 남을 수 있다. 해당 파일도 삭제하지 않으며 수동 복구 대상으로 보존한다. WAV 검증 기록을 먼저 확정한 뒤 MP3를 처리한다. 음원에는 자동 삭제/보존 기한을 적용하지 않는다. `job.json`은 종료 시 사본이므로 이후 재시작 복구 결과는 SQLite/API가 우선한다.

### 검증 결과 (2026-10-05 KST)

- Python 테스트 21개 통과. 인증·Origin/Host 제한·본문/입력 제한·동시 중복 요청·큐 한도·디스크 부족·GPU 직렬화·대기/진행 중 취소·실패 시 WAV 보존·CUDA 오류 후 중단·종료/복구·Windows 잠금 해제를 검사했다. fixture 음원은 단위 테스트에서만 사용했다.
- 실제 실행 중인 API에 30초·60초 생성 요청을 제출해 공식 CUDA 모델로 생성했다. WAV/MP3 4개를 HTTP로 다운로드하여 SHA-256, 길이, 전체 디코딩 및 Range 206 응답을 확인했다.
- 실제 API에서 중복 접수 200, 다른 내용 충돌 409, 무인증 401, 대기 취소를 확인했다. 두 생성 작업의 실행 구간은 겹치지 않았다. 상태 조회 응답의 관측 최대 시간은 0.212초였다.
- 생성 시간 30초 음원 1.409초, 60초 음원 2.236초(각 1회). 첫 모델 로딩 18.008초. 다른 시스템 작업과 동시 측정했으며 Phase 1과 조건이 달라 직접 속도 비교하지 않는다. 정확한 실측값은 아래 원본 JSON을 따른다.
- 작업 완료 후 프로세스를 종료하고 다시 실행해 인증키·작업 상태·취소 기록·음원 hash·중복 요청 결과가 유지됨을 실제 확인했다. 이 확인에서 음원을 다시 생성하지 않았다. 실행 중 강제 종료 상태 복구와 정상 종료 대기 동작은 별도 자동 테스트로 검증했다.
- 검증 기록: `.music-runtime/worker-api-verification/2981bb6a-031a-427a-b0fa-91ced0d35f89/report.json`.
- 실행 검증 도구: `services/music/verify_worker_api.py`; `--verify-restart <report.json>`는 기존 보고서를 사용해 재시작 보존만 검사한다. 토큰을 출력하거나 인자로 받지 않는다.
- 설치 의존성 52개 호환성 검사 통과. 웹앱의 `npm run typecheck`, `npm run build`도 통과했고 기존 번들링 경고는 유지된다. 이번 변경은 Python API만 대상으로 웹앱 화면은 수정하지 않았다.

구현 파일: `worker_api.py`(API), `worker.py`(단일 소비자), `job_store.py`(영속 상태), `worker_auth.py`(분리된 인증키), `start-worker.ps1`(실행). FastAPI 자원 수명 관리는 [공식 lifespan 문서](https://fastapi.tiangolo.com/advanced/events/)를 따라 구성했다.

## Phase 3 — 실제 NAS HTTPS 연결 및 음원 보관 검증 완료

2026-10-05 KST, 실제 DS218+의 `voice-grok-music` 프로젝트와 Windows RTX 4070 Ti Worker를 연결했다. NAS에 30초 생성 요청을 접수하고 GPU 생성 → NAS WAV/MP3 보관 → 재다운로드 → 전체 디코딩·브라우저 재생까지 통과했다. 최종 `/health`는 `workerState=READY`, 완료 작업 1개다. 로컬 모의 NAS 검증과 실제 NAS 검증 기록을 구분해 보존한다.

### 연결과 인증

```text
인증된 클라이언트 → NAS 사설 HTTPS → NAS Music Service 작업 큐
                                            ↑ 작업 확인 / 상태·파일 전송
                                   Windows NAS Bridge
                                            ↓ PC 내부 API
                                   Windows Music Worker → CUDA 생성
```

- 실제 음악 API는 기기별 설정에 등록한 Tailscale NAS HTTPS 주소를 사용한다. DSM 관리 주소와 별도이며 Tailscale Serve가 NAS loopback `127.0.0.1:8094`로 전달한다. 인터넷 공개용 Funnel은 사용하지 않았다. 접근 가능 장치는 기존 tailnet 정책을 따르며 PC 한 대만 허용하는 별도 ACL을 적용한 것은 아니다. 모든 API는 역할별 Bearer 인증이 추가로 필요하다.
- NAS Tailscale 1.90.8 (`100.89.157.18`), Windows Tailscale 1.102.4 (`100.123.210.13`)의 동일 tailnet 연결을 확인했다. NAS direct ping 2ms. 사용자가 HTTPS 인증서 발급과 공개 인증서 기록에 대한 동의를 완료했다. 인증서 검증을 켠 상태로 HTTPS 요청이 성공했다.
- DSM의 `VoiceGrok Music HTTPS Setup` 작업은 사용자 재인증 후 저장하여 한 번 수동 실행했다. 예약 활성화는 꺼져 있다. `enable_private_https.sh`는 기존 Serve 설정이 비어 있지 않으면 중단하며, 기존 설정을 덮어쓰지 않는다. 실행 결과는 `.music-runtime/nas-deployment/https-setup.log`에 보존했다.
- 일반 client 키와 bridge 키를 분리한다. client 키로 내부 제어·업로드를 호출할 수 없고, bridge 키로 사용자 작업을 접수하거나 보관 음원을 조회할 수 없다. 모든 경로 인증, Origin 차단, Host 제한을 적용한다. 무인증 `/health`는 실제 401을 확인했다.
- NAS 키를 Windows 사용자 DPAPI로 암호화해 `%LOCALAPPDATA%/VoiceGrok/Music/nas-bridge.dpapi`, `nas-client.dpapi`에 보관했다. 암호화·복호화 일치를 확인한 뒤 임시 다운로드 평문 키를 삭제했다. 키는 소스·로그·보고서에 포함하지 않는다. Hugging Face 토큰은 NAS에 전달하지 않았다.
- Windows Worker는 기존 loopback `127.0.0.1:8093`에서만 수신한다. Windows bridge가 NAS로 outbound HTTPS 연결하므로 PC 수신 포트 개방은 필요 없다. redirect는 자동 추적하지 않고 일반 HTTP 연결은 loopback 테스트 외에 거절한다.

### 서비스와 복구 계약

- `nas_api.py`, `nas_store.py`: CPU 전용 FastAPI, SQLite 큐·metadata와 WAV/MP3 저장. NAS에는 모델·CUDA·PyTorch 의존성이 없다.
- 클라이언트 경로는 Worker와 같은 `POST /v1/jobs`, `GET /v1/jobs`, `GET /v1/jobs/{id}`, `POST /v1/jobs/{id}/cancel`, `GET/HEAD /v1/jobs/{id}/audio/{wav,mp3}`, `GET /health` 계약이다. 요청 본문도 동일하다.
- 내부 bridge 경로: `POST /internal/worker/poll`, `POST /internal/jobs/{id}/status`, `PUT /internal/jobs/{id}/audio/{wav,mp3}`, `POST /internal/jobs/{id}/complete`.
- Worker에 동시에 한 작업만 배정한다. 배정된 작업은 NAS 재시작·통신 장애·시간 경과로 자동 재발행하지 않는다. 같은 Worker 보고로만 상태를 조정하며 다른 Worker로 자동 재배정하지 않는다.
- `nas_bridge.py`는 약 3초마다 상태를 보고하고 작업을 확인한다. heartbeat가 30초 이상 오래되면 `UNKNOWN`이며 PC 전원이 꺼졌다고 추정하지 않는다. 오류는 로컬 `status.json`에 비밀값을 제거해 기록하고 재시도 간격을 최대 60초까지 늘린다.
- 로컬 `requestId=nas:{NAS jobId}`로 중복 생성을 방지한다. 응답 유실 시 같은 식별자로 재확인하며 bridge 재시작 시 기존 localJobId를 조회한다. 해당 작업이 사라지면 새 음악을 자동 생성하지 않고 오류로 남긴다.
- 로컬 Worker 상태와 파일 SHA-256을 확인하고 고정 API 경로에서 파일을 받아 NAS에 보낸다. 원본 Windows 파일도 보존한다. NAS는 파일별 최대 64 MiB, 길이·hash 검사, 임시 파일 → 원자적 rename → DB 기록 순서로 저장한다.
- 생성 완료는 `UPLOADING`을 거쳐 기대 파일이 모두 NAS에 저장된 뒤 `COMPLETED`가 된다. 인코딩 실패 시 WAV를 보존하고 `FAILED`로 남긴다. 같은 hash는 재사용하고 다른 내용은 409로 중단하여 덮어쓰지 않는다. rename 후 DB 기록 전 장애는 재전송으로 복구 가능하다.
- 보관: `/volume1/docker/voice-grok-music/nas/data/media/{NAS jobId}/original.wav`, `preview.mp3`, `metadata.json`. `data/jobs.sqlite3`가 상태 기준이다. 자동 삭제·보존 기한은 적용하지 않는다.

### 실제 NAS 배포

- 프로젝트: `voice-grok-music`, 경로 `/volume1/docker/voice-grok-music/nas`. 기존 다른 프로젝트는 변경하지 않았다.
- Python 3.12.15 CPU 컨테이너, UID 10001, 읽기 전용 root filesystem, capability 전체 제거, no-new-privileges, 메모리 상한 384 MiB. 이미지 prefix `d6df933398e6`.
- 최초 `cpus: 1.0`은 NAS 커널 CFS quota 미지원으로 `NanoCPUs can not be set` 오류가 발생했다. 지원하지 않는 CPU 상한만 제거하고 실제 재배포에 성공했다. CPU 하드 상한은 없다.
- `music-init`은 네트워크 없이 전용 data/secrets 디렉터리와 난수 키를 최초 생성하며 기존 키는 바꾸지 않는다. 키 파일 0400, 디렉터리 0700, UID/GID 10001. 초기화 후 본 서비스는 secrets를 읽기 전용 마운트한다. 비밀값을 환경변수나 이미지에 넣지 않는다.
- 실제 NAS에 최신 `compose.yaml`의 Tailscale hostname 허용 목록을 반영하고 해당 프로젝트만 재생성했다. 음악 서비스의 인증된 healthcheck와 DSM `정상` 상태를 확인했다. 이 재생성은 실제 음원 요청 전에 수행했으며, 생성 후 실제 NAS 재시작 보존 테스트를 수행한 것은 아니다.
- `package_nas.py`는 필요한 11개 파일만 선택해 배포 ZIP을 생성한다. 모델·토큰·키·음원·DB는 포함하지 않는다. 별도 일회성 HTTPS 설정은 `enable_private_https.sh`에 기록한다.
- 증빙: `.music-runtime/nas-deployment/nas-private-https-healthy.jpg`, 배포 기록: `.music-runtime/nas-deployment/deployment-status.json`.

### 검증 결과

- 기존 Worker 포함 Python 테스트 32개 통과: 역할별 인증, 중복 접수, 배정 유지, 취소, 업로드 무결성·한도·충돌, Range, 실패 시 WAV 보관, 응답 유실 복구, heartbeat, DPAPI 저장 등을 검사했다.
- 선행 로컬 검증은 `.music-runtime/nas-flow-verification/9bad0ecc-b8bf-4420-a037-3d160b90bc77/report.json`이며 `physicalNasVerified=false`다. 로컬 서비스 재시작 보존 검증은 이 기록에 해당한다.
- **실제 NAS 보고서**: `.music-runtime/physical-nas-verification/62158291-771c-4fec-91d9-e9b2142ad674/report.json`. `passed=true`, `physicalNasVerified=true`, 실제 GPU 작업·NAS archive hash·전체 디코딩·Range 206·중복 접수·무인증 거절 검증을 통과했다.
- NAS jobId `137779ee-5cc6-41cc-b66e-1cbc39ae3776`, Worker jobId `311e498e-a835-4c80-ab1d-b628b7833271`. 실제 로컬 GPU 작업과 NAS 파일 metadata가 일치한다.

| 실제 NAS 30초 테스트 측정 | 결과 |
| --- | ---: |
| GPU 생성 시간 | 0.852초 |
| 요청부터 완료 관측까지 | 34.565초 |
| CUDA 할당 최고 | 1,728.15 MiB |
| CUDA 예약 최고 | 2,622 MiB |
| WAV 원본 | 7,938,044 bytes / 44.1 kHz / stereo / 30초 |
| MP3 | 1,202,720 bytes / 320 kbps / 30초 |
| 생성 API 비용 | $0 |

모델이 이미 로딩된 상태에서 1회 측정했다. 전체 완료 시간에는 bridge의 초기 연결 재시도 대기와 polling이 포함된다. 보고서의 모델 `loadSeconds=6.888`은 같은 Worker의 이전 로딩 metadata로, 이번 NAS 테스트의 신규 로딩 실측이 아니다. 이번 테스트에서 RAM 최고값은 측정하지 않았다. 위 결과를 반복 평균이나 길이별 일반 성능으로 해석하지 않는다.

WAV/MP3 모두 전체 디코딩 1,323,000 frames, 정확히 30초였다. 재다운로드한 동일 파일을 브라우저에서 음소거 재생하여 두 형식 모두 8초 이상 재생 시간 증가, 오류 없음, `readyState=4`를 확인했다. 초기 임시 기본 HTTP 검증 서버에서 MP3 로딩이 멈춰 byte range를 지원하는 검증 서버로 교체했다. 음원 파일은 변경하지 않았고, 실제 NAS API의 Range 206은 별도로 이미 통과했다. 상세 결과는 같은 폴더의 `browser-playback.json`이다. 기술적 재생 검증이며 음악적 청취 평가는 수행하지 않았다.

NAS 컨테이너에는 `unless-stopped` 재시작 정책이 적용되어 있다. 임시 브라우저 검증 서버는 종료했다. Windows 로그인 자동 시작은 아래 Phase 4에서 구성했다. WOL·Voice Grok 채팅 플레이어·Media Library UI·자동 절전은 아직 구현하지 않았다.

## Phase 4 — Windows 로그인 자동 시작

사용자가 자동 시작 구성을 승인하여 `VoiceGrok Music - Logon` 예약 작업을 등록했다. 현재 Windows 사용자가 로그인한 뒤 15초 지연하여 실행하며, `InteractiveToken` / `Limited`로 Windows 비밀번호 저장이나 관리자 권한 상승 없이 동작한다. 부팅 직후 로그인 전 실행이나 WOL 기능은 아니다.

- 등록: `services/music/install-autostart.ps1`. 해당 사용자의 로그온 trigger, 중복 실행 IgnoreNew, 시작 지연 15초, 네트워크 준비 조건 없음, 배터리 전환 시 중지 안 함, 실행 시간 강제 제한 없음. 시작 프로그램 실패에만 1분 간격 최대 3회 재시도한다. 같은 이름의 다른 작업은 덮어쓰지 않는다.
- 실행: `services/music/autostart.py`를 가상환경 `pythonw.exe`로 호출하고, Worker와 bridge는 `CREATE_NO_WINDOW`로 창 없이 시작한다. 같은 사용자·가상환경·기존 DPAPI 자격증명을 사용한다. 정상 실행 중인 서비스는 파일 잠금으로 감지해 유지한다.
- Worker가 준비되고 bridge 잠금을 확인하면 시작 프로그램은 종료된다. bridge 자체의 기존 연결 재시도 루프는 Tailscale/NAS가 늦게 준비되는 상황을 처리한다. 시작 성공 이후 Worker의 임의 오류를 자동 재기동하거나 실패한 음악 작업을 재발행하는 상시 감시 기능은 추가하지 않았다.
- 초기 예약 실행에서 `WORKER_CREDENTIAL_NOT_INITIALIZED`가 발생했다. 원인은 Codex MSIX AppData 가상화로, 도구 실행과 예약 작업이 같은 논리 경로에서 서로 다른 파일을 봤기 때문이다. 설치 시 Windows `GetFinalPathNameByHandleW`로 기존 암호화 파일의 실제 경로를 확인하고 `.music-runtime/autostart/config.json`에 비밀값 없는 경로 설정을 저장한다. 시작 프로그램과 자식 프로세스는 이 실제 LOCALAPPDATA 경로를 사용해 기존 인증 파일·프로세스 잠금을 공유한다. 키 복사·재발급·복호화 평문 저장은 하지 않았다.
- 실행 상태: `.music-runtime/autostart/status.json`. 시작 로그: `worker.log`, `bridge.log`; 2 MiB 이상이면 다음 해당 프로세스 시작 시 이전 로그 1개를 보관한다. 작업 설정 XML: `task.xml`. 생성 요청 시 모델을 로딩하는 기존 동작은 유지한다.
- 저장소, 가상환경, 모델 캐시, 실제 자격증명 폴더가 현재 위치에 있어야 한다. 경로 변경 시 설치 스크립트로 다시 등록한다. 자동 시작 해제는 해당 예약 작업을 사용 안 함으로 바꾸면 되며, 이미 실행된 Worker/bridge는 별도로 종료해야 한다.

검증: 실제 예약 작업을 수동 실행해 종료 코드 0을 확인했다. 기존 두 서비스를 유지하는 재실행과, 작업이 없는 상태에서 두 서비스를 종료한 뒤 예약 작업이 새 프로세스를 기동하는 상황을 모두 검사했다. 재기동 전 작업 5개·음원 8개 및 DPAPI 파일 hash가 유지됐고, NAS가 새 Worker sessionId로 READY를 보고했다. 반복 실행은 같은 세션을 유지하며 중복 프로세스를 만들지 않았다. 실제 로그아웃·Windows 재부팅은 수행하지 않았다.

검증 보고서: `.music-runtime/autostart/verification.json`. 설정 참고: [Microsoft 예약 작업 설정 문서](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset?view=windowsserver2025-ps).

예약 작업이 시작한 새 Worker에서 실제 NAS 30초 생성 요청도 성공했다. 보고서: `.music-runtime/physical-nas-verification/5bf6bc42-cc63-48c8-9dd9-06f59f9ae46c/report.json`. WAV/MP3 저장·재다운로드·SHA-256·전체 디코딩·Range 206 검사를 통과했다. 모델 신규 로딩 7.057초, GPU 생성 1.253초, 전체 완료 관측 25.258초(각 1회)다.

## Phase 5 — Voice Grok 화면 연결 (실제 NAS 연동 검증 완료)

채팅·음성의 명시적 연주곡 요청을 NAS 작업으로 연결하는 코드를 추가했다. `music-model.ts`는 한국어/영어 생성 의도, 1~120초 길이, 연주곡 제한, 백업 작업 참조 형식을 검증한다. `reader-app.tsx`에서 일반 답변·음악 식별과 분리해 요청하며, 완료 시 채팅 상태와 배너를 갱신한다. 실제 음성 인식은 기존 받아쓰기→ask 경로를 공유한다.

`music-client.ts`는 브라우저에서 사설 Tailscale NAS HTTPS로 직접 연결한다. Vercel 서버가 tailnet에 접속한다고 가정하지 않는다. 사용하는 각 기기도 Tailscale 연결이 필요하다. NAS 주소·클라이언트 키는 음악 설정에서 사용자 입력 또는 연결 파일(schema 1, type voice-grok-music-connection)로 등록한다. 연결 확인에 성공한 때만 키를 비추출 AES-GCM CryptoKey와 암호화 값으로 전용 IndexedDB에 저장한다. 이 저장소는 Memory/Media 백업과 별개다. 브라우저 origin의 스크립트는 API를 사용할 수 있으므로 이 방식이 XSS로부터 키 사용을 차단하는 것은 아니다. 소스·URL·로그·서버 환경변수에 키를 넣지 않는다.

`MusicJobCard`는 3초 간격으로 실제 상태를 조회하고 취소를 요청한다. 실패 작업의 자동 재생성은 하지 않는다. 접수 응답 유실 시 기존 requestId로만 확인한다. 새로고침/복원 후 jobId가 없으면 사용자가 재확인 버튼을 눌러야 POST를 수행한다. 기존 jobId가 있는 작업은 조회만 한다. HTTP 다운로드는 최대 64 MiB, 기록된 byte 길이와 SHA-256을 검사한 뒤 재생·저장한다. MP3는 기존 미디어 저장소에 임시 원본으로 보관하여 새로고침 후에도 재생한다. WAV 원본은 NAS에 유지하고 다운로드/앱 저장을 사용자가 선택한다. 로컬 휴지통·삭제 항목을 자동으로 되살리지 않는다. 기존 NAS 작업은 목록에서 채팅에 연결할 수 있다.

NAS `ApiBoundary`에 정확한 origin 목록의 preflight와 CORS 응답을 추가했다. NAS의 내부 bridge 경로는 브라우저 접근을 계속 차단하고 Worker 자체의 Origin 정책은 유지한다. 클라이언트 키 인증은 모든 실제 API 요청에 필요하다. 준비된 허용 출처: https://drivemode.grok.me, 개발 검증 http://127.0.0.1:8080, 빌드 검증 http://127.0.0.1:8081. wildcard 출처나 공개 Funnel은 사용하지 않는다.

2026-10-05 사용자 접근 허용 승인 후 두 Python 소스와 compose를 전용 NAS 음악 폴더에 반영했다. DSM 프로젝트 빌드가 기존 이미지를 재사용하므로 새 태그 `voice-grok-music-service:browser-v1`로 실제 소스를 재빌드했다(image e14d4cd29518, container c3e921c40d32670b2bc56c67a173fe1e04fc17f7c2ea0001b5ef3038dde2db56). NAS 정상 health, 세 허용 origin의 preflight 200, 비허용 origin/내부 브라우저 경로 403, 무인증 health 401을 확인했다. 기존 키·작업·음원은 유지했다.

검증: Python 33개, 음악 의도/범위/백업 참조 테스트 3개, 타입 검사·빌드 통과. 새 음악 파일 lint 오류/경고 0. 개발·빌드 화면을 데스크톱과 390×844에서 확인했고 가로 넘침이 없었다. 실제 UI에서 미연결 생성 요청이 설정 안내로 처리됨을 확인했다. 빌드 화면 error 로그 0. 기존 ReaderApp hooks 경고 4개는 유지된다. 상세 기록: `.music-runtime/music-app-integration/report.json`. Linux 전용 smoke/preview 재시작 도구는 실제 Windows 환경에서 동작하지 않아 동일 npm scripts와 Codex 브라우저로 대체 검증했다.

앱 버전은 1.23.0으로 유지했고 GitHub commit/push와 공개 배포는 수행하지 않았다. 버전 변경·출시는 실제 NAS 웹앱 검증을 마친 뒤 진행한다.

실제 개발 UI에서 “잔잔한 피아노 음악 30초 만들어줘”를 접수해 NAS 작업 `e203ea83-93b6-40a3-8a34-4e0f82ff1865`가 COMPLETED가 됐다. 모델은 RTX 4070 Ti CUDA, GPU 생성 0.845초, NAS 접수→저장 완료 9.393초(각 1회, warm model), 최대 할당 VRAM 1728.15 MiB / 예약 2622 MiB. WAV 7,938,044 bytes와 MP3 1,202,720 bytes의 실제 브라우저 다운로드가 NAS 길이·SHA-256과 일치했다. MP3 30초 duration, readyState 4, 재생 시간 0.018→6.292초 진행, 빌드 UI 5.379초 진행을 확인했다. 음악 품질은 별도 청취 평가가 필요하다.

작업 카드 취소 요청은 `d7738c3a-a426-473c-9d58-6c4dd01f63b1`를 0.611초 만에 CANCELLED로 만들었고 GPU 작업·음원을 만들지 않았다. 새 브라우저 세션에서 기존 완료/취소 참조와 암호화 연결이 유지됐으며 NAS 작업 수는 4개로 중복 생성되지 않았다. 빌드 화면 NAS 목록에서 기존 음원을 채팅으로 복구, 재생, WAV 앱 저장을 확인했다. 연결에 사용한 ACL 제한 임시 평문 파일은 두 브라우저 origin 등록 후 삭제했다. 브라우저 다운로드 이벤트 도구는 파일 저장을 감지하지 못해 실제 Downloads 파일을 검증했다. 개발 서버가 검증 중 종료되어 재시작한 뒤 새 세션으로 복원을 확인했다. 새 세션 개발·빌드 runtime error 0, 390px 화면 scrollWidth 390. 증거: screenshots/music-live-built-desktop.png, music-live-built-mobile.png, music-nas-browser-access-applied.png.

휴대폰 실제 마이크 받아쓰기, 휴대폰 Tailscale 연결·PWA 재생, 공개 서비스 배포는 아직 검증하지 않았다. 휴대폰도 동일 tailnet 연결과 기기별 음악 연결 등록이 필요하다. WOL은 계속 꺼져 있다. GitHub 업로드와 버전 변경은 수행하지 않았다.

## 1.25.0 출시 검증 · 2026-10-05

위의 버전·GitHub 미반영 상태는 이번 출시 작업으로 갱신한다. 보존된 음악 서비스와 화면 연결 소스를 기존 1.24.0 저장 수정본에 통합하고 앱·패키지·lockfile 버전을 1.25.0으로 맞췄다. API 키·모델 가중치·생성 음원·런타임 로그·임시 폴더 권한 검증 페이지는 커밋 범위에서 제외한다.

- scripts 328개, TypeScript 59개(음악 검사 4개 포함), Python 서비스 33개: 합계 **420개 통과**. 타입 검사, production build, 음악 소스 lint 통과.
- Memory archive 회귀 검사를 추가했다. 음악 작업 ID·요청·상태·미디어 참조가 실제 백업 파서를 거쳐 유지되고, 설정의 음악 연결 자격증명은 백업에 들어가지 않는다.
- 현재 NAS 조회에서는 기존 작업·음원이 유지됐으나 bridge heartbeat가 오래돼 Worker 상태가 UNKNOWN이었다. 기존 `VoiceGrok Music - Logon` 예약 작업을 실행해 Worker 중복 기동 없이 bridge를 시작했고, 앱에서 `NAS 연결 정상 · Windows Worker 준비됨`을 확인했다. 자동 시작 등록이나 권한은 바꾸지 않았다.
- 1.25.0 개발 채팅에서 `출시 검증용 잔잔한 피아노 음악 5초 만들어줘`를 요청했다. 작업 `c65723e6-3bd8-469f-8396-9f720e09ecc4`가 COMPLETED가 됐으며 WAV 1,323,044 bytes와 MP3 202,753 bytes를 NAS에서 독립적으로 다시 읽어 크기·SHA-256·전체 디코딩 길이 5초를 검증했다. 실제 결과는 로컬 `.music-runtime/release-125/nas-verification.json`에 보존한다.
- 새 production build에서 NAS 작업 목록의 위 음원을 채팅에 연결했다. 새 생성 요청 없이 기존 결과를 불러왔고, MP3 재생 시간이 0.15598초에서 5초까지 진행됐다. 데스크톱·390px 모바일 화면을 직접 확인했으며 document 가로 넘침과 runtime error 로그가 없었다. 화면 증거는 `screenshots/music-125-{dev,built}-{desktop,mobile}.png`에 로컬 보존한다.
- 배포용 compose에서 개인 NAS 호스트명을 제거했다. 신규 NAS 설치 시 DSM 프로젝트 환경의 `MUSIC_ALLOWED_HOSTS`에 실제 HTTPS 호스트명을 지정해야 한다. 값이 없으면 localhost/127.0.0.1만 허용한다. 현재 운영 NAS 설정은 이번 출시 작업에서 변경하지 않았다.

**출시 범위:** 1~120초 연주곡 생성, 실제 상태 조회·취소 요청, NAS WAV/MP3 보관, 채팅 MP3 재생, 해시 검증 후 다운로드, WAV 앱 보관, 기존 NAS 작업 다시 열기. 해당 PC가 켜져 있고 Worker와 NAS bridge가 연결되어야 새 음악을 만들 수 있다. API 유료 대체 호출과 WOL은 없다. 공개 앱 재게시 및 S26U의 실제 Tailscale 연결·생성·재생은 별도 검증으로 남는다.
