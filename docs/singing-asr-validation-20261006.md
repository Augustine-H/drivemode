# 가창 전용 ASR 후보와 추가 언어 검증 — 2026-10-06

## 평가 범위

제품 기본 모델을 바꾸기 전에 가창 전용 후보를 같은 음원으로 비교하는 오프라인 검증이다. 제품 버전은 1.28.2, 기존 Qwen 받아쓰기와 저장 호환 형식을 유지한다. 이번 비교는 앱·NAS 통합 시험이나 새 마이크 녹음 시험이 아니다.

기존 중국어·태국어·베트남어 각 1곡에 다른 실제 가창 녹음을 1곡씩 추가했다. 전체 파일을 16 kHz mono PCM으로 변환하고, 30초 창/3초 겹침 및 기존 경계 합치기를 두 모델에 동일하게 적용했다. 6개 파일, 모델별 16개 창이다. 정답이나 곡 제목을 추론에 제공하지 않았으며, 음원·가사·인증 토큰을 외부 서비스에 전송하지 않았다.

중국어·태국어는 문자 오류율(CER), 베트남어는 공백 기준 단어 오류율(WER)이다. NFKC와 casefold 뒤 문자·숫자·결합 부호를 보존한다. 중국어 간체/번체나 동음 한자 치환, 태국어 성조 제거, 정답에 맞춘 후처리는 하지 않았다. 삽입·반복으로 100%를 넘는 오류율도 그대로 보고한다. 언어마다 단위와 정답 길이가 달라 서로의 점수를 직접 비교하지 않는다.

각 언어 2곡의 작은 평가이며, 역사적 녹음·합창·고전 가사의 영향이 있다. 정답은 해당 파일의 시간 자막 또는 기존 공식 자료이고 독립 청취 재검수는 하지 않았다. 언어 전체의 정확도나 일상적인 최신 대중가요 성능으로 일반화할 수 없다.

## 고정 모델과 실행 환경

