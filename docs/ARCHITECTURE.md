# SafeCall — Public Architecture Overview

SafeCall is a **hackathon research prototype**, not a production fraud detection service. This document describes the demonstrable architecture without operational runbooks or historical implementation notes.

## System flow

```text
Synthetic scripted conversation / authorized test audio
  -> transcript or local replay events
  -> deterministic risk triage and evidence tracking
  -> optional consent-gated Meta API analysis
  -> validated guidance and safety policy
  -> browser dashboard, simulated glasses display, and mock banking actions
```

## Main components

| Component | Responsibility |
| --- | --- |
| `demo/safety-challenge/` | Local-only demo server, synthetic media replay, session and UI orchestration |
| `src/modules/risk-triage/` | Deterministic signals and an explainable prototype risk index |
| `src/modules/analysis/` | Optional Meta API adapter, bounded structured output, and response validation |
| `src/modules/case/`, `src/modules/policy/` | Event coordination and protective guidance decisions |
| `src/modules/message-safety/` | Synthetic message and suspicious-link assessment |
| `src/modules/mock-banking/` | Fictional payment/card state; never connects to a bank |
| `src/modules/postcall-capsule/` | Optional user-managed encrypted mock recovery checklist |
| `src/components/` | Next.js demo and map-related UI |

## Demo modes and claims

- **Offline replay:** Synthetic TTS WAVs and scripted text drive deterministic risk logic. This is *not* a live Meta model inference or real call interception.
- **Optional Meta integration:** Server-side speech/model adapters exist, but actual live success, costs, latency and accuracy require separate credentialed verification. No private API credentials are distributed.
- **Mock interventions:** Bank visits, card locks, family verification and glasses/HUD experiences are demonstrations; they do not perform financial actions or authenticate real people.
- **Risk scores:** Experimental signals, **not** a calibrated probability of fraud or a finding that a crime occurred.

## How to review

See [README](../README.md) to run the local demo, [Open Source and Contributions](OPEN_SOURCE_AND_CONTRIBUTIONS.md) for attribution, and [Safety Policy](SAFETY_POLICY.md) for scope. Automated tests and benchmark fixtures are in `tests/` and `data/`; their presence alone does not establish real-world effectiveness.

## Limitations

The repository is a demonstration, not a hardened multi-user service. Do not expose its local demo server directly to the internet, process real personal calls without authorization, or connect mock actions to real bank accounts. The user must independently verify urgent requests with trusted official channels.
