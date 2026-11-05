/**
 * Offline benchmark harness. The ONLY product risk analyser is assessTriage().
 * keywordBaseline is an isolated comparison baseline, never used to coach/block.
 * Synthetic reference labels are never passed to the model/triage input.
 */
import { assessTriage, type TriageResult, type TriageTurn } from "../risk-triage/index.ts";
import scenarioData from "../../data/scenarios/cases.json" with { type: "json" };
import sourceData from "../../data/scenarios/sources.json" with { type: "json" };

export type ScenarioCategory = "NORMAL" | "TRADITIONAL" | "EVOLVED" | "AMBIGUOUS";
export type ScenarioLabel = "NORMAL" | "SCAM" | "AMBIGUOUS";
export interface ReplayTurn extends TriageTurn { turnId: string; expectedSignals: string[]; }
export interface GroundTruth {
  scenarioLabel: ScenarioLabel;
  expectedSignals: string[];
  expectedActionCodes: string[];
  expectedCriticalTurn: number | null;
  emergencyFlag: boolean;
}
export interface ReplayScenario {
  scenarioId: string;
  title: string;
  category: ScenarioCategory;
  sourceIds: string[];
  synthetic: true;
  sourceClassification: "PUBLIC_ADVISORY_INSPIRED" | "ORIGINAL_CONTROL_SCENARIO";
  turns: ReplayTurn[];
  groundTruth: GroundTruth;
  reviewerNotes: string;
}
export interface ResearchSource {
  sourceId: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  url: string;
  sourceType: string;
  caseType: string;
  verifiedAt: string;
  usageNote: string;
}
// JSON files are checked by validateDataset() / replay.test.ts before being trusted.
export const scenarios = scenarioData as unknown as ReplayScenario[];
export const researchSources = sourceData as unknown as ResearchSource[];
export interface ReplayStep {
  turnNumber: number;
  assessment: TriageResult;
  candidateMetaCall: boolean;
  warning: boolean;
  keywordsOnlyWarning: boolean;
}
/** Deliberately simplistic static comparator. NEVER used for safety decisions. */
export function keywordBaseline(turns: readonly TriageTurn[]): boolean {
  return turns.some(t => t.speaker === "caller" && /송금|이체|입금|인증\s?번호|OTP|원격|검찰|수사관|가족|납치|비밀|돈|계좌|비밀번호/.test(t.text));
}
/** Replay strictly uses prefixes; labels and future turns never flow into assessTriage. */
export function replayScenario(scenario: ReplayScenario): ReplayStep[] {
  return scenario.turns.map((_, index) => {
    const previousTurns: TriageTurn[] = scenario.turns.slice(0, index + 1).map(t => ({ speaker: t.speaker, text: t.text }));
    const assessment = assessTriage({ turns: previousTurns });
    return {
      turnNumber: index + 1,
      assessment,
      candidateMetaCall: assessment.shouldCallMeta,
      warning: assessment.riskBand !== "LOW" || assessment.emergencyFlag,
      keywordsOnlyWarning: keywordBaseline(previousTurns),
    };
  });
}
export interface ConfusionMatrix { TP: number; FP: number; TN: number; FN: number; }
export interface RateMetrics {
  matrix: ConfusionMatrix;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
}
export function confusionMetrics(matrix: ConfusionMatrix): RateMetrics {
  const ratio = (num: number, den: number) => den ? num / den : null;
  const precision = ratio(matrix.TP, matrix.TP + matrix.FP);
  const recall = ratio(matrix.TP, matrix.TP + matrix.FN);
  const f1 = precision !== null && recall !== null && precision + recall ? 2 * precision * recall / (precision + recall) : null;
  return {
    matrix, precision, recall, f1,
    falsePositiveRate: ratio(matrix.FP, matrix.FP + matrix.TN),
    falseNegativeRate: ratio(matrix.FN, matrix.FN + matrix.TP),
  };
}
export interface CaseEval {
  id: string;
  title: string;
  category: ScenarioCategory;
  label: ScenarioLabel;
  baselineWarning: boolean;
  warning: boolean;
  metaCallCandidate: boolean;
  firstWarningTurn: number | null;
  firstTriggerTurn: number | null;
  criticalTurn: number | null;
  warnedBeforeCriticalTurn: boolean | null;
  warnedByCriticalTurn: boolean | null;
  lastRiskIndex: number;
  lastPressureIndex: number;
}
export interface DatasetReport {
  sampleSize: number;
  binaryEvaluated: number;
  ambiguousExcluded: number;
  baseline: RateMetrics;
  canonical: RateMetrics;
  triggerRecall: number | null;
  triggerCount: number;
  warningBeforeCriticalCount: number;
  warningByCriticalCount: number;
  criticalScenarioCount: number;
  perCategory: { category: ScenarioCategory; count: number; warned: number; triggered: number }[];
  cases: CaseEval[];
  limitations: string[];
}
export function evaluateDataset(input: readonly ReplayScenario[] = scenarios): DatasetReport {
  const rows: CaseEval[] = input.map(s => {
    const steps = replayScenario(s);
    const firstWarning = steps.find(x => x.warning);
    const firstTrigger = steps.find(x => x.candidateMetaCall);
    const critical = s.groundTruth.expectedCriticalTurn;
    return {
      id: s.scenarioId, title: s.title, category: s.category,
      label: s.groundTruth.scenarioLabel,
      baselineWarning: steps.at(-1)?.keywordsOnlyWarning ?? false,
      warning: !!firstWarning,
      metaCallCandidate: !!firstTrigger,
      firstWarningTurn: firstWarning?.turnNumber ?? null,
      firstTriggerTurn: firstTrigger?.turnNumber ?? null,
      criticalTurn: critical,
      warnedBeforeCriticalTurn: critical == null ? null : firstWarning != null && firstWarning.turnNumber < critical,
      warnedByCriticalTurn: critical == null ? null : firstWarning != null && firstWarning.turnNumber <= critical,
      lastRiskIndex: steps.at(-1)?.assessment.riskIndex ?? 0,
      lastPressureIndex: steps.at(-1)?.assessment.psychologicalPressureIndex ?? 0,
    };
  });
  const matrix = (key: "warning" | "baselineWarning"): ConfusionMatrix => {
    const m: ConfusionMatrix = { TP: 0, FP: 0, TN: 0, FN: 0 };
    for (const r of rows) {
      if (r.label === "AMBIGUOUS") continue;
      const expected = r.label === "SCAM";
      if (expected && r[key]) m.TP++;
      else if (expected) m.FN++;
      else if (r[key]) m.FP++;
      else m.TN++;
    }
    return m;
  };
  const positives = rows.filter(r => r.label === "SCAM");
  const critical = rows.filter(r => r.criticalTurn != null);
  return {
    sampleSize: rows.length,
    binaryEvaluated: rows.filter(r => r.label !== "AMBIGUOUS").length,
    ambiguousExcluded: rows.filter(r => r.label === "AMBIGUOUS").length,
    baseline: confusionMetrics(matrix("baselineWarning")),
    canonical: confusionMetrics(matrix("warning")),
    triggerRecall: positives.length ? positives.filter(r => r.metaCallCandidate).length / positives.length : null,
    triggerCount: rows.filter(r => r.metaCallCandidate).length,
    warningBeforeCriticalCount: critical.filter(r => r.warnedBeforeCriticalTurn).length,
    warningByCriticalCount: critical.filter(r => r.warnedByCriticalTurn).length,
    criticalScenarioCount: critical.length,
    perCategory: (["NORMAL", "TRADITIONAL", "EVOLVED", "AMBIGUOUS"] as ScenarioCategory[]).map(category => {
      const subset = rows.filter(r => r.category === category);
      return { category, count: subset.length, warned: subset.filter(r => r.warning).length, triggered: subset.filter(r => r.metaCallCandidate).length };
    }),
    cases: rows,
    limitations: [
      "60개 자체 창작 가상 대화에만 적용되는 내부 실험치이며 실제 보이스피싱 탐지 정확도가 아닙니다.",
      "단순 키워드 비교기는 평가 전용이며 제품 코칭/거래 정책에 사용되지 않습니다.",
      "AMBIGUOUS 15개 사례는 객관적 이진 진실값이 없어 Precision/Recall에서 제외하고 별도 보고합니다.",
      "위험 지수는 미보정된 임의 규칙 점수이며 사기 확률이 아닙니다.",
      "외부 Meta AI 호출, 음성 인식, 실제 전화·금융거래 연결을 수행하지 않았습니다.",
    ],
  };
}

