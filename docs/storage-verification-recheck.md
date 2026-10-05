# 저장 기능 재검증 · 2026-10-05 (한국시간)

## 이전 실패 10개 재현·수정

`grok-pwa-plugin.test.mjs`, `check-auth-invariant.test.mjs`, `with-app-env.test.mjs`를 먼저 재실행해 이전과 같은 10개 실패를 재현했다.

- 공유 카드 8개: `injectGrokPwaHead`/`createHeadInjector`의 기본 `cwd=process.cwd()`가 테스트 fixture 대신 실제 프로젝트의 `src/lib/og/site.json`을 읽었다. 실제 앱 이름이 테스트용 제목을 덮어쓴 것이다. generic fixture에 빈 임시 cwd를 명시해 실제 앱 설정과 격리했다. filesystem 테스트의 명시적인 cwd는 그대로 사용한다. 기대값을 현재 앱 이름으로 교체하거나 production branding을 제거하지 않았다. 실제 workspace identity 우선순위를 별도 회귀 검사했다.
- 경로 2개: Windows에서 기본 `symlinkSync`는 symlink 생성 권한 때문에 EPERM으로 실패했다. Windows 디렉터리 junction, 다른 OS의 directory symlink를 사용한다. `realpath`/`process.argv[1]` 경로 검사는 계속 실제로 실행하며 skip하지 않는다.

관련 테스트는 신규 workspace 회귀 검사 포함 **71/71 통과**했다. 수정은 테스트 3개 파일에 한정한다.

## 전송 경로 추가 검사

`media-export-write.test.mjs`에서 실제 `writeVerified`를 호출한다. 테스트 handle의 하위 구현은 Node filesystem이며 기존 사용자 파일 대신 OS 임시 폴더에 작은 fixture만 쓴다.

1. 실제 디스크 쓰기→다시 읽기→size/SHA-256 일치. 동일 파일 재시도 시 재쓰기 생략, 다른 bytes면 갱신.
2. 주입한 권한 거절/쓰기 실패는 verified로 반환하지 않으며 abort를 호출하고 이전 fixture를 유지.
3. 길이가 같더라도 다시 읽은 checksum이 다르면 실패.
4. 경로 탈출은 어떤 폴더 접근보다 먼저 거절.

추가 **4/4 통과**. 실제 Windows 디스크 I/O를 검증한 항목과 주입한 실패 상황을 구분한다. 이 테스트 handle은 Chrome File System Access 권한이나 Android 다운로드 관리자가 아니며 **S26U·Synology 전송 검증을 대신하지 않는다**.

## 전체 테스트

현재 package test에 해당하는 두 묶음을 실행한다. Windows에서도 같은 파일 집합을 검사하도록 첫 묶음은 명시적으로 scripts의 모든 `.test.mjs`를 나열한다.

```powershell
$tests = (Get-ChildItem scripts -Recurse -Filter *.test.mjs).FullName
node --experimental-strip-types --test --test-reporter=tap $tests
node --experimental-strip-types --test --test-reporter=tap src/lib/app-data/app-data.test.ts src/lib/app-data/readiness-schedule.test.ts src/lib/auth/gate-identity.test.ts src/lib/auth/sign-in-gate.test.ts
```

scripts **321/321**, package에 지정된 TypeScript 테스트 **55/55**, 합계 **376/376 통과**. 이 집계는 package test의 대상이며, 별도 음악 서비스/Python/CUDA 실시간 생성 테스트까지 포함한다는 뜻이 아니다. 테스트 파일 lint 오류0. 제품 소스는 수정하지 않아 이번 재검증을 위한 재빌드는 하지 않았다.

작업 시작 시 음악 기능 관련 미커밋 소스·서비스·스크린샷이 이미 존재했다. 이 작업은 그 내용을 수정·stage·commit하지 않는다.

## 실기기/NAS 검증은 여전히 필요

현재 연결된 브라우저 도구는 Codex 미리보기이며 실제 PC Chrome 연결이나 S26U 제어 연결이 없다. 최초 drive 목록만으로 NAS 접근을 확인하지 못했으나, 이후 사용자가 제공한 UNC 테스트 폴더와 연결 드라이브 경로를 직접 확인했다. 아래 PC/NAS 파일 검증은 성공했으며 Chrome 앱 자동 백업 및 S26U 전송과 구분한다.

### PC/NAS 실제 파일 검증 · 2026-10-05 14:40 KST

