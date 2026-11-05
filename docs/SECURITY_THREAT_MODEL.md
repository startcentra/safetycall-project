# SafeCall — Public Security and Privacy Summary

SafeCall is a **local-first hackathon prototype**. This overview describes the protection boundaries and important remaining risks. It is not a production security certification or a claim that all vulnerabilities have been eliminated.

## Assets and trust boundaries

- Server-side credentials for optional Meta API requests must remain outside the repository.
- Synthetic scenario data and authorized test media are not real customer phone recordings.
- Speech transcripts and model outputs are untrusted evidence; neither should be treated as verified caller identity.
- Mock banking, phone and smart-glasses interfaces must not be mistaken for real external integrations.

## Safeguards implemented in the prototype

- Local demo host restrictions and session/role tokens for demo actions.
- Request-size validation, limited accepted operations and simulated rather than real financial side effects.
- Consent and configuration gates before optional external model/audio requests.
- Bounded model request and cost-handling logic; estimates are not actual billing statements.
- An optional, user-managed encrypted recovery checklist; this is not full account or call recovery.

## Residual risks and restrictions

- The local access mechanisms do **not** replace a production user identity and authorization system.
- Transcript errors, model errors, false alarms and missed scams remain possible.
- A client disconnect or consent withdrawal cannot undo a request already processed by an external provider.
- Cost controls within one application cannot guarantee limits on external provider billing or use by other apps.
- Optional external maps and model services may receive network/device information under their own policies.
- Actual financial and telecom actions, distributed hosting, security monitoring, privacy review and end-to-end device validation are outside the verified prototype scope.

## Public source audit snapshot (November 2026)

Manual repository review and user-run scans did not identify a real committed Meta API key. A user-run Gitleaks scan reported **18 commits scanned, no leaks found**; npm audit reported **0 known vulnerabilities**; Secretlint identified **three synthetic BasicAuth test fixtures**. These results are bounded observations, not proof of zero risk. The historical commit count is not identical to the Gitleaks scan count.

## Responsible use

Use fictional or authorized test data only. Store credentials in private server-side secrets. Do not publish genuine calls, banking details, private logs, or participant data. Do not deploy this prototype as a public fraud-prevention or financial-control service without appropriate security, legal, licensing, privacy and effectiveness reviews.
