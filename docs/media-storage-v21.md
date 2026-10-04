# Voice Grok Memory & Media Storage v2.1

## 조사 · 2026-10-05 (한국시간)

기준 commit: 652e582. 앱 1.22.0, React 19/TypeScript/TanStack Start/Vite 웹/PWA. README.md 없음. Windows 작업 폴더에서 기존 npm scripts를 사용한다. 공개 origin은 https://drivemode.grok.me이며 실제 S26U 브라우저 버전, PWA 설치 여부, DS218+ DSM/Drive 버전은 원격 검증하지 못했다.

| 영역 | 실제 경로/구조 | 변경/위험 |
|---|---|---|
| API | ask-grok.ts, routes/api/ask.ts: grok-4.5, /v1/responses, SSE, store:false, 512/1024 출력, 호출40, timeout35초 | 모델 변경 없음. 공식 현재 모델 목록에서 이 모델 입력 한도를 확인할 수 없어 앱의 보수적인 요청 상한과 미확인 표기를 사용 |
| Context | grok-context.ts/context-budget.ts: 정의4000, 기억2400, 요약1200, 최근6000, 질문2400 추정토큰 | 4턴/180자/700자 절단은 이미 제거됨. 역할 분리·페르소나 격리 유지 |
| Memory | memory-engine.ts/use-memory-v2.ts: 로컬 발췌 요약, 명시적 사실, 키워드 인덱스 | 수정/삭제와 삭제표시를 추가. 과거 사실 재추출/요약 잔존 방지 |
| 가져온 기억 | persona-memory.ts: 60파일, 파일당16000자, 합계60000자; 템플릿60000자 | 원본 한도는 유지 |
| 대화 저장 | app-storage.ts: voice-grok-memory-v2 (DB1), 6stores; legacy nangdok-v1 보존 | 미디어 ID 참조 추가, 기존 DB 유지 |
| 사진/영상 | ReaderApp paint/film: imagine.ts 서버 API → HTTPS URL을 Turn.image/video에 저장 | 현재 remote URL만으로 원본 보존 안 됨. 바이트 확보 성공/실패 구분 |
| 영상 분석 | video-frames.ts, /api/video-source: 허용된 xAI host proxy 및 화면3장 | 로컬 Blob URL도 기존 canvas 경로에서 분석 |
| 보이스메일 | voice-mail.ts: voice-grok-voice-mail/messages Blob[], 1MB/메일, 최대40개 | 기존 재생·답장 유지, 미디어 원본 연결. TTS cache는 영구 저장 제외 |
| 프로필 | persona-profile.ts: 크기 조절한 data URL, Dropbox 별도 백업 | 프로필 포함 Memory 백업 호환 유지. 대화 미디어와 구분 |
| 백업 | nangdok-backup.ts: app:nangdok/version1/schemaVersion2 JSON, settings whitelist | 새 .vgb JSON archive/hash/AES-GCM 옵션, media 별도 manifest/원본 내보내기, legacy 호환 |
| 기타 저장 | 폴더 handle/메일 등 별도 IDB, Cache Storage는 PWA 자원용 | 바이트 새 어댑터 OPFS + IDB fallback. Object URL은 재생용만 |
| 음악 | Audio Awareness 음악 지문 식별 존재; 음악 생성 API 없음 | music 파일 업로드/저장 유형만 지원. 생성 미구현 |

## 구현 단계와 파일 계약

1. `media-model.ts`: 스키마, 참조, 보존 상태 전이, 가용성, 정확한 bytes 집계와 가짜시계 테스트.
2. `media-db.ts`, `media-storage.ts`, `media-repository.ts`: 인덱스·Blob·journal·settings·snapshots·staging·backup 기록. 안전한 ID 파일명, OPFS 실제 쓰기검증 후 IDB fallback. 직렬화 lock/DB lease/revision으로 충돌 보호.
3. `use-media-library.ts`, `managed-media.tsx`: 기존 URL의 보존 보호 migration, 생성/업로드/메일 연결, 새로고침 후 Object URL 재생성, 누락 표시. 원본 제거 없이 checkpoint 재개.
4. `storage-backup.ts`, `media-export.ts`: Memory archive/암호화·hash 검증/staging/적용전 snapshot, media manifest/파일별 export/재연결. 외부 NAS 검증과 다운로드 요청은 구분.
5. `storage-settings.tsx`: 라이브러리/보존 정책/휴지통/용량/백업/복원/안내. 기존 접힌 설정 토큰 유지.
6. Memory Engine/ReaderApp/voice-mail/backup 연결: 삭제 기억 tombstone, partial 응답, 삭제 범위 선택, 미디어 분석 참조.
7. 테스트·typecheck·lint·build·개발/배포 브라우저 확인, 소스만 작은 commit/push.