- 기준: [Qwen/Qwen3-ASR-1.7B-hf](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf), revision `bcd2b5b7f32b480ab5790554cfa8347f246a14f3`, BF16/SDPA, 요청 언어 지정, greedy, 창당 최대 512 새 토큰.
- 후보: [ACE-Step/acestep-transcriber](https://huggingface.co/ACE-Step/acestep-transcriber), revision `53062cf7d0e09d463d7fc4c218ce2ecb71400f29`. 공식 가창/음성 전사 모델과 공식 `*Task* Transcribe this audio in detail` 프롬프트를 사용한다. 언어 자동 판정이며 기준 모델의 명시적 언어 지정과 조건이 다르다.
- 후보는 Transformers의 `Qwen2_5OmniThinkerForConditionalGeneration`으로 텍스트 인식 가중치만 로딩했다. 필요한 가중치의 누락/크기 불일치는 없었다. 사용하지 않는 Talker 293개/Token2Wav 809개 키는 음성 출력 모듈이며, 전체 1,102개의 추가 키와 정확히 일치한다. 다른 ASR 모델로 대체하지 않았다.
- RTX 4070 Ti 12 GB, 시스템 RAM 약 47.9 GiB, PyTorch 2.7.1+cu126, Transformers 5.18.0, CPU 스레드 8개. bitsandbytes 0.49.2 등 후보 의존성은 별도 로컬 디렉터리에 설치해 Worker 환경과 분리했다.
- BF16은 GPU 8 GiB/CPU 24 GiB 한도로 분산한 30초 smoke 시험이다. NF4는 사전에 계획한 별도 정밀도 비교이며 double quantization/BF16 계산, 전 가중치 CUDA 배치, greedy/512 토큰으로 전체 6곡을 처리했다. NF4 결과가 BF16 전체 정확도를 입증하지 않는다.

5개 safetensors 파일은 공식 HTTPS로 다운로드하고 각 크기와 LFS SHA-256을 확인했다. 다운로드 중 hf_xet의 `InvalidMessage(InvalidContentType)` 전송 오류가 발생했다. 정확한 네트워크 근본 원인은 규명하지 못했다. 인증·TLS 검증을 약화하지 않고 표준 HTTPS 범위 다운로드로 전환해 검증을 완료했다. 최종 범위 다운로드 단계는 1,731.858초이며, 초기 부분 다운로드와 진단 시간을 포함한 총 소요 시간은 아니다.

NF4 첫 실행은 모델 로딩 뒤 측정 코드가 없는 `hf_device_map` 속성을 읽어 `AttributeError`로 중단됐다. 추론 전 오류였고 Worker를 복구했다. 오류 기록을 보존한 뒤 실제 파라미터 장치 확인으로 측정 코드를 수정했다. 같은 모델·정밀도·입력 조건으로 재실행했다.

## 추가 음원 출처

| 사례 | 전체 길이 | 파일과 같은 시간 자막 |
|---|---:|---|
| 중국어 추가: 卿雲歌 | 41.935초 | [음원](https://commons.wikimedia.org/wiki/File:Song-to-the-Auspicious-Cloud-%E5%8D%BF%E9%9B%B2%E6%AD%8C-Modified_from_1921-1928_(Beiyang_government)_Anthem.ogg), [zh-hans 자막](https://commons.wikimedia.org/wiki/TimedText:Song-to-the-Auspicious-Cloud-%E5%8D%BF%E9%9B%B2%E6%AD%8C-Modified_from_1921-1928_(Beiyang_government)_Anthem.ogg.zh-hans.srt) |
| 태국어 추가: Sansoen Phra Barami, 보컬 녹음 | 91.231초 | [음원](https://commons.wikimedia.org/wiki/File:Sansoen_Phra_Barami_(vocal).ogg), [th 자막](https://commons.wikimedia.org/wiki/TimedText:Sansoen_Phra_Barami_(vocal).ogg.th.srt) |
| 베트남어 추가: Call to the Citizens | 67.000초 | [음원](https://commons.wikimedia.org/wiki/File:Call_to_the_Citizens-South_Vietnamese_Republic_of_Vietnam_National_Anthem.ogg), [vi 자막](https://commons.wikimedia.org/wiki/TimedText:Call_to_the_Citizens-South_Vietnamese_Republic_of_Vietnam_National_Anthem.ogg.vi.srt) |

중국어 추가 파일은 Joaquín2123의 CC BY-SA 4.0 녹음이다. 태국어·베트남어 파일의 공개 상태와 저작 정보는 출처 페이지를 따른다. 작사자·작곡자를 실제 가창자로 단정하지 않는다. 원본 음원과 전체 가사 자막은 Git에 포함하지 않는다. 기존 3개 파일의 출처와 평가 범위는 [1.28.1](music-validation-1281.md) 및 [1.28.2](music-validation-1282.md) 기록을 따른다.

## 측정 해석

RAM은 해당 Python 프로세스의 샘플링한 working set이며 시스템 전체 RAM 사용량이 아니다. GPU 메모리는 다른 앱을 포함한 장치 전체 사용량과 PyTorch 할당량을 구분한다. 샘플링 사이의 순간 최고치는 놓칠 수 있다. 로딩 시간은 캐시와 저장 장치 영향이 있으며 모델 간 고정 속도 순위로 해석하지 않는다.

BF16 30초 시험은 로딩 13.416초/추론 174.598초, 프로세스 RAM 최고 11,772.27 MiB, 장치 전체 GPU 메모리 최고 10,438 MiB, PyTorch 할당 최고 8,455.37 MiB였다. 태국어 대신 영어 효과음 설명을 반복했고 128 토큰 한도에 도달했다. 정상 가사 인식 성공이 아니며 전체 파일 오류율을 계산하지 않았다.

## 전체 파일 결과

아래 오류율은 낮을수록 좋다. 후보 출력의 알려진 Verse/Chorus 등의 구조 태그만 제외했다. 나머지 무관한 영어 설명·효과음 설명·반복 출력은 조용히 지우지 않고 기존 결과 보존 규칙과 오류 계산에 포함했다. 높은 오류율을 가사 인식 성공률로 환산하지 않는다.

| 사례 | 기준 Qwen 오류율 | ACE-Step NF4 오류율 | Qwen 추론 | 후보 추론 |
|---|---:|---:|---:|---:|
| 중국어 기존 49.776초, CER/84자 | 11.90% | 767.86% | 4.719초 | 55.649초 |
| 중국어 추가 41.935초, CER/24자 | 79.17% | 7,100.00% | 1.902초 | 80.882초 |
| 태국어 기존 44.234초, CER/216자 | 84.72% | 433.33% | 7.582초 | 38.753초 |
| 태국어 추가 91.231초, CER/117자 | 115.38% | 405.13% | 6.290초 | 21.787초 |
| 베트남어 기존 62.145초, WER/73단어 | 97.26% | 100.00% | 36.894초 | 15.221초 |
| 베트남어 추가 67.000초, WER/120단어 | 86.67% | 515.83% | 9.287초 | 82.536초 |

원본 길이 합계 356.322초의 전체 추론 합계는 기준 **66.674초**, 후보 **294.828초**였다. 로딩 시간은 제외했다. 기준은 16개 창 중 1개, 후보는 16개 창 중 5개가 512 토큰 한도에 도달했다. 한도 도달은 누락·반복 위험을 나타내며 정상 완료로 간주하지 않는다. 후보는 기존 Vietnamese를 `zxx`(비언어)로, Thai 추가를 `la`로 표시하는 등 언어 판정도 실패했다. 일부 Chinese/Vietnamese 창은 올바른 언어 코드를 출력했지만 가사 전체 오류율이 높았다.

| 실행 | 로딩 | RAM 최고, 로딩 포함 | 장치 전체 GPU 메모리 최고 | PyTorch 추론 할당 최고 |
|---|---:|---:|---:|---:|
| Qwen BF16, 전체 6곡 | 42.875초 | 4,110.14 MiB | 6,407 MiB | 4,074.77 MiB |
| ACE-Step NF4, 전체 6곡 | 16.500초 | 2,954.64 MiB | 8,888 MiB | 6,269.78 MiB |
| ACE-Step BF16, 30초 부분 시험 | 13.416초 | 11,772.27 MiB | 10,438 MiB | 8,455.37 MiB |

후보 NF4는 RTX 4070 Ti에서 CUDA로 실행됐고 OOM은 없었다. 실행 성공과 받아쓰기 정확도 성공은 구분한다. BF16 부분 시험에서도 설명 반복을 보였지만, 전체 BF16 비교를 수행하지 않아 NF4의 영향·Transformers 호환성·모델 자체 특성의 원인을 각각 분리했다고 주장할 수 없다. 체크포인트 해시와 로딩의 정상 확인만으로 의미적 인식 실패의 근본 원인을 확정할 수 없다.

## 결론과 서비스 상태

이 조건의 ACE-Step Transcriber 후보는 6곡 모두 기준보다 나빠 **제품에 채택하지 않는다**. 기준 모델 역시 추가 중국어 합창 및 Thai/Vietnamese 가창의 정확도가 낮다. 추가 사례 검증을 완료했지만 정확도를 개선했다고 보고하지 않는다. 실제 최신 가요 평가셋과 정답 청취 검수를 확대하고, 후보의 공식 실행 환경과 현재 환경 차이를 분리 검증하는 것이 이후 작업이다.

평가 전 인증된 Worker가 유휴이며 대기 작업이 없음을 확인했다. 8093 포트의 정확한 Worker 프로세스만 중단하고 공유 GPU 잠금으로 네이티브 자식 프로세스의 추론을 직렬 실행했다. 자식 종료 후 `finally`에서 Worker를 복구했다. 최종 인증 health의 `activeJobId=null`/대기 작업 없음, NAS 브리지 `IDLE`/`workerReady=true`를 확인했다. 기존 작업 이력이나 사용자 데이터는 변경하지 않았다.

제품 소스와 UI는 변경하지 않았으므로 이번 기록을 위해 버전을 올리거나 앱 빌드/브라우저 검증을 반복하지 않았다. 기존 1.28.2 제품 검증과 이번 로컬 후보 비교를 구분한다. 음원·원문 가사 없이 점수·시간·메모리·입력 WAV 해시를 보존한 [측정 JSON](singing-asr-measurements-20261006.json)을 함께 제공한다.

후속 [버전·입력 형식 분리 시험](singing-asr-compatibility-20261006.md)에서는 체크포인트에 기록된 Transformers 4.53.3으로 전체 6곡을 다시 처리하고 공식 시스템 프롬프트로 기존 3곡을 비교했다. 버전 또는 시스템 변경만으로 실패를 해결하지 못했다. 중국어의 점수 감소도 정확한 가사 증가가 아닌 무관한 삽입 출력 감소였다.
