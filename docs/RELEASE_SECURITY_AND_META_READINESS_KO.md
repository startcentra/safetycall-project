# SafeCall v1.47.2 — GitHub 업로드용 민감정보 정리 및 기능 검증

## 정리한 내용

- 이전 공개 보이스피싱 MP4에서 손으로 관찰한 자막 내용, 원본 파일명, 인명·의심 도메인이 포함되어 있던 `data/v131/video-caption-observations.json`은 **완전한 합성 테스트 문장**으로 교체했다. v1.31 과거 자막 타이밍 회귀 테스트용이며 실제 STT나 원본 녹음이 아니다.
- 원본 자막에서 계산한 오래된 `data/v131/timeline-results.json`은 삭제했다.
- `tests/v132-canonical-integration.test.mjs`의 과거 의심 도메인 문자열 검사를 원본 파일명 비노출 검사로 변경했다.
- `.env.example`의 과거 MP4 사용 안내를 현재 합성 WAV 사용 기준으로 정리하고 모든 실제 비밀키를 제외했다.
- `README.md`에 과거 자막 자료가 합성 데이터로 교체되었다는 사실을 명시했다.
- 테스트용 가짜 토큰과 `example.org` 주소는 외부 유출이 가능한 실제 정보가 아니라 보안 테스트 데이터이므로 보존했다.

## 핵심 시연 자산

- `demo/safety-challenge/server.mjs`: 로컬 실험 서버, Meta 기능 게이트, 사건별 세션
- `demo/safety-challenge/public/`: 영어 랜딩, `/live`, 휴대폰과 안경 HUD
- `demo/safety-challenge/media/`: 합성 영어 TTS WAV 네 개, 그중 20턴 사건 두 개
- `demo/safety-challenge/media-realtime.mjs`: 24kHz PCM, Meta WebSocket 실시간 ASR 어댑터
- `src/modules/analysis/meta-provider.ts`: Muse Spark 1.3 Chat Completions 호출 및 JSON 스키마 검증
- `demo/safety-challenge/media-orchestrator.mjs`: 전사 이벤트, 로그·GPS·안경·가상 은행 연결
- `demo/safety-challenge/live-journey.mjs`: 가상 위치 및 보호 정책
- `scripts/verify-cursor-both-modes.mjs`: 20턴 오프라인 / 실제 Meta 연결 별도 검증

## 실제 실행 검사 (Node.js 22.16.0, 키 없는 로컬 환경)

- `npm run check:preflight`: PASS
- `npm run check:static`: PASS
- `npm run verify:meta-contract`: PASS (가짜 HTTP 전송으로 계약만 검증)
- `npm run test:v144`: 50/50 PASS
- `npm run test:v147`: 5/5 PASS
- `npm run test:v1471`: 3/3 PASS
- `npm run test:v139`: 15/15 PASS
- `npm run test:v140`: 10/10 PASS
- `npm run test:v142`: 4/4 PASS
- `npm run test:offline`: 285/285 PASS
- `npm run test:demo`: 144/144 PASS
- v131/v132 합성 자막 회귀: 21/21 PASS
- `npm run verify:cursor`: PASS (20턴 오프라인 두 사건 HTTP 통합 검사)
- `npm run verify:cursor:live`: NOT VERIFIED (키·사용승인·전송동의 없음; 외부 Meta 호출하지 않음)

## Meta 실제 연결 가능성

- 코드에 실제 Meta API URL과 요청/응답 처리 경로가 있다. Meta 공식 문서에는 `wss://api.meta.ai/v1/asr/realtime` / `muse-voice-transcribe-1.0` 및 `https://api.meta.ai/v1/chat/completions` / `muse-spark-1.3`가 명시되어 있다.
- **API 연결 코드는 있으나 성공적인 실서버 호출 결과는 이 패키지로 증명되지 않는다.** 유효한 Meta 계정의 접근 권한, 서버 측 환경키, FFmpeg, 비용 승인, 합성 오디오 전송 동의가 필요하다.
- 브라우저 클릭·실제 안경 출력·실제 GPS·실제 금융 시스템 거래 차단은 미검증 또는 시뮬레이션이다.
- 실제 Meta STT와 Muse Spark 응답에 `LIVE_VERIFIED` 등이 기록된 뒤에만 실제 AI 분석이라고 발표한다. 규칙 기반 모드에서 Meta 분석 성공을 주장하지 않는다.

## 업로드·촬영 전 주의

1. 배포 ZIP 자체는 소스 패키지이며 `.env` 실제 파일이 없다. API 키는 반드시 저장소 밖에 둔다.
2. GitHub에 push하기 직전에 `git status`, staged diff, secrets scanner를 다시 확인한다.
3. `artifacts/`, 녹화본, 실제 음성 원본, 개인 정보, 실행 로그를 GitHub에 올리지 않는다.
4. 공개 지도·아이콘·TTS 음성 제작 도구의 라이선스는 출시 전에 별도로 확인한다.
5. 기존 레거시 모듈과 테스트를 포함한 안정성 중심 패키지이며 **최소 파일 수를 위한 전면 리팩터링은 수행하지 않았다.**

이 보고서는 정적 패턴 탐지와 로컬 테스트에 한정하며, 실제 사용자의 모든 비밀정보나 런타임 유출 가능성이 없음을 보증하지 않는다.
