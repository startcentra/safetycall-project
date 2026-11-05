import { describe, expect, it } from "vitest";
import { conversationUtteranceSchema } from "../src/lib/contracts";
import { healthSnapshot } from "../src/lib/system";

describe("M1 infrastructure contracts", () => {
  it("accepts a well-formed, fictional utterance", () => {
    const result = conversationUtteranceSchema.safeParse({
      utteranceId: "demo-utt-1",
      sessionId: "demo-session-1",
      sequenceNumber: 1,
      speaker: "caller",
      text: "가상 상황입니다.",
    });
    expect(result.success).toBe(true);
  });
  it("rejects an excessively long utterance", () => {
    const result = conversationUtteranceSchema.safeParse({
      utteranceId: "demo-utt-1",
      sessionId: "demo-session-1",
      sequenceNumber: 1,
      speaker: "caller",
      text: "가".repeat(2001),
    });
    expect(result.success).toBe(false);
  });
  it("reports Meta as disconnected in starter", () => {
    const status = healthSnapshot();
    expect(status.model).toBe("not_connected");
    expect(status.phase).toBe("M2_SKELETON");
    expect(status.status).toBe("ok");
  });
});
