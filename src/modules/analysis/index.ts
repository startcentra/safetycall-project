/** One canonical scorer remains in risk-triage; this module only adapts optional model interpretation. */
export type { AnalysisProvider, AnalysisResult, RiskLevel } from "@/lib/contracts";
export type { MetaAnalysisInput, MetaAnalysisResponse, MetaAnalysisProvider, ModelAssessment } from "./meta-contract.ts";
export { LiveMetaProvider, MockMetaProvider, buildContext } from "./meta-provider.ts";
