## v0.7.0 신규 기여 (2026-10-29)

오픈소스를 새로 설치하지 않았습니다. Node.js 내장 `node:http`, `node:fs/promises`, `node:crypto`, EventSource/SSE, HTML/CSS/JS를 사용해 로컬 MOCK 시뮬레이터(`demo/safety-challenge/`)를 신규 구현했습니다. 위험 분석·상황 기억·행동 카드 엔진은 기존 v0.6.6을 재사용했습니다. 실제 Meta·통신사·금융기관 API 연동은 구현하지 않았습니다. 저작권 있는 실제 음성 또는 실존 피해자 정보를 사용하지 않았습니다.

# SafeCall Guardian — Open Source, Third-Party Services & Hackathon Contributions

_2026-10-28 · Documentation-only attribution update for local v0.6.3 ZIP_

## Scope and evidence

This disclosure was produced by inspecting `package.json`, the README and development history in the v0.6.3 archive. It does **not** establish ownership or dates independently; the team must confirm the final contribution list and the official submission rules before submitting. No new npm package, copied open-source source tree, downloaded AI model, or service integration was added by this document update.

## 1. External dependencies already declared in package.json

| Package/project | Role | Upstream | License (upstream) | Use status |
| --- | --- | --- | --- | --- |
| Next.js (`next`) | Server/rendering/App Router | https://github.com/vercel/next.js | MIT | Existing dependency |
| React (`react`, `react-dom`) | UI | https://github.com/facebook/react | MIT | Existing dependency |
| Zod (`zod`) | Input/output schema validation | https://github.com/colinhacks/zod | MIT | Existing dependency |
| ws (`ws`) | Local WebSocket server/client | https://github.com/websockets/ws | MIT | Existing dependency |
| Tailwind CSS (`tailwindcss`) | Styling | https://github.com/tailwindlabs/tailwindcss | MIT | Existing dev dependency |
| Vitest (`vitest`) | Unit tests | https://github.com/vitest-dev/vitest | MIT | Existing dev dependency |
| TypeScript (`typescript`) | Compile/type tooling | https://github.com/microsoft/TypeScript | Apache-2.0 | Existing dev dependency |

Also declared: `@tailwindcss/postcss`, `postcss`, `eslint`, `eslint-config-next`, `@types/*` and additional tooling. Before redistribution or public release, generate a full third-party notice from the **installed, locked dependency graph**, review transitive dependencies and preserve applicable copyright and LICENSE/NOTICE texts. `package.json` contains version ranges; the exact installed versions and transitive license list remain unknown because the dependency installation/full build have not been verified.

Credit does **not** replace compliance with each component's LICENSE or NOTICE requirements.

## 2. Components written for the SafeCall hackathon (subject to final owner review)

Project development records date project-specific work to October 27–28, 2026, within the event period. Identify only functionality actually written and demonstrated:

