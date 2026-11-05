# SafeCall — AI-Assisted Scam Intervention

**Meta Global AI Developer Hackathon (2026) · Build for Your World**

SafeCall is a proof-of-concept that helps people pause and verify potentially fraudulent conversations **before** taking risky financial actions. It connects a consent-gated Meta AI integration path to understandable alerts and a carefully labeled financial safety simulation.

## What the demo shows

1. Two **fictional English voice-phishing calls** (bank/prosecutor and delivery impersonation) played through synthetic TTS WAV files, each with a 20-turn timeline.
2. Explainable escalation of risk using local, deterministic pattern and context signals.
3. **Meta Muse Voice Transcribe and Muse Spark integration**: server-side API adapters for speech transcription and contextual analysis, with structured output handling, consent, authentication, and spending guardrails.
4. A **browser simulation of smart-glasses HUD** warnings, not a claim of actual Meta hardware connectivity.
5. Simulated GPS/bank proximity, followed by a **fictional SafeBank** transfer-hold demonstration—no actual banking transfers.
6. Post-call guidance, independently verifying claims, and safe recovery.

**Accurate demonstration disclosure:** The reproducible 20-turn replay is a **local scripted/rules-based simulation**, not a live Meta model inference. The code also contains separate consent-gated live Meta API paths. Meta API calls were performed during project development according to the project team; this public repository does **not** include private credentials or independent server-side logs proving the precise live API responses, latency, or accuracy. We do not claim a measured live-model detection rate.

## Run locally

**Requirements:** Node.js >=22.4 and npm. FFmpeg is optional for audio generation and specific live-media experiments.

```bash
npm ci
npm run check:preflight
npm run verify:cursor
npm run demo:safety
```

Open **http://127.0.0.1:4173/** and select **Enter Live Experience**. The guided demo can run without a Meta API key using **synthetic audio and local simulation**.

Optional app shell: `npm run dev` (Next.js).

### Optional Meta API live mode

Meta Model API access and valid project credentials are required for real Meta inference. **Never commit real keys.** Review `docs/META_INTEGRATION.md`, `docs/META_LIVE_READINESS_CHECKLIST.md`, and `docs/CURSOR_VERIFY_BOTH_MODES_KO.md`. Copy the example configuration to your **local-only** environment; supply credentials only through the server's private environment. Live invocation is opt-in and subject to consent and spending limits.

The local mock/contract tests are **not** evidence of successful live authentication or model output.

## Repository & submission scope

This is a **clean submission snapshot**, not a rewrite of the history of development. Work was developed during the hackathon in an **access-restricted development repository**. This public snapshot intentionally omits historical backups, recordings, personal data, credentials, and unrelated artifacts. Keeping a private development history is not intended to imply that this public repository has a full commit-by-commit timeline.

For architecture, evaluation scope, open-source credits, and safety boundaries, see:
- `docs/ARCHITECTURE.md`
- `docs/OPEN_SOURCE_AND_CONTRIBUTIONS.md`
- `docs/RELEASE_SECURITY_AND_META_READINESS_KO.md`
- `docs/SAFETY_POLICY.md`
- `docs/META_INTEGRATION.md`

## Safety and limitations

SafeCall is a hackathon **prototype**. It is not a certified fraud detector, emergency service, device-level phone-call interceptor, physical smart-glasses integration, live GPS/bank arrival verification, or real bank payment blocker. A suspected scam is not proof of criminal activity. Always verify financial or legal requests independently through official channels.

All audio included in the demonstration is synthetic; do not use actual personal call recordings without permission.

## Built with

Node.js, Next.js, React, TypeScript, Tailwind CSS, Zod, ws, Vitest, Playwright, ESLint, Lucide icons, and optional FFmpeg. See `docs/OPEN_SOURCE_AND_CONTRIBUTIONS.md` for component roles and license notes. Meta Muse models are proprietary API services, **not** open-source dependencies.

## Demo video

3-minute video: **add public or unlisted YouTube link before submission**.
