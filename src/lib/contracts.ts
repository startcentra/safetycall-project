import { z } from "zod";

// Meta provider contracts only. Current M2 scripted demo is not a scam-detection AI.
export const riskLevelSchema = z.enum(["low", "medium", "high", "unknown"]);
export const conversationUtteranceSchema = z.object({
  utteranceId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(100),
  sequenceNumber: z.number().int().nonnegative(),
  speaker: z.enum(["caller", "user", "unknown"]),
  text: z.string().trim().min(1).max(2000),
});

export const analysisResultSchema = z.object({
  riskLevel: riskLevelSchema,
  detectedSignals: z.array(z.string()),
  callerClaims: z.array(z.object({ claim: z.string(), status: z.literal("unverified") })),
  verifiedFacts: z.array(z.object({ fact: z.string(), sourceId: z.string() })),
  recommendedActionCodes: z.array(z.string()),
  evidenceSourceIds: z.array(z.string()),
  emergencyFlag: z.boolean(),
  analysisMode: z.enum(["demo", "live"]),
  timestamp: z.string().datetime(),
});

export type ConversationUtterance = z.infer<typeof conversationUtteranceSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export interface AnalysisProvider {
  readonly mode: "demo" | "live";
  analyze(utterances: ConversationUtterance[]): Promise<AnalysisResult>;
}
