# SafeCall — AI-Assisted Scam Intervention

**Meta Global AI Developer Hackathon (2026) · Build for Your World**

SafeCall is a **hackathon prototype** to help users pause, question and independently verify suspicious phone or message scenarios before risky financial decisions.

## What to see in the demo

1. Two fictional English voice-phishing scenarios with synthetic audio and 20-turn replay.
2. Explainable local risk escalation based on scripted speech and behavior cues.
3. Optional server-side adapters for Meta Muse Voice Transcribe and Muse Spark, guarded by consent, configuration and budget policies.
4. Browser-based mock smart-glasses warnings, simulated location/bank proximity, fictional SafeBank actions and post-call recovery guidance.

**What is real versus simulated:** The reproducible 20-turn demonstration is a **scripted local/rules-based replay**, not a live Meta inference. Live Meta adapter code is included but this public repository does not independently substantiate successful API calls, live accuracy, or model latency. The product does **not** intercept real phone calls, track actual bank visits or block financial transfers.

## Run locally

**Requirements:** Node.js 22.4+ and npm. FFmpeg is optional for media-related workflows.

```bash
npm ci
npm run check:preflight
npm run verify:cursor
npm run demo:safety
```

Open **http://127.0.0.1:4173/** and choose **Enter Live Experience**. The offline replay does not require credentials or incur Meta API costs.

Optional Next.js interface: `npm run dev`.

## Meta API (optional research path)

Meta integration requires valid private server credentials, explicit authorization to send eligible test media, and cost approval. **Do not commit API keys**. Mock/contract tests do not establish that external inference succeeded. Review [Meta Integration](docs/META_INTEGRATION.md) and [Live Readiness](docs/META_LIVE_READINESS_CHECKLIST.md) before attempting a separately approved test.

## Public documentation

- [Architecture overview](docs/ARCHITECTURE.md)
- [Security and privacy overview](docs/SECURITY_THREAT_MODEL.md)
- [Open-source attribution and team contributions](docs/OPEN_SOURCE_AND_CONTRIBUTIONS.md)
- [Safety policy](docs/SAFETY_POLICY.md)
- [Verification and known limits](docs/RELEASE_SECURITY_AND_META_READINESS_KO.md)

Additional `docs/` files are development and historical reference material; some describe earlier versions or unverified proposals. They should not be read as current implementation guarantees. **All tracked content, including document history, is visible in a public repository.**

## Submission and licensing

Distinguish what the team built during the event from third-party frameworks, model services and generated assets. Consult the contribution and source notices linked above; media generation manifests include rights and redistribution cautions. Do not claim real victim recordings or actual telecom/banking integrations.

**SafeCall is not a certified fraud detector, emergency service or financial control product.** Confirm urgent claims independently using official channels.

## Built with

Node.js, Next.js, React, TypeScript, Tailwind CSS, Zod, ws, Vitest, Playwright, ESLint, Lucide and optional FFmpeg. Meta models are external proprietary services.

## Demo video

Add the finalized submission video link here before submitting.
