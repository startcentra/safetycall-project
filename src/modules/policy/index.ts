/**
 * Server-side policy decisions. The DEMO policy is intentionally conservative:
 * every fictional transfer request is held, regardless of a model or heuristic score.
 * Real-bank approval/blocking is outside this project.
 */
export type PolicyDecision = "ALLOW" | "HOLD_FOR_REVIEW" | "REJECT";

export interface DemoTransferPolicyResult {
  decision: "HOLD_FOR_REVIEW";
  reasonCode: "DEMO_ALL_TRANSFERS_HELD";
}

export function decideDemoTransfer(): DemoTransferPolicyResult {
  return { decision: "HOLD_FOR_REVIEW", reasonCode: "DEMO_ALL_TRANSFERS_HELD" };
}
