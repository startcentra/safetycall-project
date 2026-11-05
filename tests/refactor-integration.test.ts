import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTriage, SIGNAL_LABELS } from "../src/modules/risk-triage/index.ts";
import { applySimulationAction, DEMO_LINES, startSimulation } from "../src/modules/simulation/engine.ts";
import { decideDemoTransfer } from "../src/modules/policy/index.ts";
import { selectDemoCoaching } from "../src/modules/coaching/index.ts";

const at = "2026-10-27T00:00:00.000Z";

test("/lab과 /simulator가 같은 위험 신호와 인덱스를 사용한다", () => {
  let simulation = startSimulation("single-engine-test", at);
  for (let i = 0; i < DEMO_LINES.length; i++) {
    simulation = applySimulationAction(simulation, "NEXT_LINE", at);
    const assessment = assessTriage({ turns: DEMO_LINES.slice(0, i + 1).map(text => ({ speaker: "caller", text })) });
    assert.deepEqual(simulation.assessment, assessment);
    assert.deepEqual(simulation.signals, assessment.signals.map(x => SIGNAL_LABELS[x.code]));
  }
  assert.equal(simulation.risk, "high");
});

test("가상 송금 행동만으로도 분석기가 재평가하고 은행 정책은 독립 집행", () => {
  let simulation = startSimulation("transfer-test", at);
  simulation = applySimulationAction(simulation, "NEXT_LINE", at);
  simulation = applySimulationAction(simulation, "REQUEST_TRANSFER", at);
  assert.equal(simulation.assessment?.shouldCallMeta, true);
  assert.ok(simulation.assessment?.signals.some(x => x.evidence.includes("가상 송금 준비")));
  assert.equal(decideDemoTransfer().reasonCode, "DEMO_ALL_TRANSFERS_HELD");
  assert.equal(simulation.transferStatus, "HELD");
  assert.equal(simulation.mockBalance, 1_000_000);
  assert.match(simulation.coaching, /보류/);
  simulation = applySimulationAction(simulation, "CANCEL_TRANSFER", at);
  assert.equal(simulation.transferStatus, "CANCELLED");
  assert.equal(simulation.mockBalance, 1_000_000);
});

test("긴급 코칭은 거래 코칭보다 우선", () => {
  const assessment = assessTriage({turns:[{speaker:"caller",text:"당신 가족을 해칠 겁니다."}]});
  assert.equal(assessment.emergencyFlag,true);
  const coaching = selectDemoCoaching({assessment,transferStatus:"HELD",claimStatus:"UNVERIFIED",ended:false});
  assert.match(coaching,/112/);
});

test("위험도와 관계 없이 데모 거래는 항상 보류되며 확률로 주장하지 않는다", () => {
  assert.equal(decideDemoTransfer().decision, "HOLD_FOR_REVIEW");
  const assessment = assessTriage({turns:[{speaker:"caller",text:"저녁 먹을래?"}]});
  assert.equal(assessment.riskIndex,0);
  assert.equal(assessment.shouldCallMeta,false);
  assert.ok(assessment.limitations.some(x=>x.includes("사기 확률이 아닙니다")));
});
