# Meta Muse Spark v0.5 연결 설계 (2026-10-27)

## 현재 상태
- 실제 Meta Model API **코드 구현**; 본 개발 세션에서 실제 키·유료 호출은 사용하지 않음.
- 데이터: v0.4의 가상 60개 통화 / 270개 발화. 실제 전화 음성, 개인정보, 은행 연동 없음.
- 유일한 로컬 위험 판별기는 `src/modules/risk-triage/index.ts`의 `assessTriage()`.
- `src/modules/analysis/`의 `LiveMetaProvider`는 추가 해석 공급자이며 새 위험 엔진이 아님.
- 서버의 `src/app/api/meta/analyze/route.ts`가 데이터 검증, 위험 트리거, 권한, 사용량 제한을 담당.
- 정책 및 코칭은 `src/modules/policy`, `src/modules/coaching` 소유. Meta 응답으로 실제 거래 집행 불가.

## 공식 문서 및 구현 선택
- [Meta Chat Completions](https://dev.meta.ai/docs/cookbook/quickstart-chat-completions)
- [Meta JSON Schema 출력](https://dev.meta.ai/docs/structured-output)
- [Meta API Reference](https://dev.meta.ai/docs/api-reference)
- [Meta 요금](https://dev.meta.ai/docs/pricing-rate-limits)
- Base URL: `https://api.meta.ai/v1`, 엔드포인트: `POST /chat/completions`, 모델: `muse-spark-1.3` **Standard**.
- Bearer `MODEL_API_KEY`를 서버만 취급. API 요청은 `developer` 지시문 + `user`에 JSON 직렬화된 **데이터** + 엄격한 JSON Schema.
- 실제 응답 파싱 후 `validateModelOutput()`을 이용해 enum, 값, 필드, 입력에 존재하는 `turnId` 검증.

## 테스트 실행 방법
1. ZIP 압축을 해제한 뒤 `npm install`.
2. `npm run test:meta`, `npm run test:replay` 및 `npm run typecheck`, `npm run build`.
3. `npm run dev`, `http://localhost:3000/lab/replay`.
4. 모의 응답 버튼은 `MOCK`이며 과금·외부 호출이 없고, 원래 규칙 결과를 변환한 표시용 값임.
5. 실제 Meta 호출은 현 단계에서 **수행하지 않음**. 실행 전에 본인의 Meta 계정 접근 권한·요금을 확인하고 아래 설정을 사용자 승인 이후에만 진행.
6. `.env.example`를 참고해 **로컬 전용** `.env.local`에 `MODEL_API_KEY=...`, `META_LIVE_ENABLED=true`, `META_MAX_REQUESTS_PER_RUN=5`로 설정. 키를 대화, 문서, ZIP 또는 GitHub에 넣지 말 것.
7. UI에서 각 발화의 '실제 유료 호출에 동의' 확인란을 선택한 후 명시 버튼을 눌러야 **1회** 호출. 기본 설정은 `META_LIVE_ENABLED=false`.
8. 서버는 트리거가 없는 발화의 LIVE 호출을 차단하며, 단일 서버 프로세스 당 최대 5회, 동일 입력 재요청 차단, 12초 타임아웃을 적용.

**주의:** 로컬 개발용 in-memory 호출 제한은 재시작·동시 실행·서버리스 복제 시 초기화된다. 실제 공개 서비스나 외부 접근 가능한 배포에선 계정 인증, 공유 데이터베이스 기반 durable quota, 사용량 알림, 청구 한도가 필수다. LIVE 배포 전에 구현할 것.

## 데이터 보호
- 프롬프트에는 현재 발화까지의 `turnId, speaker, text`와 actionEvent만 들어가며, 정답, 미래 발화, 출처 목록은 전달하지 않음.
- 실제 Meta LIVE 시 전송한 문장은 외부 API 처리 대상임. 실데이터는 명시적 동의·개인정보 처리 검토 전 전송 금지.
- 대화는 명령 실행용 프롬프트가 아닌 비신뢰 분석 대상 데이터. 모델은 정책·거래 상태를 직접 바꾸지 못함.
- 신원 주장이나 위험 지수는 사실 확정 또는 통계적으로 보정된 '사기 확률'이 아님.

## 요금 통제
- Meta 공식 가격(2026-10-27 확인, Standard): 100만 입력 토큰당 $1.25, 100만 출력 토큰당 $4.25. 캐시 입력 토큰 할인 가능. 지출은 응답 usage와 실제 청구 설정에 따라 달라짐.
- 미승인 자동 API 호출·60개 사례 배치실험 금지. 실제 토큰 사용량/가격은 성공한 LIVE 요청 후에만 보고.
- 현재 UI는 가격표 기준의 캐시 미적용 **참고 추정치**만 표시.

## 데이터 흐름
`replay prefix` → `buildReplayMetaInput` → `assessTriage` → `MOCK or gated MetaAnalysisProvider` → `validateModelOutput` → `selectAssistedCoaching` → UI.

## 데모/실제 구분
- `OFFLINE`: 호출 전.
- `MOCK`: 규칙 결과를 반환하는 가상 공급자. 모델 성능 측정이 아님.
- `LIVE`: API가 정상 응답하고 서버 검증에 성공한 결과에서만 표기.
- `ERROR`: 모델 오류; 규칙 기반 기본 코칭으로 되돌림.

## v0.6 cost guard

Before each LIVE Spark request in `/api/meta/analyze`, a local durable `CostGuard` reservation must succeed. A server-side spending-approval env flag must additionally be true, and unknown upstream usage conservatively consumes its reserved estimate. `/api/budget` is NOT Meta billing. The realtime ASR bridge has a separate live voice opt-in and shares the same budget ledger. See `META_API_BUDGET_CONTROL.md`.
