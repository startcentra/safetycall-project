import { test } from "node:test";
import assert from "node:assert/strict";
import { applySimulationAction, startSimulation } from "../src/modules/simulation/engine.ts";

const at = "2026-10-27T00:00:00.000Z";

test("새 시뮬레이션은 DEMO 전용이며 실제 돈을 움직이지 않는다", () => {
  const s = startSimulation("test-demo", at);
  assert.equal(s.mode, "demo");
  assert.equal(s.source, "scripted_rules_not_ai");
  assert.equal(s.mockBalance, 1_000_000);
  assert.equal(s.transferStatus, "NONE");
});

test("위험 발화가 진행되면 데모 규칙이 코칭을 갱신한다", () => {
  let s = startSimulation("test-demo", at);
  s = applySimulationAction(s, "NEXT_LINE", at);
  s = applySimulationAction(s, "NEXT_LINE", at);
  s = applySimulationAction(s, "NEXT_LINE", at);
  assert.equal(s.risk, "high");
  assert.ok(s.signals.includes("송금 요구"));
  assert.match(s.coaching, /송금/);
  assert.equal(s.transcript.length, 3);
});

test("가상 송금은 보류되고 잔액은 그대로이며 취소된다", () => {
  let s = startSimulation("test-demo", at);
  s = applySimulationAction(s, "NEXT_LINE", at);
  s = applySimulationAction(s, "REQUEST_TRANSFER", at);
  assert.equal(s.transferStatus, "HELD");
  assert.equal(s.mockBalance, 1_000_000);
  s = applySimulationAction(s, "CANCEL_TRANSFER", at);
  assert.equal(s.transferStatus, "CANCELLED");
  assert.equal(s.mockBalance, 1_000_000);
});

test("허용되지 않은 상태 전이는 실패한다", () => {
  const s = startSimulation("test-demo", at);
  assert.throws(() => applySimulationAction(s, "CANCEL_TRANSFER", at));
  assert.throws(() => applySimulationAction(s, "REQUEST_TRANSFER", at));
});

test("가상 은행 조회는 실제 신원 확인으로 표현하지 않는다", () => {
  const s = applySimulationAction(startSimulation("test-demo", at), "VERIFY_CLAIM", at);
  assert.equal(s.claimStatus, "MOCK_CONTRADICTED");
  assert.match(s.coaching, /가상의 검증 결과/);
});
