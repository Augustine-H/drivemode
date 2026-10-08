# 계정 없는 HTTPS 통합 점검

Synology/Grok Custom의 URL 이후 OAuth 인증을 확인하는 별도 합성 서버는 [SYNOLOGY_OAUTH_CANARY.md](SYNOLOGY_OAUTH_CANARY.md)를 따른다. 기존 loopback HTTPS 도구와 실계정 private 설정을 그대로 공개하지 않는다. 새 canary는 실제 계정을 mount하지 않고 별도 승인 암호·SDK OAuth로 합성 데이터만 제공한다.

이 도구는 클라우드 체크아웃에서 실행하며 네이버·NAS·xAI 인증정보가 필요하지 않다. 운영 entrypoint와 Docker 이미지에는 포함하지 않는다. 메일 객체는 고정 합성 데이터이며 IMAP 연결을 만들지 않는다. 기존 Voice Grok 코드와 설정은 변경하지 않는다.

## 자동 점검

서비스 디렉터리에서 기존 Python 3.12 테스트 환경으로 실행한다.

```sh
python -m integration.self_check
python -m integration.voice_check
python -m pytest -q
```

`self_check`는 임시 private 디렉터리에 2일 유효한 로컬 인증서와 무작위 토큰을 생성한다. 인증서를 명시적으로 신뢰하는 공식 MCP SDK로 loopback HTTPS 서버를 검사한 뒤, 서버 프로세스와 파일을 정리한다. 토큰·본문·예외 원문을 출력하지 않으며 JSON 판정만 반환한다. 실패 시 종료 코드는 0이 아니다.

검증 범위:

- 무인증·잘못된 토큰의 `/mcp` 및 `/health` 접근 401
- 공식 SDK initialize, 협상 버전, 정확한 7개 읽기 전용 도구 목록
- 합성 한글 목록·본문과 untrusted 표시
- 자체 인증서를 신뢰하지 않는 클라이언트의 TLS 연결 거부
- 잘못된 Host/Origin 거부, 미검증 웹 역할 토큰 거부
- scope 없는 호출 및 승인 UID를 확대한 호출 차단
- 새·기존 토큰 동시 사용, 기존 토큰 즉시 폐기
- 새 서버 프로세스에서 새 토큰 정상 사용, 폐기된 토큰 계속 거부

이 테스트는 IMAP·Docker·NAS 재시작 시험을 대체하지 않는다. 기존 IMAP/Docker 자동 테스트는 별도이며, 합성 객체의 조회가 실제 네이버 검색 동작을 입증하지 않는다.

### Voice Grok 백엔드와 HTTPS 서버 연결

`voice_check`는 Node 24와 Python 테스트 환경을 사용해 기존 `naverMailEndpoint`를 그대로 실행하고, 백엔드가 만든 remote MCP 요청의 Authorization·scope·인자를 공식 Python SDK로 전달한다. SDK는 임시 합성 서버에 실제 HTTPS로 연결한다. 메일 도구 결과를 기존 백엔드가 해석하고 사용자 응답과 TTS용 텍스트를 만드는 것까지 검사한다.

xAI 계획·요약·`mcp_call` envelope는 명시적인 모의 응답이다. 실제 xAI 요청은 하지 않으며 Node의 기본 fetch는 차단한다. 백엔드가 사용하는 상수 API 키도 합성 값이다. 따라서 이 테스트는 모델의 실제 tool 선택·요약 품질·출력 형식 호환성을 입증하지 않는다. Node HTTP route listener, 실제 Tailscale proxy, 브라우저, Android 마이크·TTS 재생도 실행하지 않는다.

검증 흐름은 앱 identity/Origin 거부 → 한글 목록 → 반환된 메시지 선택 → 원문/TTS 텍스트 → tool 없는 합성 요약 → 나머지 도구 조회 → scope 확대 거부 → UIDVALIDITY 변경 안내 → 쓰기 요청의 upstream 호출 차단 → 폐기 토큰의 한국어 오류다. 응답의 no-store, 토큰/API 키 미포함, 기존 기억/history 미전달도 검사한다. 총 11회 SDK 연결 시도 중 마지막은 폐기 토큰의 인증 실패를 기대하는 경우다. 보고서는 본문·토큰을 출력하지 않으며 서버와 private 파일을 정리한다.

## 지속 실행용 합성 서버

아래는 운영자용 절차다. 개발 에이전트는 자동 점검까지 실행했으며 지속 실행 서버나 공개 Tunnel은 만들지 않았다.