사용자가 지정한 전송테스트 폴더에서 두 경로 모두 실제 접근에 성공했다. 개인 NAS 주소는 공개 저장소에 기록하지 않는다.

- UNC 경로에 고유 이름의 작은 합성 JSON을 새로 저장하고, 연결 드라이브 경로에서 다시 읽었다. 내용과 SHA-256 일치.
- 연결 드라이브에서 해당 테스트 파일을 revision 2로 갱신하고, UNC에서 다시 읽었다. 갱신된 한글 내용과 양쪽 SHA-256 일치. 이전 hash와도 달라 실제 갱신을 확인했다.
- 최종 파일 크기 229 bytes. SHA-256: `1B0623E55E23817A8004C80E8A97F4881A47E7B1BF8910401DE1F666B2D5DE78`.
- 증거 파일 `voicegrok-transfer-check-20261005-144044-94aa31db.json`은 해당 전송테스트 폴더에 남겼다. 기존 사용자 파일을 변경하거나 삭제하지 않았다.

이 검사는 PowerShell/.NET filesystem으로 PC에서 NAS 공유에 실제 쓰기·갱신·교차 경로 읽기를 확인했다. 앱의 `writeVerified`, Chrome 폴더 선택·권한, Memory .vgb/Media manifest 복원, S26U 또는 Synology Drive 모바일 업로드를 실행한 결과는 아니다.

게시 후 아래를 작은 전용 테스트 자료로 확인해야 한다. 개인 대화·원본 파일 삭제 없이 별도 테스트 페르소나/파일/폴더를 사용한다.

| 구간               | 실행·성공 기준                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| S26U 로컬 저장     | Chrome/PWA 실제 버전을 기록. 테스트 이미지·음성 파일 가져오기, 앱 재실행 후 같은 원본 재생. bytes/가용성 확인                               |
| S26U 기기 내보내기 | 작은 Memory .vgb와 Media 원본·manifest를 내보내고 실제 다운로드 목록의 파일을 확인. 다운로드 요청만으로 완료 판정하지 않음                  |
| 암호화/복원        | 설정한 암호로 .vgb 검증, 잘못된 암호는 적용 중단. 테스트 페르소나·내용·mediaId 개수 비교. manifest+원본을 재연결해 파일 검증·재생           |
| Synology 전송      | Drive의 독립 기기 폴더→별도 NAS 테스트 폴더 업로드. DSM/File Station 또는 Drive 서버에서 실제 파일·size 확인                                |
| NAS 왕복           | NAS에서 다시 내려받은 .vgb 검증과 Media checksum/size 재연결이 성공하고 원본 재생 가능. 이 단계까지 성공해야 해당 파일의 NAS 전송 검증 완료 |
| PC 폴더 자동 쓰기  | 실제 Chrome에서 테스트 폴더 선택, 쓰기/다시 읽기 검증, 변경 후30초 파일 생성. 브라우저 재실행 후 권한 재연결과 실패/재시도 확인             |
| 외부 삭제 전파     | Drive 설정에서 앱 로컬 삭제가 유일한 NAS 사본을 지우지 않는 방향인지 확인. 실제 사용자 원본으로 삭제 실험하지 않음                          |

S26U 및 Chrome 앱 경로를 실제로 확인할 수 있을 때 위 결과를 별도로 기록한다. 브라우저 내부 원본·기기 다운로드·NAS 사본은 다른 저장 단계다. PC/NAS 공유 파일 I/O는 검증했으며, 앱 자동 백업·실기기 전송 전체 완료로 표시하지 않는다.

## 자동 백업 수정 및 실제 Chrome → NAS 검증 · 2026-10-05 15:43 KST

위 초기 미검증 항목 중 Chrome의 최초 폴더 선택·권한 및 자동 쓰기는 아래와 같이 확인했다.

### 수정

- 설정에서 자동 백업을 켜거나 폴더를 변경하면, 설정 창과 독립적인 worker에 변경 이벤트를 보내 30초 뒤 작업을 예약한다. 대화가 추가로 바뀌지 않아도 설정 변경이 반영된다.
- 저장 성공을 archive ID뿐 아니라 실제 directory handle의 `isSameEntry`로 확인한다. 다른 폴더를 선택하면 같은 대화도 새 위치에 내보낸다. 수동 내보내기 기록과 자동 내보내기 기록을 분리한다.
- worker의 queue를 렌더마다 재생성하지 않고 유지한다. 저장 중 다음 변경이 생겨도 동시에 쓰지 않으며, 처리 시간이 길어도 새 변경을 잃지 않는다.
- 앱에 다시 돌아왔다고 30초 debounce를 생략하지 않는다. 숨겨진 동안 대기 시간이 지났다면 돌아왔을 때 처리한다. 변경 없는 내용은 snapshot 서명과 폴더 성공 기록으로 중복 저장하지 않는다.

