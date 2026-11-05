# SAFETYED / SafeCall v1.47.2 — Cursor 재현 검증 가이드

## 검증 대상과 범위

하나의 제품 `/live`에서 두 실행 경로를 검증합니다.

- **안정 재현**: `Stable 20-turn replay` — 검찰·은행 사칭 `training-bank-20-en`과 등기배송 `training-delivery-20-en`의 20개 작성 발화를 TTS WAV의 재생 시각에 맞춰 공개. **STT나 Meta AI를 호출하지 않음**. 규칙 엔진·가상 GPS·안경 브라우저 HUD·가상 은행 서버 정책 확인.
- **실제 Meta**: `Meta live ASR` — 자체 생성한 합성 TTS WAV 음성을 FFmpeg로 PCM 변환해 Meta 실시간 ASR에 송신. ASR_FINAL 이벤트와 Muse Spark 실응답에 증거가 있을 때만 실제 모델 결과로 인정. 규칙 엔진은 송금 정책 최종 결정을 수행.

이 프로젝트의 20턴은 **오프라인 대본 기준 정확히 20턴**입니다. ASR 모드에서는 모델이 음성을 다른 단위로 쪼개 전사하므로 확정 전사 이벤트 20개 상한이 적용될 뿐, 정확히 20턴 재현이 보장되지는 않습니다.

## 1. 먼저 오프라인 자동 검증 (API 비용 없음)

프로젝트 루트에서 Node.js 22 이상으로:

```sh
npm run verify:cursor
npm run test:v1471
npm run test:v147
npm run test:v144
npm run check:static
npm run check:preflight
```

`npm run verify:cursor`는 **독립적인 실제 HTTP 서버 두 개**를 실행하며, 대본 시각을 가속해 각 20턴 진행, HIGH 최초 진입, `AT_BANK`, 안경 `HIGH`, SafeBank 거부 HTTP 409를 검사합니다. 실제 브라우저 오디오 재생이나 Meta AI 판정은 테스트하지 않습니다.

기대 출력:

```text
PASS training-bank-20-en — 20/20 turns; first HIGH turn=9; GPS=AT_BANK; HUD=HIGH; transfer=409
PASS training-delivery-20-en — 20/20 turns; first HIGH turn=13; GPS=AT_BANK; HUD=HIGH; transfer=409
PREFLIGHT Meta LIVE: not configured; real provider not contacted.
```

결과: `artifacts/cursor-verification/results.json`. `status: PASS`여도 이는 오프라인 시연 흐름만 통과한 것입니다.

## 2. 일반 브라우저 시연 (음성 들으며 확인)

```sh
npm run demo:safety
```

`http://127.0.0.1:4173/` 랜딩에서 `Enter Live Experience` → `/live`.

1. `Stable 20-turn replay` 선택.
2. `training-bank-20-en` 선택(촬영 권장), 전화 받기(녹색 전화 버튼).
3. 약 105초 동안 TTS 음성 재생, 왼쪽 로그가 실제 `SCRIPT_TURN_FINAL` / `RULES_UPDATED`로 갱신되고 오른쪽 규칙 위험도가 HIGH로 변하는지 확인.
4. GPS가 은행으로 이동하고 안경 HUD 경고가 HIGH가 되는지 확인.
5. `Try virtual transfer`에서 가상 송금 제한 팝업을 확인.
6. `Restart`를 눌러 새 사건이 0/20부터 시작하는지 확인.

웹 브라우저에서 실재생을 직접 보고 영상 캡처할 때는 `OBS Studio`를 사용할 수 있습니다. 시연에는 **SCRIPTED REPLAY / RULE ENGINE**을 명시해야 합니다.

## 3. 실제 Meta API 자동 검증 (명시적 승인 / API 과금)

**실제 API 키를 Cursor 채팅/프롬프트/스크린샷/소스에 붙여 넣지 마세요.** 서버 전용, 저장소 바깥의 비공개 파일을 사용하세요. 아래 설정은 샘플이며, API 모델 사용 권한은 Meta 계정에서 별도로 준비되어 있어야 합니다.

`~/.safecall/meta.env` (Windows는 `C:\Users\사용자명\.safecall\meta.env` 등 저장소 바깥) :

```dotenv
MODEL_API_KEY=여기에_개인_API_KEY
META_LIVE_ENABLED=true
SAFECALL_MEDIA_ASR_ENABLED=true
META_SPEND_APPROVED=true
META_BUDGET_KILL_SWITCH=false
SAFECALL_LIVE_VERIFY_CONSENT=YES
META_MAX_REQUESTS_PER_RUN=4
SAFECALL_MEDIA_ASR_LANGUAGES=English
```

`SAFECALL_LIVE_VERIFY_CONSENT=YES`는 **검증 도구가 합성 음성 약 105초를 외부 Meta 서버에 보내 비용이 발생해도 좋다는 운영자 명시 승인**입니다. 원본 보이스피싱 MP4는 패키지에 없고 사용하지 않습니다. 외부로 파일을 전송할 권한이 없는 자료는 쓰지 마세요.

FFmpeg 설치 및 확인:

```sh
ffmpeg -version
```

macOS / Linux:

```sh
node --env-file="$HOME/.safecall/meta.env" --experimental-strip-types scripts/verify-cursor-both-modes.mjs --mode=live
```

