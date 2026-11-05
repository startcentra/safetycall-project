import type { TriageResult } from "../risk-triage/index.ts";
import type { MockTransferStatus } from "../mock-banking/index.ts";

export type CoachingPriority = "informational" | "important" | "emergency";
export type ClaimStatus = "UNVERIFIED" | "MOCK_CONTRADICTED";

/**
 * A single, deterministic DEMO coaching selector.
 * It is NOT reviewed clinical/legal advice; production coaching needs a sourced rule set.
 */
export function selectDemoCoaching(input: {
  assessment: TriageResult | null;
  transferStatus: MockTransferStatus;
  claimStatus: ClaimStatus;
  ended: boolean;
}): string {
  if (input.ended) return "훈련이 종료되었습니다. 실제 긴급 상황이라면 AI 판단을 기다리지 말고 112에 연락하세요.";
  // Credible immediate threats always take precedence over ordinary financial coaching.
  if (input.assessment?.emergencyFlag) return "폭력·납치 등 즉각적인 위해 가능성이 있다면 AI 결과를 기다리지 말고 112에 신고하세요.";
  if (input.transferStatus === "CANCELLED") return "가상 송금이 취소되었습니다. 실제 피해가 의심되면 112와 금융회사에 연락하세요.";
  if (input.claimStatus === "MOCK_CONTRADICTED") return "모의 은행 조회에서는 이체 요청이 확인되지 않았습니다. 이것은 가상의 검증 결과이며 실제 신원 확인이 아닙니다.";
  if (input.transferStatus === "HELD") return "가상 송금이 보류되었습니다. 돈은 이동하지 않았습니다. 거래를 취소하고 공식 경로로 확인하세요.";
  if (input.assessment?.riskBand === "HIGH") return "송금이나 개인정보 제공을 멈추고, 상대가 준 번호가 아닌 공식 경로로 직접 확인하세요.";
  if (input.assessment?.riskBand === "CAUTION") return "긴급한 결정을 요구하더라도 바로 행동하지 마세요. 공식 경로를 통해 확인하세요.";
  return "이것은 가상 훈련입니다. 상대방의 소속은 아직 확인되지 않았습니다.";
}