### 실제 Chrome/NAS 결과

별도 loopback origin의 격리 테스트 화면에서 앱이 사용하는 실제 `selectExportFolder`, `useStorageSnapshots`, IndexedDB, `writeVerified`를 호출했다. 개인 대화 대신 페르소나 `browser-qa`와 합성 문장 하나만 사용했다. 사용자가 직접 Chrome 폴더 선택 및 접근 승인을 완료했으며, 에이전트는 NAS에서 생성된 파일을 독립적으로 읽어 검증했다. Windows 브라우저 조작 도구의 URL 판별 제한으로 UI 자동 조작·화면 캡처는 수행하지 못했다.

- 실제 NAS 테스트 폴더에 `write-test-69ea0a9f-2a3d-4455-b0fd-98c12f82de39.json`이 생성됐다. 내용 `{"writeCheck":true}`, 크기 19 bytes. 저장 시각 15:43:14.492 KST.
- 이후 MemoryBackups의 해당 device 하위에 `.vgb` 파일이 실제 생성됐다. 저장 시각 15:43:44.900 KST, 쓰기 확인 파일과 약 **30.408초** 차이.
- 파일 크기 **1,893 bytes**, SHA-256 `5a86badfa5c79d78d092652a91c9949aca618d8438c50543fafaa76a429830e8`.
- 실제 파일을 `parseMemoryArchive`로 다시 읽어 8개 payload의 크기/해시 검증에 성공했다. 페르소나 ID `browser-qa`, 대화 1개, 내용 `한글 기억 테스트`가 일치했다.
- NAS UNC 경로와 연결 드라이브 경로에서 읽은 실제 bytes의 SHA-256이 일치했다.
- 15:45:15 KST에 다시 검사했다. 생성 후 **91초** 동안 해당 device의 백업 파일은 1개였으며 최종 수정 시각과 SHA-256이 그대로였다. 기존 사용자 파일은 수정하거나 삭제하지 않았다. 증거 파일은 전송테스트 폴더에 남겼다.

별도로 `verify-nas-snapshot.mjs`를 명시적으로 실행해 실제 NAS 파일 I/O로 30초 scheduler, 변경 없는 재확인, 파일 파싱, 실패 후 재시도를 확인했다. 이 script의 DB는 격리된 메모리 fixture이며 권한 거절은 주입한 상황이다. 실제 Chrome 검증과 구분한다. 이 script는 일반 테스트 실행에 포함하지 않으며 지정한 테스트 폴더에만 합성 자료를 생성한다.

### 회귀·빌드 검증

`storage-snapshot.test.mjs`에 실디스크 복원/중복 방지, 새 폴더, 권한·쓰기 실패와 재시도, 자동 백업 OFF/암호화의 plaintext 차단, 30초 대기·복귀, 느린 쓰기 직렬화, 숨김·unmount의 **7개 회귀 검사**를 추가했다.

scripts **328/328**, package 지정 TypeScript **55/55**, 합계 **383/383 통과**. 타입 검사와 production build도 성공했다. 기존 음악 작업의 미커밋 변경은 포함하지 않고, Git HEAD에 이번 7개 소스/테스트 파일만 적용한 별도 임시 사본에서도 같은 테스트·타입 검사·빌드를 확인했다.

현재 작업 폴더의 dev 및 production 앱은 데스크톱·390×844 모바일에서 직접 화면을 확인했다. 내용이 표시되고 브라우저 오류 로그가 없었으며 모바일 document 폭은 390px이었다. 기존 Linux 전용 smoke/preview-restart 대신 Windows에서 npm preview와 연결된 브라우저를 사용했다. 음악 기능의 미커밋 소스는 별도 작업으로 유지했다.

### 남은 범위

