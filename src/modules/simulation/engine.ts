/**
 * ONE simulation orchestrator/state machine, NOT another risk-detection engine.
 * Uses risk-triage for all text/event risk assessments, policy for decisions,
 * mock-banking for demo transaction state, and coaching for demo instructions.
 * No Meta API, real phone, real bank, or emergency service is contacted.
 */
import { assessTriage, SIGNAL_LABELS, type TriageResult } from "../risk-triage/index.ts";
import { decideDemoTransfer } from "../policy/index.ts";
import { cancelDemoTransfer, holdDemoTransfer, type MockTransferStatus } from "../mock-banking/index.ts";
import { selectDemoCoaching, type ClaimStatus } from "../coaching/index.ts";

export type RiskLevel = "unknown" | "medium" | "high";
export type TransferStatus = MockTransferStatus;
export type SimulationAction = "NEXT_LINE" | "REQUEST_TRANSFER" | "CANCEL_TRANSFER" | "VERIFY_CLAIM" | "END_CASE";
export type SimulationEvent = { at: string; type: string; detail: string };

export interface SimulationState {
  id: string;
  mode: "demo";
  source: "scripted_rules_not_ai";
  scenario: "fictional_bank_impersonation";
  utteranceIndex: number;
  transcript: string[];
  risk: RiskLevel;
  signals: string[];
  /** Same canonical risk-triage output used by /lab and future replay experiments. */
  assessment: TriageResult | null;
  claimStatus: ClaimStatus;
  coaching: string;
  replySuggestion: string;
  transferStatus: TransferStatus;
  mockBalance: number;
  mockTransferAmount: number;
  ended: boolean;
  timeline: SimulationEvent[];
}

export const DEMO_LINES = [
  "안녕하세요. 가상의 OO은행 보안팀 직원이라고 주장하는 발신자입니다.",
  "고객님의 계좌가 위험해졌습니다. 지금 당장 조치해야 합니다.",
  "가상의 안전 계좌로 80만 원을 이체하세요. 다른 사람에게는 알리지 마세요.",
] as const;

function withEvent(state: SimulationState, at: string, type: string, detail: string): SimulationState {
  return { ...state, timeline: [...state.timeline, { at, type, detail }] };
}

function syncDemoCoaching(state: SimulationState): SimulationState {
  return {
    ...state,
    coaching: selectDemoCoaching({
      assessment: state.assessment, transferStatus: state.transferStatus,
      claimStatus: state.claimStatus, ended: state.ended,
    }),
  };
}

/** One mapping from canonical triage bands to legacy UI labels; no second scoring algorithm. */
function toSimulatorRisk(result: TriageResult): RiskLevel {
  return result.riskBand === "HIGH" ? "high" : result.riskBand === "CAUTION" ? "medium" : "unknown";
}

export function startSimulation(id: string, at: string): SimulationState {
  if (!id || id.length > 100) throw new Error("유효하지 않은 시뮬레이션 ID");
  if (!Number.isFinite(Date.parse(at))) throw new Error("유효하지 않은 이벤트 시간");
  return syncDemoCoaching({
    id, mode: "demo", source: "scripted_rules_not_ai", scenario: "fictional_bank_impersonation",
    utteranceIndex: 0, transcript: [], risk: "unknown", signals: [], assessment: null,
    claimStatus: "UNVERIFIED", coaching: "", replySuggestion: "공식 연락처로 다시 확인하겠습니다.",
    transferStatus: "NONE", mockBalance: 1_000_000, mockTransferAmount: 800_000,
    ended: false, timeline: [{ at, type: "SIMULATION_STARTED", detail: "가상 은행 사칭 시나리오가 시작되었습니다." }],
  });
}

/** Explicit server-controlled state transitions; no model or UI output executes bank actions. */
export function applySimulationAction(state: SimulationState, action: SimulationAction, at: string): SimulationState {
  if (state.ended) throw new Error("종료된 시뮬레이션입니다.");
  if (!Number.isFinite(Date.parse(at))) throw new Error("유효하지 않은 이벤트 시간");

  switch (action) {
    case "NEXT_LINE": {
      if (state.utteranceIndex >= DEMO_LINES.length) throw new Error("더 이상 재생할 발화가 없습니다.");
      const line = DEMO_LINES[state.utteranceIndex];
      const transcript = [...state.transcript, line];
      // All demo utterances currently belong to the fictional caller.
      const assessment = assessTriage({ turns: transcript.map(text => ({ speaker: "caller", text })) });
      const next = withEvent(syncDemoCoaching({
        ...state, utteranceIndex: transcript.length, transcript, assessment,
        risk: toSimulatorRisk(assessment), signals: assessment.signals.map(signal => SIGNAL_LABELS[signal.code]),
      }), at, "UTTERANCE_RECEIVED", line);
      return withEvent(next, at, "OFFLINE_TRIAGE_UPDATED",
        `동일 위험 분석 모듈: ${assessment.riskBand}, Meta 호출 후보: ${assessment.shouldCallMeta ? "예" : "아니오"} (실제 호출 없음)`);
    }
    case "REQUEST_TRANSFER": {
      if (state.utteranceIndex === 0) throw new Error("먼저 모의 통화를 진행하세요.");
      // A transfer event triggers triage EVEN WITHOUT suspicious words.
      const assessment = assessTriage({
        turns: state.transcript.map(text => ({ speaker: "caller", text })),
        actionEvent: "TRANSFER_PREPARED",
      });
      const decision = decideDemoTransfer();
      const bank = holdDemoTransfer(state, state.mockTransferAmount, decision);
      return withEvent(syncDemoCoaching({
        ...state, ...bank, assessment,
        risk: toSimulatorRisk(assessment), signals: assessment.signals.map(signal => SIGNAL_LABELS[signal.code]),
      }), at, "MOCK_TRANSFER_HELD", `데모 정책 ${decision.reasonCode}: 가상 송금 보류, 잔액 변동 없음`);
    }
    case "CANCEL_TRANSFER": {
      const bank = cancelDemoTransfer(state);
      return withEvent(syncDemoCoaching({ ...state, ...bank }),
        at, "MOCK_TRANSFER_CANCELLED", "가상 송금 요청 취소. 잔액 변동 없음.");
    }
    case "VERIFY_CLAIM": {
      return withEvent(syncDemoCoaching({ ...state, claimStatus: "MOCK_CONTRADICTED" }),
        at, "MOCK_CLAIM_CHECKED", "가상 은행의 미리 정의된 조회 결과: 송금 지시 이력 없음.");
    }
    case "END_CASE": {
      return withEvent(syncDemoCoaching({ ...state, ended: true }),
        at, "SIMULATION_ENDED", "가상 훈련 종료");
    }
  }
}
