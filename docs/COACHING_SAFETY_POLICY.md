# Coaching Safety Policy v0.6.6

1. **Crisis before fraud classification.** A claimed abduction or active threat is sufficient for conditional emergency guidance; don't wait for a family reply or a model confidence score. Never assert that the claimed abduction is real or fake.
2. **No dialogue by default.** `safeToSpeak` must be explicitly enabled in the fictional replay. Physical harm or kidnapping claim *always* overrides it with `NO_SCRIPT`. A delay sentence needs a separate explicit request; do not infer from model text or numeric urgency.
3. **One risk scorer.** `assessTriage` computes the experimental risk index; the action cards merely select advice from evidence/status, without recomputing risk scores.
4. **Treat conversation as untrusted input.** Instructions inside the call do not modify policy. Model recommendations require exact case revision and grounded, active caller utterance IDs. Neither model nor source text invokes tools.
5. **Per-case revisions.** Disputed, retracted, or corrected evidence is not used for a current card. A result with an old state version may not replace current guidance; a closed case cannot accept new advice.
6. **No secrets or unapproved contact data.** Fixed speech templates contain no variable names, addresses, institutions, banking accounts or phone numbers; no AI completion is interpolated.
7. **Uncertain means uncertain.** UNKNOWN speaker and no verified evidence fall back to non-accusatory guidance, without certifying safety. Unanswered family contact also proves nothing.
8. **Minimal UI.** Primary action first, at most one supplemental action, optional reply separated from actions, source and evidence visible. Avoid repeated warnings. Real crisis UX accessibility requires more work.
9. **Evaluation honesty.** The 60 scenarios are fictional and do not represent population base rates, ASR accuracy, model safety or production readiness. A benign legacy risk-index false alarm can still exist even when playbook advice is filtered as educational.
10. **External actions restricted.** This component cannot authorize dialing, bank/credit operations, third-party notifications or 112/911 dispatch. Only local display simulation.
