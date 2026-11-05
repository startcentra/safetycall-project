# SafeCall Guardian — 현재 API 계약 (v0.3)

이 문서는 **이미 코드에 있는 API와 미래 API를 분리**한다. 실제 Meta API, 실전 통화 수집, 실제 은행 거래는 없다.

## 1. 현재 구현된 API

| Method | Route | 실행 코드 | 의미 |
|---|---|---|---|
| GET | `/api/health` | `src/app/api/health/route.ts` | 데모 서버 상태 / Meta 미연결 표시 |
| POST | `/api/triage` | `src/app/api/triage/route.ts` | `assessTriage()` 직접 호출: 오프라인 분석 |
| POST | `/api/simulations` | `src/app/api/simulations/route.ts` | 임시 가상 세션 생성 |
| POST | `/api/simulations/{id}/events` | `src/app/api/simulations/[id]/events/route.ts` | 상태 머신에 사용자 이벤트 적용 |

### `POST /api/triage`

입력 예시:

```json
{
  "turns": [{ "speaker": "caller", "text": "지금 송금하세요." }],
  "actionEvent": "NONE"
}
```

- `turns`: 1~8개, 개별 발화 1~800자, 역할 `caller | user`.
- `actionEvent`: 선택 항목, `NONE | TRANSFER_PREPARED | OTP_SHARE_ATTEMPT`.
- 반환 `TriageResult`: `mode="OFFLINE_RULE_EXPERIMENT"`, `shouldCallMeta`(후보만), `signals[]`, `riskIndex`, `psychologicalPressureIndex`, `riskBand`, `emergencyFlag`, `limitations[]`.
- 위 두 지수는 **검증되지 않은 임시 지수**이며 실제 사기 확률 또는 임상 심리 판정이 아니다.
- `shouldCallMeta=true`가 되어도 외부 Meta API 호출은 이루어지지 않는다.

### `POST /api/simulations`

요청을 보내면 UUID를 가진 가상 `SimulationState`를 반환한다. 이 세션은 **서버 프로세스의 RAM에만 일시 저장**되며 30분 TTL이 적용된다. 데모 전용이며 사용자별 인증을 구현한 서비스가 아니다.

### `POST /api/simulations/{id}/events`

```json
{ "action": "NEXT_LINE" }
```

지원 이벤트: `NEXT_LINE | REQUEST_TRANSFER | CANCEL_TRANSFER | VERIFY_CLAIM | END_CASE`.

반환 상태에는 `assessment`가 추가되었다. 이는 `/api/triage`와 같은 `assessTriage()`의 출력 스냅샷이다. `risk`와 `signals`는 UI 하위 호환용 요약 필드이며 **독립 위험 계산이 아니다**.

`REQUEST_TRANSFER` 시 서버가 `actionEvent="TRANSFER_PREPARED"`로 재평가하고, `policy`가 결정한 보류를 `mock-banking`이 집행한다. 가상 잔액은 변경되지 않는다.

## 2. 현재 존재하지만 연동되지 않은 계약

- `src/lib/contracts.ts`: Meta 분석 제공자용 `AnalysisProvider`, `AnalysisResult` Zod 계약.
- `src/modules/analysis/index.ts`: 타입만 내보냄. **실제 Meta 공급자는 없음**.

## 3. 향후 API 계획 — 미구현

| Route(초안) | 목표 |
|---|---|
| `POST /api/analyze` | 서버에서 Meta API 호출, 구조화 결과 검증 |
| `GET /api/cases/{id}` | 사건별 코칭/행동 타임라인 조회 |
| `GET /api/evaluations/{id}` | 오프라인 재생 실험 결과 조회 |

추가 엔드포인트가 필요하더라도 새 위험 분석기를 만들지 않는다. `/lab`, 가상 시뮬레이터, 향후 사례 재생 실험은 모두 같은 `risk-triage` 계약을 사용한다.

## 4. 제한과 오류

- 입력은 Zod로 검증하며 잘못된 JSON 및 필드는 400 오류를 반환한다.
- 없는 세션이나 잘못된 상태 전이는 현재 데모 구현에서 409를 반환할 수 있다. 실제 서비스용으로 404/409 분리는 향후 작업이다.
- 모델 실패 시의 503 상태는 아직 **미구현**.
- 모든 응답은 실제 전화·실제 금융 계좌의 상태를 의미하지 않는다.

## v0.5 Meta provider test endpoints (local-only, no public LIVE deployment)

- `GET /api/meta/status`: returns model name, LIVE activation flag, key-present boolean (never the key), per-process maximum.
- `POST /api/meta/analyze`: JSON `{ "requestedMode":"MOCK", "turns":[{"turnId":"T1","speaker":"caller","text":"..."}], "actionEvent":"NONE" }`.
- `LIVE` additionally requires `.env.local` with `MODEL_API_KEY`, `META_LIVE_ENABLED=true`, `{ "allowLive": true }`, request header `x-safecall-live-confirm: yes`, and a qualifying local risk trigger.
- Request accepts up to 8 turns of 800 characters; forbidden extra keys and fabricated turn IDs fail. Cached responses disabled.
- `MOCK` responses are transformations of existing offline triage, not the actual Muse Spark model.
- `LIVE` executes only explicit user requests; server checks requests, Meta output schema, and a per-process live quota. No authentication or durable rate limiting for public deployment (development only).
