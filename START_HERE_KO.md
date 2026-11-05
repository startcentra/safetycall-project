# SafeCall v1.47.2 — 실행 안내 (GitHub Clean Source)

## 실행 전 준비

- Node.js 22.4 이상이 필요합니다.
- **Stable 20-turn replay**는 Meta API 키 없이 실행됩니다.
- **Meta live ASR**에는 공식 API 계정 권한, FFmpeg, 서버 전용 환경변수, 비용 승인 및 합성 음성 전송 동의가 필요합니다.
- 이 패키지는 **실제 보이스피싱 MP4와 API 키를 포함하지 않습니다.** 기본 TTS는 영어 합성 WAV입니다.

## 설치 / 실행

```bash
npm ci
npm run demo:safety
```

`http://127.0.0.1:4173/` 접속 → **Enter Live Experience** → `Stable 20-turn replay` → `training-bank-20-en` → 전화 수신.

시연 중 20턴 발화, 위험도, 안경 HUD(브라우저 시뮬레이터), 가상 GPS, SafeBank 가상 송금 거부 이벤트를 확인할 수 있습니다.

## 검증

```bash
npm run verify:cursor
npm run test:v147
npm run test:v1471
npm run check:static
npm run check:preflight
```

`npm run verify:cursor`는 가속된 **규칙 기반 오프라인 통합 테스트**이며, 실제 Meta 음성 인식 또는 브라우저 녹화를 증명하지 않습니다.

## Meta Live 검사

Meta API 키를 GitHub 저장소 밖의 개인 환경파일에 저장하세요. 키를 Cursor 채팅/로그에 노출하지 마세요. 상세 내용: `docs/CURSOR_VERIFY_BOTH_MODES_KO.md` 및 `.env.example`.

실제 `ASR_FINAL`과 `MODEL_VERIFIED` 응답을 확인하기 전에는 Meta Live 성공을 주장하면 안 됩니다.

## 구현상 한계

- Meta 안경 HUD: 브라우저 시뮬레이터이며 실물 안경 연결 미검증.
- GPS: 합성 좌표이며 실제 위치 추적 아님.
- SafeBank: 가상 결제 보호만 수행하며 실제 은행 거래 차단 아님.
- 영상을 GitHub에 올리지 마세요. `artifacts/` 파일은 로컬에 보관합니다.

README.md에서 오픈소스 사용 기술과 출처를 확인할 수 있습니다.