## 플랫폼 근거

- [MDN 저장 quota](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): estimate는 origin 추정치, persist는 사이트 데이터 삭제 방지가 아니다.
- [MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system): origin 내부, Drive가 읽는 외부 백업 폴더가 아니다.
- [MDN 폴더 선택](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker): 제한된 지원/사용자 클릭 필요. 실제 쓰기/다시 읽기 검증을 통과한 때만 verified.
- [Web Crypto deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey): PBKDF2 SHA-256 + AES-GCM을 사용하며 암호를 보관하지 않는다. S26U 성능은 미검증.
- [Synology Drive Android](https://kb.synology.com/en-us/DSM/help/Drive/Android?version=7): 설치 환경에서 업로드/백업 mode와 삭제 전파 확인 필요. NAS worker/관리자 인증은 추가하지 않는다.

## Synology 사용 절차

1. 앱에서 Memory .vgb와 Media 파일/manifest를 **기기로 내보내기**. 다운로드 목록에서 파일을 확인한다. 메모리 암호화와 미디어 암호화는 별개이며 이 버전 Media는 plaintext다.
2. Drive의 실제 설치 버전에서 백업 작업이 지원되는지 확인하고, 방금 내보낸 독립 폴더를 선택한다. OPFS/브라우저 저장소를 선택하지 않는다.
3. NAS에 `VoiceGrok/MemoryBackups/deviceId/`, `Media/Saved/type/`, `Media/Temporary/type/`, `Manifests/`를 기기별로 분리한다. 앱이 폴더를 고른 경우 상대 경로로 만든다.
4. 업로드 방향/삭제 전파/최대 파일 크기/Wi-Fi·배터리 조건을 확인한다. 로컬 휴지통 삭제가 NAS 유일 사본에 전파되지 않는 모드를 선택한다.
5. NAS 파일을 내려받아 앱의 검증/복원으로 확인한다. 앱에서 NAS 서버 완료를 직접 조회할 수 없으면 **외부 동기화 상태 확인 불가**로 남긴다.
6. 일별7/주별4/월별6 세대는 수동 보존 계획이다. 새 백업 검증 전 이전 파일을 제거하지 않는다. NAS-side 정리/앱 종료 후 예약 자동화는 구현하지 않는다.

## 완료 기능 · 앱 1.23.0

| 역할 | 파일 / 주요 함수 | 사용자 동작 |
|---|---|---|
| 미디어 모델·정리 | media-model.ts: newMedia, transitionMedia, retentionAction, detachMediaReferences, mediaTotals | 생성물 임시(이미지·음악30일, 음성·오디오·영상14일), 업로드 보관, 휴지통 발견 시점부터7일. 보관은 자동 만료 안 함 |
| 파일 저장·복구 | media-storage.ts: storeMediaBlob/sourceBlob, media-repository.ts: ingestMedia/recoverMediaJobs/purgeMedia | 실제 쓰기·close·다시 읽기·SHA-256 확인 후 로컬 완료. 중단 journal 복구, 실패 시 missing/remote-only/deletion-pending |
| 저장소·동시 작업 | media-db.ts: mediaTransaction/withMediaLock | 별도 voice-grok-media-v21 DB1/index·blobs·journal·settings·snapshots·staging·backups. Web Locks/IDB lease+revision. 기존 Memory DB 유지 |
| 기존 자료 연결 | use-media-library.ts / voice-mail.ts: migrateVoiceMailMedia | 이전 URL은 보관 보호 기록으로 연결하고 자동 다운로드하지 않음. 기존 메일은 파일 검증 후 연결. 원래 legacy 데이터·메일 recovery copy 유지 |
| 미디어 표시·질문 | managed-media.tsx, media-input.ts: questionMedia, ReaderApp paint/film | mediaId로 조회해 Object URL 재생성/해제. 로컬 이미지·영상 프레임을 질문에 사용. 없는 원본은 명시, 대체 파일로 위장 안 함 |
| Library/Storage | storage-settings.tsx | 설정→미디어·저장공간·백업: 검색/유형/보관/임시/휴지통/최신·큰순/10개 페이지/보관·다운로드·복원·삭제, 실제 bytes와 origin 추정치 구분 |
| 기억 편집·삭제 | memory-settings.tsx, memory-engine.ts, use-memory-v2.ts | 출처·revision·수동 편집·sourceDeleted, 원문 수정 시 재생성. 삭제한 기억의 원문 재추출 차단. 대화 삭제 기본은 원문만, 장기 기억 삭제는 별도 선택 |
| 요청·음성 | grok-context.ts, voice-formatter.ts, ReaderApp | 현재 질문 중복 제거, 오래된 원문부터 요청에서 제외(저장 원문 유지). 앱 추정 입력 상한26880=32000−1024−4096. 실제 모델 한도는 미확인. Full/Voice 분리, 문장 단위 음성, 부분 응답 표시 |
| Memory archive | storage-backup.ts: makeMemoryArchive/encodeMemoryArchive/parseMemoryArchive/mergeMemoryBackup | .vgb는 ZIP 아닌 JSON archive. 백업schema3 / Memoryschema2 / DB1 / 미디어metadata1 구분. payload 크기·SHA-256·schema·참조 검증. legacy Nangdok v1/v2 JSON 지원 |
| 암호화 | storage-backup.ts | 사용자 선택 AES-GCM256/PBKDF2-SHA256 310000회, 무작위 salt16/nonce12. 암호 미저장. 암호 오류·변조·누락 파일/잘못된 schema는 적용 전 중단. 해시는 출처 인증을 보장하지 않음 |
| 자동 snapshot | use-storage-snapshots.ts | 설정 창과 독립, 의미 있는 변경 후30초, 해당 기기 날짜의 하루 첫 변경 snapshot. 최근 일별7개와 최신/복원직전 보관. 내부 snapshot 선택·검증·복원 |
| Media 내보내기·복원 | media-export.ts: exportMedia/reconnectMedia/writeVerified | 파일 먼저, 파일별 상태와 정확한 revision 포함 manifest. 폴더 다시 읽기/해시 일치만 verified. 다운로드는 저장 미확인. 이름이 달라도 checksum·size가 같으면 재연결, 이름만 같으면 거절 |
| 외부 자동 쓰기 | use-storage-snapshots.ts, storage-settings.tsx | 사용자 검증한 폴더/쓰기 권한/평문 자동 백업 옵션이 있을 때만 앱 실행 중 수행. 실패 작업은 다음 실행/포그라운드에서 최신 snapshot으로 재시도. 암호화 선택 시 평문 자동 백업 비활성 |

## 사용·복구 절차

1. **설정 → 미디어·저장공간·백업 → 라이브러리**에서 보관(앱 자동 만료 제외), 기기에 저장(독립 파일 요청), 휴지통을 구분한다. 파일 가져오기는 현재 페르소나에 연결하고 기본 보관한다. 음악 파일 유형은 지원하나 음악 생성 기능은 미구현이다.
2. **저장공간**에서 유형별 bytes, origin 추정 usage/quota, persistence 승인 상태를 확인한다. 70/80/90%는 이 앱의 경고 정책이다. 보존기간 변경은 이후 파일에만 적용한다. 기존 임시에 적용할 때 개수/새 시각을 보고 선택한다.
3. **백업·복원**에서 Memory .vgb를 내보낸다. 암호화 선택 시8글자 이상 암호를 입력하고 보관한다. 별도로 Media 파일과 manifest를 내보낸다. 브라우저가 다중 다운로드를 차단하면 개별 파일/manifest를 다운로드 목록에서 확인하거나 검증된 폴더 쓰기를 이용한다.
4. 복원 파일은 staging에서 검증·개수·missing·충돌·만료·휴지통 미리보기를 확인한다. 기본 병합은 충돌 시 중단하고 교체는 명시 확인한다. 현재 Memory/media-index를 복원직전 snapshot에 남긴다. 적용 후 정리는 보류된다.
5. 원본은 **Media manifest + 실제 파일**을 선택해 SHA-256/size로 재연결한다. Memory만 복원한 missing 항목은 자동 삭제하지 않는다. 보존 상태를 검토하고 **복원 항목 모두 보관 후 재개**한다.
6. 오류 후 복구는 내부 snapshot의 **복원 직전**을 검증해 다시 적용한다. 원래 legacy localStorage/기존 메일 recovery copy를 강제 삭제하지 않았다. URL 원본이 이미 만료된 항목은 실제 파일이 있어야 복원할 수 있다.

## 데이터 보호·검증 근거

- 실제 사용자 파일·대화·NAS를 테스트용 삭제하지 않았다. 별도 loopback origin에 만든 68bytes PNG fixture로 검증했다. 동일 original 1개/68bytes가 쓰기 후/새로고침 후 checksum과 size 모두 일치했다. OPFS 거절 fixture는 IDB Blob으로 보관됐다. URL만 있는 기존 사용자 원본의 총량은 실제 사용자 DB를 일괄 읽어 실측하지 않았으며 보호 migration 전후 사용자 데이터 개수 보증을 하지 않는다.
- 21개 신규 Node 테스트: elapsed-time 경계,5유형 기본,Saved 보호/복원,복원 보류,공유 참조,용량/Trash 부분집합,경로/호스트,암호/변조/hash/schema/중복 메시지·미디어 ID/참조,동일 Persona 병합 잠금 유지,기억 삭제/재추출 방지,원문 수정,질문 중복/추정 상한.
- 기존 Memory/응답 관련14개 포함 **35/35 통과**. 전체 scripts tests **316개 중306 통과/기존10 실패**. 8개 Grok PWA 공유 카드 제목의 기존 기대값 불일치,2개 Windows symlink EPERM. 기존 실패를 이번 신규 기능 통과로 숨기지 않았다.
- 실제 브라우저 **17/17**: 로컬 쓰기/해시 읽기,Saved 복원,오래된revision 삭제 거절,OPFS→IDB fallback,양쪽quota 실패,중단 ingest 복구,뒤늦은 만료7일,삭제 확인/tombstone,Memory만 복원 missing·pause,충돌 index 불변,삭제 실패pending/재시도,파일명만 일치 거절/다른 이름의 checksum 일치 재연결,OPFS MIME journal 복구,중단 손상 bytes 거절. 새로고침 검증 별도 통과.
- 타입 검사 통과, 변경 파일 lint 오류0(기존 Reader hooks4 warnings+생성 routeTree ignore1), npm run build 통과. DB migration은 DATABASE_URL 미설정으로 기존 스크립트가 skip. 새 서버 DB/계정/요금 서비스 추가 없음.
- 개발/배포용 실제 화면을 데스크톱과390×844 iframe 크기에서 렌더/설정/Storage 메뉴/스크롤/스크린샷 확인. 배포 모바일 문서 폭 client390/scroll390, 캡처된 error 로그0. S26U 실기기 검증이 아니다. Linux 전용 browser-smoke script는 Windows 경로 guard로 실행 불가하여 실제 Codex 브라우저로 대체 검사했다.

## 남은 제한·미검증

- S26U OS/브라우저/PWA, DS218+ DSM/Drive 버전, 실제 폴더 선택·재권한·NAS 전송, 신규 paid xAI 이미지/영상/TTS 호출은 실기기/계정 검증하지 않았다. 실제 생성/메일 저장 경로에 어댑터는 연결했지만 이번 작업의 fixture 검사로 유료 서비스까지 검증됐다고 주장하지 않는다.
- 파일200MiB와 Memory25MiB는 앱의 입력 보호 상한이며 기기 보장값이 아니다. fetch는 제한된 chunk로 읽지만 파일 hash/readback는 Blob 전체를 ArrayBuffer로 읽는다. 대용량 S26U 성능, worker/분할 hash, Vercel 원본 proxy 대용량 전송은 추가 검증이 필요하다. 전체 라이브러리 bytes는 한 번에 읽지 않는다.
- Media 파일은 평문이다. Memory 암호화 자동 백업은 암호를 보관하지 않으므로 수동 내보내기만 지원한다. 설정/API/OAuth/잠금 암호 등 credential field는 새 archive에서 제외한다. 사용자 대화·기억 본문 자체는 archive 대상이다.
- 보이스메일 음성은 Library/Media 원본으로 백업·재생 가능하다. 기존 기기의 메일함/읽음/예약 답장 metadata는 유지하지만 다른 기기의 메일함으로 자동 복원하는 기능은 미구현이다. 복구용 기존메일 copy/staging/snapshot은 미디어 원본 총량과 별개로 origin estimate에 들어간다.
- Memory와 Media는 별도 DB이므로 하나의 원자적 DB transaction으로 전체 적용하지 않는다. 검증/staging/복원직전 snapshot/보호 상태로 복구 경로를 제공한다. 중간 저장 오류 시 자동 정리를 중단한 메타데이터가 남을 수 있으며 복원직전 snapshot으로 다시 적용한다.
- NAS worker·앱 종료 후 정시 자동화·native SAF/MediaStore·오프사이트 신규 provider 연결·음악 생성 API는 미구현. NAS/오프사이트 상태는 미설정/외부 상태 확인 불가이다. 기존 Dropbox 기능은 유지한다.
- 대화·미디어 삭제는 앱의 현재 데이터 범위다. 내보낸 독립 파일/NAS/오프사이트/과거 snapshot/recovery copy는 별도이며 완전 제거로 표시하지 않는다. 새 백업 검증 후 내부 일별 snapshot만 최근7개로 정리한다. 외부 보존 세대는 안내·수동 계획이다.

Git commit/branch/push는 최종 응답에 실제 결과를 기록한다. GitHub push와 공개 Grok 게시 완료는 별개다.
