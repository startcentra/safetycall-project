/** No network/Next.js required: tests the real shared triage->policy->coaching->fake bank path. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startSimulation,applySimulationAction,DEMO_LINES} from '../src/modules/simulation/engine.ts';
import {replayScenario,scenarios} from '../src/modules/evaluation/index.ts';
import {applyVoiceEvent,emptyVoiceState} from '../src/modules/audio/transcript.ts';
import {assessTriage} from '../src/modules/risk-triage/index.ts';
import {selectDemoCoaching} from '../src/modules/coaching/index.ts';

const at='2026-10-28T00:00:00.000Z';

test('full scripted simulation: triage -> coaching -> hold -> cancel -> end, no actual money movement',()=>{
 let state=startSimulation('offline-e2e',at);
 const originalBalance=state.mockBalance;
 for(let i=0;i<DEMO_LINES.length;i++){
  state=applySimulationAction(state,'NEXT_LINE',at);
  assert.equal(state.transcript.length,i+1);
  assert.deepEqual(state.assessment,assessTriage({turns:DEMO_LINES.slice(0,i+1).map(text=>({speaker:'caller',text}))}));
 }
 assert.match(state.coaching,/송금|공식/);
 state=applySimulationAction(state,'REQUEST_TRANSFER',at);
 assert.equal(state.transferStatus,'HELD');assert.equal(state.mockBalance,originalBalance);
 assert.match(state.coaching,/보류/);
 state=applySimulationAction(state,'VERIFY_CLAIM',at);
 assert.equal(state.claimStatus,'MOCK_CONTRADICTED');
 state=applySimulationAction(state,'CANCEL_TRANSFER',at);
 assert.equal(state.transferStatus,'CANCELLED');assert.equal(state.mockBalance,originalBalance);
 state=applySimulationAction(state,'END_CASE',at);
 assert.equal(state.ended,true);
 assert.throws(()=>applySimulationAction(state,'NEXT_LINE',at));
 assert.deepEqual(state.timeline.map(e=>e.type).filter(x=>x==='MOCK_TRANSFER_HELD'||x==='MOCK_TRANSFER_CANCELLED'),['MOCK_TRANSFER_HELD','MOCK_TRANSFER_CANCELLED']);
});

test('offline ASR FINAL only: partials cannot change policy decisions, and duplicate FINAL is once',()=>{
 let audio=applyVoiceEvent(emptyVoiceState(),{type:'speechStart',turnId:1});
 audio=applyVoiceEvent(audio,{type:'transcript',turnId:1,transcript:'즉시 송금하세요'});
 assert.equal(audio.finalized.length,0);
 audio=applyVoiceEvent(audio,{type:'speechComplete',turnId:1,transcript:'지금 바로 송금하세요',audioProcessedMs:1050});
 audio=applyVoiceEvent(audio,{type:'speechComplete',turnId:1,transcript:'지금 바로 송금하세요',audioProcessedMs:1050});
 assert.equal(audio.finalized.length,1);
 const assessment=assessTriage({turns:audio.finalized.map(x=>({speaker:'caller',text:x.text}))});
 assert.equal(assessment.shouldCallMeta,true);
 const coaching=selectDemoCoaching({assessment,transferStatus:'NONE',claimStatus:'UNVERIFIED',ended:false});
 assert.match(coaching,/송금|공식/);
});

test('normal and scam replay share assessTriage but never feed future turns',()=>{
 const normal=scenarios.find(x=>x.category==='NORMAL');
 const scam=scenarios.find(x=>x.category==='TRADITIONAL');
 if(!normal||!scam)throw new Error('정상 및 사기 대조군 데이터 누락');
 for(const sample of [normal,scam]){
  const steps=replayScenario(sample);
  assert.equal(steps.length,sample.turns.length);
  for(let i=0;i<steps.length;i++){
   const prefix=sample.turns.slice(0,i+1).map(x=>({speaker:x.speaker,text:x.text}));
   assert.deepEqual(steps[i].assessment,assessTriage({turns:prefix}));
  }
 }
});

test('true threats keep emergency guidance even if no transfer was prepared',()=>{
 const assessment=assessTriage({turns:[{speaker:'caller',text:'당신 가족을 해칠 겁니다.'}]});
 assert.equal(assessment.emergencyFlag,true);
 const coaching=selectDemoCoaching({assessment,transferStatus:'NONE',claimStatus:'UNVERIFIED',ended:false});
 assert.match(coaching,/112/);
});