Chrome **최초 선택·권한 승인 → 30초 자동 저장 → NAS 도착 → Memory 파일 검증/파싱**은 확인했다. 메인 설정 화면의 클릭 흐름, Chrome 완전 종료·재실행 후 권한 유지/재승인, 실제 NAS 연결 해제·재접속, S26U 전송, 모바일 미디어 원본·manifest 왕복은 아직 실기기 검증하지 않았다. 실제 권한 철회나 NAS 장애를 주입한 테스트와 혼동하지 않는다. 암호화/미디어 복원은 회귀 검사 결과이며 이번 실제 Chrome/NAS fixture에는 포함하지 않았다.

## S26U 파일 왕복 전송 · 2026-10-05 19:43 KST

전용 폴더 `s26u-check-20261005-065917-3cc210d7`에 개인 정보 없는 합성 자료를 준비했다. 사용자는 S26U의 Synology Drive에서 이 폴더를 열 수 있음을 확인했고, 네 파일을 휴대폰에 다운로드한 뒤 `S26U-return`에 다시 업로드했다고 보고했다. 에이전트는 해당 반환 폴더에 실제 도착한 네 파일을 독립적으로 다시 읽었다. 휴대폰 화면·다운로드·업로드 UI는 직접 제어하지 않았으며, 실제 휴대폰 경유는 사용자의 수행 보고에 따른 것이다.

| 파일                     | bytes | 반환 파일 SHA-256                                                  | 원본과 일치 |
| ------------------------ | ----: | ------------------------------------------------------------------ | ----------- |
| S26U_Memory.vgb          |  3967 | `d4f51c38aaf37239e7dbb648bc6938acecb579032fd1a3340c2c821c5a3a958e` | 성공        |
| S26U_Media_manifest.json |  2783 | `c3907bc43a9c98ae529a29f6e3e1c71d8b9b822402c1c50e08c6a1db15b1ce5f` | 성공        |
| s26u-image-3cc210d7.png  |    90 | `30b15264b5921b7536fea248fa77b982bdea2274becf1c31f3c5b11bab5424ab` | 성공        |
| s26u-voice-3cc210d7.wav  | 32044 | `213b6725b261cd9f405ffc7ec599f0517b73f8583c4764288e012539ddcc4cd9` | 성공        |

NAS에 반환된 실제 `.vgb`를 `parseMemoryArchive`로 검증했다. 페르소나 `s26u-qa-3cc210d7` 1개, 대화 3개, 미디어 2개 및 문장 `S26U 기억 백업 전송 검증 3cc210d7`이 일치했다. 반환된 manifest를 `parseMediaManifest`로 검증했고, 이미지·음성 원본의 크기와 checksum이 두 manifest 항목에 각각 일치했다. 합계 38,884 bytes의 네 파일이 손상 없이 반환됐다. 증거 파일을 보존하고 기존 사용자 원본을 삭제하거나 교체하지 않았다.

**통과 범위:** 사용자 보고에 따른 NAS → S26U 다운로드 → NAS 재업로드 및 반환 파일의 독립적인 bytes/hash/백업 파싱 검증. **아직 미검증:** S26U 앱 내 Memory 병합 복원, 실제 미디어 재연결·이미지 표시·음성 재생, 앱이 생성한 신규 백업의 모바일 내보내기, Android 재실행 후 로컬 원본 유지. 휴대폰 Chrome/PWA/네이티브 종류와 앱 버전도 확인 중이다.

### Chrome 재실행 검증 상태

기존 Chrome 프로세스가 종료되고 새 Chrome 프로세스와 재실행 테스트 페이지가 열린 것은 확인했다. 한편 앱 내 미리보기에서도 같은 주소가 열렸으나, 그 origin의 OPFS 테스트 handle을 대상으로 한 PASS는 실제 Chrome/NAS 결과가 아니다. 테스트 화면에 앞서 NAS를 선택한 Chrome의 device ID 확인을 추가해 다른 저장소의 성공을 재실행 검증으로 표시하지 않도록 했다. 이 화면은 임시 QA용이며 제품 소스에 포함하지 않는다.

19:43 KST 기준 실제 Chrome의 기존 NAS device 폴더에는 최초 백업 하나만 있었고 재실행 합성 대화의 신규 백업은 없었다. 사용자의 실제 Chrome 화면에 표시된 최초 권한/오류 상태를 기다리는 중이다. 권한 유지 성공이나 재승인 실패로 추정하지 않는다.

## Chrome 재실행 권한 유지 결과 · 2026-10-05 19:44 KST 이후 확인

