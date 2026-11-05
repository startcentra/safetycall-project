/** A fictional bank only: no bank SDK, network calls, money movement or real account IDs. */
import type { DemoTransferPolicyResult } from "../policy/index.ts";

export type MockTransferStatus = "NONE" | "HELD" | "CANCELLED";
export type MockAccountId = `DEMO-${string}`;

export interface MockBankSnapshot {
  transferStatus: MockTransferStatus;
  mockBalance: number;
}

/** The mock bank, not AI or client-side UI, applies the server policy decision. */
export function holdDemoTransfer(
  bank: MockBankSnapshot,
  amount: number,
  decision: DemoTransferPolicyResult,
): MockBankSnapshot {
  if (bank.transferStatus !== "NONE") throw new Error("이미 송금 요청이 처리되었습니다.");
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > bank.mockBalance) {
    throw new Error("유효하지 않은 가상 송금 금액입니다.");
  }
  if (decision.decision !== "HOLD_FOR_REVIEW") throw new Error("데모 거래 정책 위반");
  return { ...bank, transferStatus: "HELD" }; // Balance NEVER changes in the demo.
}

export function cancelDemoTransfer(bank: MockBankSnapshot): MockBankSnapshot {
  if (bank.transferStatus !== "HELD") throw new Error("보류된 송금 요청만 취소할 수 있습니다.");
  return { ...bank, transferStatus: "CANCELLED" };
}
