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

현재 연결된 브라우저 도구는 Codex 미리보기이며 실제 PC Chrome 연결이나 S26U 제어 연결이 없다. 이 세션의 filesystem drive 목록에는 NAS mapped drive가 표시되지 않았다. 이는 NAS가 오프라인이거나 연결 불가능하다는 증거는 아니다. NAS 주소·실제 폴더·기기 권한을 확인하기 전 전송 성공으로 판정하지 않는다.

게시 후 아래를 작은 전용 테스트 자료로 확인해야 한다. 개인 대화·원본 파일 삭제 없이 별도 테스트 페르소나/파일/폴더를 사용한다.

| 구간 | 실행·성공 기준 |
|---|---|
| S26U 로컬 저장 | Chrome/PWA 실제 버전을 기록. 테스트 이미지·음성 파일 가져오기, 앱 재실행 후 같은 원본 재생. bytes/가용성 확인 |
| S26U 기기 내보내기 | 작은 Memory .vgb와 Media 원본·manifest를 내보내고 실제 다운로드 목록의 파일을 확인. 다운로드 요청만으로 완료 판정하지 않음 |
| 암호화/복원 | 설정한 암호로 .vgb 검증, 잘못된 암호는 적용 중단. 테스트 페르소나·내용·mediaId 개수 비교. manifest+원본을 재연결해 파일 검증·재생 |
| Synology 전송 | Drive의 독립 기기 폴더→별도 NAS 테스트 폴더 업로드. DSM/File Station 또는 Drive 서버에서 실제 파일·size 확인 |
| NAS 왕복 | NAS에서 다시 내려받은 .vgb 검증과 Media checksum/size 재연결이 성공하고 원본 재생 가능. 이 단계까지 성공해야 해당 파일의 NAS 전송 검증 완료 |
| PC 폴더 자동 쓰기 | 실제 Chrome에서 테스트 폴더 선택, 쓰기/다시 읽기 검증, 변경 후30초 파일 생성. 브라우저 재실행 후 권한 재연결과 실패/재시도 확인 |
| 외부 삭제 전파 | Drive 설정에서 앱 로컬 삭제가 유일한 NAS 사본을 지우지 않는 방향인지 확인. 실제 사용자 원본으로 삭제 실험하지 않음 |

S26U와 NAS를 실제로 확인할 수 있을 때 위 결과를 별도로 기록한다. 브라우저 내부 원본·기기 다운로드·NAS 사본은 다른 저장 단계다. 현재는 NAS 검증 완료로 표시할 근거가 없다.