Windows PowerShell:

```powershell
node --env-file="$env:USERPROFILE\.safecall\meta.env" --experimental-strip-types scripts/verify-cursor-both-modes.mjs --mode=live
```

**중요:** `npm run verify:cursor:live` 단독 실행은 터미널 환경변수를 미리 로드한 경우에만 API를 사용합니다. `--env-file`을 이용한 위 명령을 권장합니다. 외부 API로 실제 요청하는 `--mode=all`도 지원하지만 1회의 Meta 테스트를 추가로 실행하므로 비용이 발생합니다.

도구는 서버를 루프백에서 시작한 후 **합성 WAV의 진행 시각을 실제 벽시계로 전달**합니다. 브라우저 스피커로 음성이 들리는 테스트가 아니라 **FFmpeg → Meta ASR 스트림 → Muse Spark 서버 경로**에 대한 테스트입니다. 실제 영상 촬영은 아래 수동 브라우저 시험도 해야 합니다.

검증 기준:

- `/api/readiness`: `mediaAsrReady: true` 및 `mediaAsrMode: META_REALTIME_STT_OPT_IN`은 **설정 준비**이지 성공 증거가 아님.
- `/api/state`: `media.actualStt: true`, `media.provider: META` 및 `ASR_FINAL` 이벤트 `ACTUAL_STREAMED_ASR` provenance가 있어야 **전사 성공**.
- `AI_ANALYSIS_COMPLETED` 이벤트의 `MODEL_VERIFIED` provenance 및 `metaReview.status: LIVE_VERIFIED`가 함께 있어야 **모델 응답 성공**.
- 두 조건 모두 충족하지 못하면 검증 스크립트는 실패하며, 성공했다고 표시하지 않습니다.

인증 실패, 네트워크 차단, 요금 제한, API 스키마 변화 등이 있으면 출력의 오류 **코드만** 확인하고 키나 오디오 원문은 공유하지 마세요. 실제 Meta 모델의 성공 여부는 라이브 테스트 로그 없이 주장할 수 없습니다.

### 실제 브라우저 Meta 모드

1. 설정 파일 로드 후 앱 실행:

   macOS/Linux: `node --env-file="$HOME/.safecall/meta.env" --experimental-strip-types demo/safety-challenge/server.mjs`

   Windows: `node --env-file="$env:USERPROFILE\.safecall\meta.env" --experimental-strip-types demo/safety-challenge/server.mjs`

2. `/live`에서 `Meta live ASR` 선택 → `training-bank-20-en` 선택.
3. 권리 확인/외부 전송 동의 두 체크박스를 체크(합성 TTS만).
4. 전화 수신 버튼 → TTS 오디오 재생과 전사·모델 이벤트 관찰. 실패 시 자동으로 가짜 Meta 결과를 보여주지 않아야 합니다.
5. 실제 Meta AI 결과와 규칙 엔진 결과가 서로 다른 카드로 표시되는지 확인하세요.
6. 안경 HUD 브라우저 프리뷰, 가상 GPS, 가상 송금 정책 연동을 검증하세요. 실제 기기·금융 거래를 검증한 것은 아닙니다.

## 4. Cursor Agent에 전달할 검증 지시 (복사)

> 이 프로젝트는 SafeCall v1.47.2이다. 기존 동작과 보안 경계를 바꾸지 말고 먼저 `npm run verify:cursor`, `npm run test:v1471`, `npm run test:v147`, `npm run test:v144`, `npm run check:static`, `npm run check:preflight`를 실행하라. 두 사건 20턴, HIGH, AT_BANK, 안경 HIGH, 가상 송금 409를 각자 확인하라. `artifacts/cursor-verification/results.json`을 보고하라. Meta 키는 저장소 바깥 서버 환경파일에서만 불러오고 키 내용을 읽거나 출력·복사·커밋하지 마라. Meta LIVE 비용과 동의 플래그가 명시적으로 준비된 경우에만 `scripts/verify-cursor-both-modes.mjs --mode=live`를 실행하라. `mediaAsrReady`만으로 성공 판정하지 말고 실제 `ACTUAL_STREAMED_ASR`과 `MODEL_VERIFIED` 이벤트가 모두 있는지 확인하라. 브라우저 `/live`에서 TTS 음성과 UI를 실제로 확인하고, 실패한 항목은 있는 그대로 기록하라. 실제 전화·실물 안경·실제 GPS·실제 은행 차단은 구현됐다고 주장하지 마라. GitHub push/공개 배포 금지.

## 5. 검증 한계 및 오류 상태

- API 키 없는 환경의 Meta LIVE: `NOT VERIFIED / NOT CONFIGURED` (거짓 PASS 금지).
- 브라우저 자동 화면 검사는 실행 PC에서 따로 확인해야 합니다. 화면 경로 HTTP 200만으로 음성 재생과 버튼 동작을 증명하지 않습니다.
- 실제 Meta 계정의 모델 권한/요금/정확도는 로컬 단위 테스트로 확인할 수 없습니다.
- 브라우저의 기본 표시인 `/live`와 API는 기존 버전을 유지합니다. 이번 1.47.2는 검증 도구와 가이드 추가가 주된 변경입니다.