- Single `assessTriage()` risk-analysis pathway; deterministic synthetic test and evaluation data.
- Conversation replay, simulator, policy/coaching, mock banking, risk reporting.
- Meta Muse integration **adapter and offline mocked test path** (Meta's model is third-party and LIVE has not been verified).
- Browser voice-lab, streaming gateway code and budget-control tests (not verified against a real device/call).
- Exception handling, local mock gateway integration tests and documentation.

The team's own implementation should be distinguished from the open-source tools that underpin it. AI coding assistance, if used, should be disclosed honestly if requested by rules, and every demo claim must be tied to working functionality and dated project records.

## 3. Potential new open-source libraries — NOT imported, NOT integrated

| Candidate | Why it could help | License source | Recommendation |
| --- | --- | --- | --- |
| Playwright | Automated browser E2E tests across parent/child mock screens | https://github.com/microsoft/playwright/blob/main/packages/playwright/package.json (Apache-2.0) | High value AFTER full build works |
| Mock Service Worker (MSW) | Mock HTTP/WebSocket API boundaries and failure cases | https://github.com/mswjs/msw/blob/main/LICENSE.md (MIT) | Optional; current in-process fakes may suffice |
| LiveKit JS SDK / React starter | Future first-party WebRTC call with authorized audio tracks | https://docs.livekit.io/frontends/start/starter-apps/ (starter apps MIT); https://docs.livekit.io/agents/ (agents framework Apache-2.0) | Optional and potentially heavyweight; don't add without a concrete need |

**Do not claim these candidates are already used or copy a starter project wholesale without identifying the copied/adapted files and preserving licenses.** This project is currently built around Next.js + its own voice gateway; LiveKit is not required to demonstrate scripted browser calls.

## 4. External research, recorded media and synthetic data

Synthetic conversation cases are project-generated examples informed by publicly documented scam patterns. Do not describe them as real victim recordings, real annotated call datasets, or model evaluation against real calls. Research references are in `docs/RESEARCH_SOURCES_2026-10-27.md`, `docs/RESEARCH_DATASET.md`, and `docs/EVALUATION_PROTOCOL.md`. Rights to copy training audio, video or other media require separate review; merely citing a news article is not permission to redistribute its recordings.

## 5. Current demo capability labels

**Implemented and tested offline:** text replay, synthetic tests, mocked inference behavior, mock transaction policy, local gateway event integration checks. Existing report: 73/73 offline tests.

**Not verified:** complete npm install, Next.js production build and live browser E2E; genuine Meta ASR/Spark traffic and billing; commercial telecom; third-party call audio capture; identity verification; real card locking and police alerts.

## 6. Submission checklist

- [ ] Verify latest official Rules and submission form; do not infer a mandatory public repository for everyone from one team-specific organizer reply.
- [ ] Confirm the fresh work start dates, all authors, borrowed code and AI tooling provenance.
- [ ] Verify licenses of **specific installed versions** and any copied snippet/model weights/assets.
- [ ] Create a lockfile and SPDX/license report once the npm installation is available.
- [ ] Label mock vs live functionality on every demo screen/video.
- [ ] Begin demo with one clear line stating pre-existing dependencies and what SafeCall built during the event, as advised in the organizer's quoted response to another participant.
- [ ] Confirm the applicable **three-minute demo video** requirement from the current submission rules; the shared organizer answer refers to a three-minute video, but the complete submission requirements are not established here.
- [ ] Confirm GitHub publishing/privacy choice with the project owner BEFORE any remote action.

## 7. Suggested 1-line demo disclosure (English)

> "We built SafeCall Guardian's risk assessment, simulated call workflow, family-safety verification concept and mock safety actions during this hackathon, using credited open-source tools such as Next.js, React, Zod and WebSocket libraries. The telephony, banking, and emergency integrations shown in our demo are simulated, and Meta model results are labeled as live or mock accordingly."

**Important:** If family verification is not implemented by the submission date, remove it from the list of *built* features and call it proposed instead.

## v0.6.4 개발 기여 추가

같은 오픈소스 의존성을 유지하며 새로운 라이브러리를 도입하지 않았다. Node.js 내장 테스트 러너와 공식 TypeScript/Next.js 코드로 위험 근거 체크포인트, Spark 출력 보호, 세션별 예산 보호, 요청 본문 상한을 새로 작성했다. 상세 변경 범위: `docs/V064_RELEASE_NOTES.md`. 기존 프레임워크 코드를 팀이 새로 작성했다고 주장하지 않는다.


## v0.6.6 팀 신규 기여 (2026-10-29)

기존 OSS 의존성을 변경하거나 새로운 제3자 패키지를 설치하지 않았습니다. 공식 대응 교범은 **공개 출처를 확인한 뒤 프로젝트 내 짧은 독자적 요약 카드**로 작성했고 원문을 대량 복사하지 않았습니다. `src/modules/playbook/`, 증거의 문맥 태그, 안전한 코칭 연동, Node 테스트 및 평가 스크립트는 이번 버전의 프로젝트 구현 코드입니다. 공식 출처는 [`OFFICIAL_SOURCE_REGISTRY.md`](OFFICIAL_SOURCE_REGISTRY.md)를 참조하세요. 실제 메타 LIVE/실제 가족·은행 통합, 전체 Next.js 빌드 성공을 기여 성과로 표시하지 않습니다.
