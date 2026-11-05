# SAFETYED / SafeCall v1.47 — 20턴 안정화 · 촬영 가이드

> **경계:** 기본 실행은 `OFFLINE SCRIPT REPLAY + RULE ENGINE`이다. 음성은 실제 로컬 TTS WAV로 재생되지만, 전사는 녹음과 시간상 동기화된 **작성된 대본**이다. Meta ASR/Muse Spark가 듣고 판단했다고 주장하면 안 된다. 별도 Meta LIVE 모드는 기존 방식으로 유지하되 실제 API 키/비용/권리 동의 및 실측 검증이 필요하다.

## 가장 빠른 촬영

1. ZIP 압축 해제 후 Node.js 22 환경에서 `npm run demo:safety` 실행.
2. Chrome에서 `http://127.0.0.1:4173/` 열기. 랜딩은 영어 기본.
3. **Enter Live Experience** → `/live` 이동.
4. 기본값 **Stable 20-turn replay**, `training-bank-20-en` 선택된 것을 확인. 다른 시드/사례가 필요하면 `Choose another 20-turn case`.
5. 녹화 프로그램(OBS 등)을 켜고 **Answer** 클릭. 브라우저 소리 출력을 허용.
6. 약 105초짜리 오디오가 진행되는 동안 왼쪽에서 0/20 → 20/20 대본 이벤트, 오른쪽에서 규칙 위험 점수·안경 HUD·가상 GPS 변화를 확인.
7. 은행 도착과 HIGH 경고 후 **Try virtual transfer** → 실제 SafeBank 데모 API의 `POLICY_DENIED` 확인.
8. Restart로 완전히 새로운 사건 세션 생성 가능. 녹화 중 예기치 않은 Meta 호출/과금 없음.

### 녹화 자동화 (선택, **이 실행 환경에서는 브라우저 실행 검증 불가**)

```bash
npm ci
npx playwright install chromium
ffmpeg -version
npm run record:v147
```

`artifacts/v147/SafeCall-v147-20Turn-Product-Demo.mp4`, `SafeCall-v147-BrowserOnly.webm`, `recording-metadata.json`, `20-turn-end.png`를 로컬에 생성하도록 설계했다. 이 스크립트는 공개 업로드, GitHub push, 외부 API 호출을 하지 않으며 Meta API를 강제로 OFF로 둔다. Playwright는 브라우저 소리를 녹음하지 않으므로 동일한 TTS WAV를 FFmpeg로 영상과 합성한다. 영상과 실제 오디오의 시작점은 촬영 PC에서 최종 확인해야 한다.

## 구현 및 안정성

- 두 사례 각각 정확히 **20개의 등장인물 발화**, SHA256로 WAV와 manifest의 동일성 확인.
- 다른 발화가 오기 전에는 해당 대본 내용이 브라우저/위험 엔진으로 보내지지 않는다.
- Media-Clock이 사건 시간을 결정; 250ms ticker와 시계 보고가 겹쳐도 발화를 **한 번만** 처리한다.
- MEDIA 상태·Meta 결과가 `SCRIPTED_TTS_REPLAY`로 표시되며 `actualStt=false`, 모델 요청 수 0.
- 읽기 전용 안경 토큰으로 리플레이/송금 관련 POST 차단.
- 별도 요청으로 원본 미디어 또는 임의 파일 경로 접근 불가; manifest는 공개 정적 경로에 없음.
- 20턴 이후 추가 최종 발화는 위험 근거로 수용하지 않는다.
- 기존 `/mobile`, `/glasses`, `/legacy`, `/` 및 `/live` 구조 유지.
- **실제 은행·카드·전화 OS 차단 없음**: SafeBank 가상 앱 내 송금 요청 제한만 구현.

## 시험 결과 (이번 패키지 준비시 재검증)

- v1.47 신규 오프라인/서버 통합: 5/5 통과.
- v1.45 미디어 + v1.47: 51/51 통과.
- 기존 데모 회귀: 144/144 통과.
- 오프라인 코어 회귀: 283/283 통과.
- 모바일: 23/23 통과.
- SafeBank: 25/25 통과.
- v1.42 GPS 통합: 4/4 통과.
- 정적 및 보안 사전검사 통과 (브라우저·Next.js 빌드·실물 장치/실제 Meta 통합의 증명은 아님).

## 미검증·제약

- 이 환경의 Chromium은 localhost 접속이 보안 정책으로 차단되어 완전한 브라우저 E2E 및 자동 녹화 스크립트를 여기서 수행하지 못했다. **촬영 PC에서 반드시 실행할 것.**
- Meta의 실제 ASR 및 Muse Spark 추론은 이번 버전에서 호출하지 않았다. 실모델을 썼다는 홍보/영상 자막을 붙이지 말 것.
- 두 시나리오는 `CURATED_SEEDED_FIXTURE`다. 버튼의 Random은 **두 검증된 녹음 중 선택**이지 AI가 매번 새 대화를 생성하는 기능이 아니다. 생성 AI 격리 기능은 별도 개발이 필요하다.
- 오프라인 eSpeak 음성의 전달/재배포·엔진 라이선스는 공개 영상 및 배포 전에 해당 약관을 확인할 것.
- 위치는 `SIMULATED_GPS`, 안경은 브라우저 HUD 프리뷰.

## 주요 변경 파일

- `demo/safety-challenge/replay-fixture.mjs`: 서버 전용 20턴 시나리오 검증.
- `demo/safety-challenge/media-orchestrator.mjs`: 오프라인 리플레이/시계 동기화/가상 GPS 이벤트.
- `demo/safety-challenge/server.mjs`: `/api/media/replay`, 확정 발화 20개 상한.
- `demo/safety-challenge/media-realtime.mjs`: 훈련용 20턴 WAV 목록.
- `demo/safety-challenge/public/live.{html,css,js}`: 2 모드 구분, 영상용 3열 UI, 0/20 표시, 언어 전환.
- `scripts/generate-tts-audio.mjs`: 로컬 WAV 생성 및 manifest.
- `scripts/record-v147-demo.mjs`: Playwright + FFmpeg 영상 생성 자동화 (실행환경 검증 필요).
- `tests/v147-stable-replay.test.mjs`: 권한·출처·시계·20턴·GPS·은행 확인.

## 다음 개발 단계 (촬영 이후)

AI Scenario Generator가 **정답과 미래 대사를 Detector에 전달하지 않도록 분리**하고, 별도 승인한 합성 음성만 실제 Meta ASR로 입력한다. 동시 연결/쿼터/지연·오탐 측정이 끝난 다음에야 AI 무작위 생성 모드를 출시한다. 촬영 기준선으로는 이번 오프라인 재현 모드를 유지한다.