/** Strict offline schema validation including anonymization sanity checks. */
export function validateDataset(input: readonly ReplayScenario[] = scenarios, sources: readonly ResearchSource[] = researchSources): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const sourceIds = new Set(sources.map(s => s.sourceId));
  for (const s of input) {
    if (ids.has(s.scenarioId)) errors.push(`Duplicate ${s.scenarioId}`);
    ids.add(s.scenarioId);
    if (!s.synthetic || s.turns.length < 3 || s.turns.length > 8) errors.push(`Invalid scenario ${s.scenarioId}`);
    if (s.category === "NORMAL" && s.groundTruth.scenarioLabel !== "NORMAL") errors.push(`Label mismatch ${s.scenarioId}`);
    if ((s.category === "TRADITIONAL" || s.category === "EVOLVED") && s.groundTruth.scenarioLabel !== "SCAM") errors.push(`Label mismatch ${s.scenarioId}`);
    if (s.category === "AMBIGUOUS" && s.groundTruth.scenarioLabel !== "AMBIGUOUS") errors.push(`Label mismatch ${s.scenarioId}`);
    if (s.groundTruth.expectedCriticalTurn !== null && (s.groundTruth.expectedCriticalTurn < 1 || s.groundTruth.expectedCriticalTurn > s.turns.length)) errors.push(`Invalid critical turn ${s.scenarioId}`);
    for (const ref of s.sourceIds) if (!sourceIds.has(ref)) errors.push(`Unknown source ${ref}`);
    if (s.sourceClassification === "PUBLIC_ADVISORY_INSPIRED" && !s.sourceIds.length) errors.push(`Missing source ${s.scenarioId}`);
    for (const [idx, turn] of s.turns.entries()) {
      if (turn.turnId !== `T${idx + 1}` || !["caller", "user"].includes(turn.speaker)) errors.push(`Invalid turn ${s.scenarioId}`);
      if (!turn.text.trim() || turn.text.length > 800) errors.push(`Invalid text ${s.scenarioId}`);
      if (/https?:\/\/|(?:\d{2,4}-){2,}\d{3,4}|(?:\d{8,})/.test(turn.text)) errors.push(`Potential PII/link ${s.scenarioId}`);
    }
  }
  return errors;
}
