# SafeCall v1.47.2 검증 결과 (현재 환경)

- 신규 `npm run verify:cursor`: 은행·검찰 사칭 / 등기배송 사칭 모두 **20/20턴, HIGH, GPS AT_BANK, 안경 HIGH, 가상 송금 HTTP 409** 통과. 각각 HIGH 처음 진입은 9턴, 13턴.
- 소스 기본 Meta 설정은 OFF. 서버 전용 `MODEL_API_KEY` 및 Meta LIVE 플래그는 이 환경에 없었으므로 실제 Meta STT·Muse Spark 호출은 **0회 / 미검증**.
- `npm run verify:cursor:live`: 필수 설정 누락시 **exit 2 / 외부 호출 없음**으로 종료되는 안전 게이트 검증.
- `npm run test:v1471`: 3/3 PASS.
- `npm run test:v147`: 5/5 PASS.
- `npm run test:v144`: 50/50 PASS.
- `npm run test:v140`: 10/10 PASS.
- `npm run test:demo`: 144/144 PASS.
- `npm run test:offline`: 283/283 PASS.
- `npm run check:static`, `npm run check:preflight`: PASS.
- `/`, `/live`, `/api/readiness`, `/api/media/catalog`, `/media/training-bank-20-en.wav`: 실제 서버 HTTP 200 확인.
- Chromium 헤드리스 캡처는 실행 환경에서 제한시간 초과로 실패하여 버튼 클릭·실제 음성 출력 브라우저 E2E는 **미검증**.
- `test:mobile` 전체 재실행은 실행 환경 제한시간에 걸려 완료 결과 미확보. 단독 테스트 통과를 주장하지 않음.
- 본 검증은 실제 Meta 안경/전화/GPS 센서/실제 은행 기능에 접근하지 않음.

`artifacts/cursor-verification/results.json`은 실행할 때마다 갱신됩니다. 새 환경에서 위 숫자가 재현되는지 Cursor가 별도 확인하세요.
