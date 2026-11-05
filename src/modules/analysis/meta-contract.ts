/** Meta is an interpretation provider, not another risk/policy engine. */
import type { ActionEvent, TriageTurn, TriageResult } from "../risk-triage/index.ts";

export const SIGNAL_CODES = ["MONEY_REQUEST","CREDENTIAL_REQUEST","REMOTE_CONTROL","SECRECY","URGENCY","AUTHORITY_CLAIM","REALITY_UNDERMINING","DIRECT_THREAT","POST_TRANSFER"] as const;
export const MANIPULATION_CODES = ["AUTHORITY_PRESSURE","URGENCY_PRESSURE","FEAR_INDUCTION","SOCIAL_ISOLATION","SECRECY_DEMAND","REALITY_UNDERMINING","REPEATED_COERCION","FINANCIAL_MANIPULATION"] as const;
export const ACTION_CODES = ["VERIFY_OFFICIAL_CHANNEL","DO_NOT_TRANSFER","DO_NOT_SHARE_OTP","DO_NOT_INSTALL_APP","CONTACT_112","CONTACT_BANK_AND_112","SEEK_INDEPENDENT_HELP","NO_IMMEDIATE_ACTION"] as const;
export type SignalCode = typeof SIGNAL_CODES[number];
export type ManipulationCode = typeof MANIPULATION_CODES[number];
export type ActionCode = typeof ACTION_CODES[number];
export type MetaMode = "MOCK" | "LIVE";
export interface InputTurn extends TriageTurn { turnId: string; }
export interface MetaAnalysisInput { turns: InputTurn[]; actionEvent?: ActionEvent; locationObservation?: {source:'SIMULATED_GPS';zone:'AWAY'|'NEAR_BANK'|'AT_BANK';distanceBand:'FAR'|'NEAR'|'ARRIVED'}; }
export interface ModelAssessment {
  riskLevel: "LOW" | "CAUTION" | "HIGH" | "UNKNOWN";
  riskIndex: number;
  manipulationIndex: number;
  detectedSignals: SignalCode[];
  manipulationTechniques: ManipulationCode[];
  requestedActions: string[];
  evidenceUtteranceIds: string[];
  normalConversationEvidence: string[];
  uncertainty: string;
  recommendedActionCodes: ActionCode[];
  emergencyFlag: boolean;
}
export interface ModelUsage { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; }
export interface MetaAnalysisResponse {
  analysisMode: MetaMode;
  model: string;
  analysis: ModelAssessment;
  usage: ModelUsage;
  elapsedMs: number;
  callId: string | null;
  disclaimer: string;
}
export interface ProviderContext { input: MetaAnalysisInput; triage: TriageResult; }
export interface MetaAnalysisProvider { readonly mode: MetaMode; analyze(context: ProviderContext): Promise<MetaAnalysisResponse>; }

/** Strict schema for server-side output. Never trust prompt-only JSON compliance. */
export const MODEL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    riskLevel: { type: "string", enum: ["LOW","CAUTION","HIGH","UNKNOWN"] },
    riskIndex: { type: "integer", minimum: 0, maximum: 100 },
    manipulationIndex: { type: "integer", minimum: 0, maximum: 100 },
    detectedSignals: { type: "array", items: { type: "string", enum: [...SIGNAL_CODES] } },
    manipulationTechniques: { type: "array", items: { type: "string", enum: [...MANIPULATION_CODES] } },
    requestedActions: { type: "array", items: { type: "string" } },
    evidenceUtteranceIds: { type: "array", items: { type: "string" } },
    normalConversationEvidence: { type: "array", items: { type: "string" } },
    uncertainty: { type: "string" },
    recommendedActionCodes: { type: "array", items: { type: "string", enum: [...ACTION_CODES] } },
    emergencyFlag: { type: "boolean" },
  },
  required: ["riskLevel","riskIndex","manipulationIndex","detectedSignals","manipulationTechniques","requestedActions","evidenceUtteranceIds","normalConversationEvidence","uncertainty","recommendedActionCodes","emergencyFlag"],
} as const;
