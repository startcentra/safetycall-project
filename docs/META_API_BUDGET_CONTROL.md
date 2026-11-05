# Meta API budget controls ($150 promotional credit reference)

**State**: v0.6 local-cost-guard implementation, NOT Meta billing integration, live tests not run. Actual credit eligibility, balance and expiry must be checked in Meta console.

## Official Standard rates, checked 2026-10-28

- Muse Voice Transcribe: USD $0.18 per processed audio hour. Streaming and file are billed alike.
- Muse Spark 1.3: input $1.25 / million tokens, cached input $0.15 / million tokens, output $4.25 / million tokens.
- No Contributor model by default because submitted content may be used to train models.

Source: https://dev.meta.ai/docs/pricing-rate-limits

The total grant is $150. Keep $40 reserve; local app cap $110; **initial separately approved cap $5**, **daily $5**, **session $1**. A setting is a maximum, never a spending target. Default is *zero* approved spending.

## Guard design

- `.safecall-private/usage-ledger.json`: gitignored local ledger, chmod 0600. Reservations, timestamps, micro-USD amounts, status, uncertain flag. **No transcripts or credentials**.
- Atomic `wx` lockfile + atomic file rename prevent simultaneous successful reservations on this machine. Contention and crashes block future LIVE requests. Manual recovery must first reconcile upstream usage; never silently delete an unknown reservation.
- `CostGuard.reserve` occurs BEFORE each existing Spark API call and BEFORE opening each Meta realtime ASR session.
- Estimate Spark from a conservative 16k-input/1200-output-token envelope and 20% buffer, then reconcile with returned token counts. ASR is reserved for the maximum declared clip duration, and settled from `audioProcessedMs` events (or charged full reserved estimate when unknown).
- Unknown/errored upstream work conservatively consumes reserved budget. Actual charge above reserve is recorded at the higher amount. The ledger's charged value is a **conservative accounting bound**, not a verified provider invoice. A provider request could still exceed its reservation, so this is not an account-level absolute billing limit.
- Process-local v0.5 request count is retained as *additional* duplicate/rate safeguard; durable guard is the money cap.
- Force OFFLINE if `META_LIVE_ENABLED` or `META_SPEND_APPROVED` is not true, or if kill switch is active. For voice, `META_VOICE_LIVE_ENABLED` must additionally be true.

**Do not set these LIVE flags or send any charged requests without further user approval.** An API key by itself is never permission to bill.

## Spending plan (ceilings, not targets)

| Stage | USD maximum |
| --- | ---: |
| Initial connectivity and usage check | 5 |
| Korean ASR validation | 10 |
| Spark contextual risk/false negative studies | 35 |
| False positive, negative and delay tests | 40 |
| Final demonstration rehearsals | 20 |
| Reserved credit / contingency | 40 |
| **TOTAL** | **150** |

The first stage should begin with only a few seconds of audio, then one short Spark request. Compare usage to provider console before additional approvals. The local ledger cannot see other keys, Playground use, other applications, refund/credit expiry or actual balance. Audit official billing regularly and apply provider-side caps if available.

## Operations

1. Default `.env.example`: `META_LIVE_ENABLED=false`, `META_VOICE_LIVE_ENABLED=false`, `META_SPEND_APPROVED=false`, `META_BUDGET_KILL_SWITCH=false`.
2. Before any approved LIVE trial, verify account/credit terms and network privacy notice, audit the ledger and run `npm run test:voice`.
3. The `GET /api/budget` route reports the **local conservative ledger** and explicit difference from official provider billing.
4. Kill switch `META_BUDGET_KILL_SWITCH=true` prevents NEW reservations. Already sent work may still incur charges.
5. If `.lock` file persists after a process crash, stop all gateways and reconcile the provider usage before manual recovery.
6. Not designed for distributed/cloud multi-user workloads; requires a real ACID store and identities per account before deployment.


### v0.6.1 exception correction

`META_MAX_CONCURRENT_LIVE_SESSIONS=1` applies to active **VOICE** sessions; up to 2 concurrent **SPARK** requests are separately admitted so that realtime transcription and contextual analysis can overlap. Both share the identical durable spent + reserved USD budgets. Corrupt ledger values, invalid caps and duration estimates fail closed. On missing settlement the request is reported as an error, not successful accounting. See ADR-0007.


## v0.6.2 비용 장부 의미 변경
`pendingUsd`: 예약 중, `measuredUsageUsd`/`spentUsd`: Meta 응답 사용량에서 계산한 **로컬 추정치**, `liabilityUsd`: 사용량이 불확실한 보수적 의무, `exposureUsd`: 위 세 값 합계. `remainingApprovedUsd`는 모든 exposure를 차감한다. 이전 v1 장부의 chargedMicros는 실제 청구 확인 자료가 아니므로 liability로 이전한다. 성공 사용액이 예약액보다 작은 경우 차액이 해제되지만, 네트워크 오류·타임아웃은 임의 해제하지 않는다. LIVE 인증은 별도 로컬 강한 비밀번호와 서버 서명키를 모두 필요로 하며 OFF가 기본이다.

## v0.6.4 추가 제한 (Gate 1)

- Spark 출력 상한은 `META_MAX_OUTPUT_TOKENS`(기본 700, 허용 128~1200)이며 잘못 설정하면 LIVE를 차단한다. Meta API 요청에 `max_completion_tokens` 포함. `finish_reason=stop`이 아니면 유효한 위험 분석 결과로 사용하지 않는다. 공식 Meta 문서 기준으로 출력 상한은 추론 토큰도 포함한다.
- 별도 승인된 로컬 환경에서 `POST /api/meta/session`은 서명된 10분 Spark 테스트 세션을 발급한다. 이후 Spark 분석은 서버 서명 티켓의 ID로 동일 통화비용에 누적. 새 티켓을 만들어 새 통화로 주장할 가능성은 Gate 2 Case Coordinator가 해결할 설계 문제다. 이것은 생산 환경 비용 통제가 아니다.
- 예약액보다 높은 사용량은 측정값대로 장부에 보존하되 `overrunCount` 발생 후 새 LIVE를 중단한다. 공급자 청구액을 앱이 상한 아래로 조정할 수 없다.
- Kill Switch가 설정되지 않았으면 ON(차단)으로 처리한다. 승인 없는 호출은 0회.