```sh
python -m integration.https_canary prepare --directory /tmp/naver-canary-private --port 3443
python -m integration.https_canary serve --directory /tmp/naver-canary-private --port 3443
```

별도 프로세스에서:

```sh
python -m integration.probe \
  --url https://127.0.0.1:3443/mcp \
  --token-file /tmp/naver-canary-private/voice.token \
  --ca-file /tmp/naver-canary-private/ca.pem --canary
```

생성된 디렉터리는 0700, 개인 키·토큰·registry·config는 0600이다. 이미 존재하는 디렉터리를 덮어쓰지 않는다. `serve`는 항상 `127.0.0.1`에만 바인딩하며 proxy 헤더를 신뢰하지 않는다. 2일 뒤 인증서를 재발급해야 한다. 종료 후 생성한 private 디렉터리를 정리한다. 토큰을 채팅이나 Git에 복사하지 않는다. `web_auth_verified:false`를 그대로 유지한다.

`--canary`는 loopback 주소만 허용한다. 이는 공개 실제 메일 서버에 실수로 합성 조회를 실행하는 것을 막는다. 다른 로컬 서비스에 사용하지 않는다.

## 향후 HTTPS endpoint 사전 점검

인증된 HTTPS가 별도 통합 단계에서 준비되면 다음 명령으로 **메일을 읽지 않고** 인증과 도구 목록만 점검할 수 있다.

```sh
python -m integration.probe \
  --url https://naver-mail.example.com/mcp \
  --token-file /secure/private/voice.token
```

정확한 `/mcp` HTTPS URL만 허용하며 URL의 계정·비밀번호·query·fragment를 거부한다. 기본 OS 신뢰 저장소로 인증서를 검증한다. 사설 CA라면 `--ca-file`에 신뢰할 CA 파일을 지정하며 TLS 검증을 끄는 옵션은 제공하지 않는다. HTTP redirect와 환경 proxy는 사용하지 않는다. Token은 파일에서만 읽는다. 기본 모드는 `/health`의 공개 노출을 요구하지 않고 `/mcp`에만 접근한다. 결과는 도구 수·협상 버전·성공 여부만 포함한다.

## 다음 실제 통합 단계의 판정

| 단계 | 필요한 설정 | 이번 작업 상태 |
| --- | --- | --- |
| 로컬 합성 HTTPS 및 토큰 회전·재시작 | 자동 생성 fixture | 통과 |
| 기존 Voice Grok 백엔드와 합성 HTTPS MCP 연결 | 자동 생성 fixture·모의 xAI·Node 24 | 통과 |
| 공개 HTTPS ingress의 TLS·Host·Origin·무인증 차단 | 별도 proxy/Tunnel·DNS·전용 토큰 | 미실행 |
| Grok 웹 Custom 인증·도구 인식·합성 조회 | 공식 웹의 실제 인증 UI 검증 | 미실행 |
| xAI Responses remote MCP의 scope 헤더·결과 형식·요약 | 서버 전용 API 키·합성 HTTPS endpoint | 미실행 |
| 실제 네이버 조회 전후 flags·UIDVALIDITY·한글 검색 | 서버 private 계정 설정 | 미실행 |
| Android 음성 및 NAS 운영·복구 | 실제 기기·NAS | 미실행 |

Grok 웹 인증 방식을 먼저 확인하고, 합성 전용 서비스에서 성공과 무인증 거부를 입증해야 한다. 이 loopback 서버를 그대로 공개하는 배포 명령은 제공하지 않는다. 공개 canary를 구성할 경우 합성 서버와 실계정 private mount를 분리하고 승인된 Host/Origin·신뢰 proxy 경계부터 설정한다. 웹 인증을 제거하거나 운영 서비스의 `web_auth_verified`를 검증 전에 켜지 않는다.

xAI 실제 검증은 기존 `src/lib/naver-mail.server.ts`가 만드는 요청의 `allowed_tools` 한 개, `max_tool_calls:1`, Authorization과 `X-Naver-Mail-Scope`, 실제 `mcp_call` 출력 형식을 확인해야 한다. API 키는 백엔드에만 설정한다. 합성 데이터 결과와 사용자에게 보여 줄 오류·요약을 확인하기 전 실계정 메일로 시험하지 않는다. 이 도구의 SDK 성공은 Grok/xAI 성공 판정이 아니다. 모든 보고서에서 `grok_web_verified`와 `xai_verified`는 false로 유지한다.
