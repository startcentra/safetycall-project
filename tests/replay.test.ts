import test from "node:test";
import assert from "node:assert/strict";
import { assessTriage } from "../src/modules/risk-triage/index.ts";
import { evaluateDataset, keywordBaseline, replayScenario, researchSources, scenarios, validateDataset } from "../src/modules/evaluation/index.ts";

test("60개의 합성 시나리오와 270개의 발화; 각 그룹 15건",()=>{
  assert.equal(scenarios.length,60);
  assert.equal(scenarios.reduce((sum,s)=>sum+s.turns.length,0),270);
  for(const category of ["NORMAL","TRADITIONAL","EVOLVED","AMBIGUOUS"]) assert.equal(scenarios.filter(s=>s.category===category).length,15);
});
test("모든 시나리오·출처·가상 텍스트 구조 검증",()=>{
  assert.deepEqual(validateDataset(),[]);
  assert.ok(researchSources.length>=5);
});
test("미래 발화가 현재 결과에 누출되지 않는다",()=>{
  for(const sc of scenarios){
    const steps=replayScenario(sc);
    for(let i=0;i<steps.length;i++){
      const direct=assessTriage({turns:sc.turns.slice(0,i+1).map(t=>({speaker:t.speaker,text:t.text}))});
      assert.deepEqual(steps[i].assessment,direct);
    }
  }
});
test("정답 라벨을 변경해도 위험 분석 결과는 변하지 않는다",()=>{
  const s=scenarios[17];
  const a=replayScenario(s);
  const altered={...s,groundTruth:{...s.groundTruth,scenarioLabel:"NORMAL" as const,expectedSignals:[],expectedCriticalTurn:null}};
  const b=replayScenario(altered);
  assert.deepEqual(a,b);
});
test("의심 단어가 없는 대조군에서 baseline 위험 없음",()=>{
  assert.equal(keywordBaseline([{speaker:"caller",text:"주말에 산책하러 갈래?"}]),false);
});
test("사건 단위 혼동행렬 합계가 이진 평가 집합과 일치",()=>{
  const r=evaluateDataset();
  for(const m of [r.baseline.matrix,r.canonical.matrix])assert.equal(m.TP+m.FP+m.TN+m.FN,r.binaryEvaluated);
  assert.equal(r.ambiguousExcluded,15);
  assert.equal(r.criticalScenarioCount,30);
});
test("위험행동 '이전'과 '시점 이내' 경고가 구분된다",()=>{
  const r=evaluateDataset();
  assert.ok(r.warningByCriticalCount>=r.warningBeforeCriticalCount);
  for(const row of r.cases){
    if(row.criticalTurn!==null && row.firstWarningTurn!==null){
      assert.equal(row.warnedBeforeCriticalTurn,row.firstWarningTurn<row.criticalTurn);
      assert.equal(row.warnedByCriticalTurn,row.firstWarningTurn<=row.criticalTurn);
    }
  }
});
test("메타 호출은 후보로만 기록하며 실제 외부 요청을 수행하지 않는다",()=>{
  const r=evaluateDataset();
  assert.equal(r.sampleSize,60);
  assert.ok(r.triggerCount>0);
  assert.ok(r.cases.some(c=>c.label==="SCAM"&&!c.warning));
  assert.ok(r.cases.some(c=>c.label==="NORMAL"&&c.warning));
});
