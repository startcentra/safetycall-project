import type { ReplayScenario } from "../evaluation/index.ts";
import type { MetaAnalysisInput } from "./meta-contract.ts";
/** Only prefixes and (turnId,speaker,text) cross the wire; never source, future text or groundTruth. */
export function buildReplayMetaInput(scenario: Pick<ReplayScenario,"turns">, step: number): MetaAnalysisInput {
  if (!Number.isSafeInteger(step) || step < 1 || step > scenario.turns.length) throw new Error("Invalid replay step");
  return { turns: scenario.turns.slice(0,step).slice(-8).map(({turnId,speaker,text})=>({turnId,speaker,text})),actionEvent:"NONE" };
}