사용자가 실제 Chrome 화면의 `PASS · 최초 권한=granted · 저장된 폴더 자동 백업/복원 검증 1959 bytes`를 보고했다. 에이전트가 앞서 NAS를 선택한 동일한 device 폴더를 다시 읽어, 실제 재실행 테스트 `.vgb`가 새로 저장된 것을 독립적으로 확인했다. Chrome 프로세스는 기존 14:50 프로세스가 종료된 뒤 19:39:10 KST에 새로 시작한 프로세스였다.

- 저장소에 보존된 이전 directory handle을 사용했다. 재실행 테스트 코드에는 새 directory picker 호출이 없으며, 최초 `queryPermission({mode:"readwrite"})` 값 `granted`가 합성 대화 본문에 포함됐다.
- 실제 NAS의 `VoiceGrok_Memory_20261005_104441_13f26a60-876b-4105-b624-98a3d5a633e0_631d2e73-cfde-429d-a4e9-508002f504fa.vgb`는 1,959 bytes. SHA-256 `c0fd9767e6c5a650216b83cccdb474e00f693ecc125086812e0f7b6731650f65`.
- 실제 파일을 `parseMemoryArchive`로 읽어 payload 크기/해시 검증에 성공했다. 합성 본문은 `Chrome 재실행 기억 테스트 | 최초 권한=granted | 열림=1791197051184`였다.
- 같은 시각의 다른 백업도 1,959 bytes이며 열린 시각 값은 `1791197051188`로 달랐다. 테스트 화면의 별도 실행/마운트에서 서로 다른 합성 데이터를 저장한 기록이므로 이번 권한 유지 결과를 단일 파일 생성/변경 없음 중복 방지 시험으로 해석하지 않는다. 변경 없는 쓰기 방지는 앞서 91초 관찰과 scheduler 회귀 검사로 구분해 검증했다.

**통과:** 이 Chrome 프로필과 NAS 폴더에서 브라우저 재실행 후 IDB에 저장된 directory handle 및 쓰기 권한이 유지되고, 새 폴더 선택·권한 재승인 없이 앱의 worker로 자동 저장 및 백업 파싱에 성공했다. 다른 기기/프로필/브라우저의 권한 유지나 실제 권한 철회 후 재승인까지 보장하는 결과는 아니다.

사용자가 S26U 보이스 그록 버전은 **1.15.0**이며 GitHub 수정본을 아직 Grok에서 재게시하지 않았다고 확인했다. 저장 v2.1 기능이 있는 GitHub 수정본의 표시 버전은 **1.23.0**이다. S26U 파일 왕복은 통과했으나 최신 앱 내 병합 복원·미디어 재연결·사진 표시·음성 재생은 1.23.0 재게시/업데이트 후 검증해야 한다. 이번 작업에서 게시 서비스를 변경하거나 배포 완료로 표시하지 않았다.

## S26U 1.24.0 앱 내 복원·재실행 결과 · 2026-10-05

이 절은 위의 모바일 미검증 상태를 갱신한다. `d465bbe`로 1.24.0을 GitHub main에 반영한 후 사용자가 S26U 앱에 **1.24.0**이 표시됨을 확인했다.

전용 합성 파일 `S26U_Memory.vgb`의 기본 병합 복원, `S26U_Media_manifest.json`과 PNG/WAV 원본 재연결, 라이브러리 표시·재생 및 앱 재실행 후 유지 순서로 검증을 안내했다. 사용자는 **복원 성공**, **재실행 후 유지 확인**을 보고했다. 이어 사진 표시와 WAV의 1초 테스트음 재생이 재실행 후에도 정상인지 명시적으로 확인했고, 사용자는 **정상 확인**으로 답했다.

**사용자 실기기 확인으로 통과:** S26U 1.24.0에서 기억 복원, 테스트 사진 표시, 테스트 음성 재생, 앱 재실행 후 복원 상태 및 미디어 사용 가능 상태 유지. 에이전트가 휴대폰 UI를 직접 제어하거나 재연결 성공/실패 개수를 독립적으로 관찰한 결과는 아니다. NAS 왕복 bytes/hash의 독립적인 검증은 앞 절의 증거와 구분한다.

**남은 검증:** S26U 앱이 생성한 신규 Memory/Media 백업을 기기로 내보내고 NAS에 전달한 뒤 다시 복원하는 흐름, 실제 Chrome 권한 철회·재승인, 실제 NAS 연결 해제·재접속. 이번 결과는 앱 종료 중 자동 백업 실행이나 모든 Android 환경의 동작을 검증하지 않는다.
