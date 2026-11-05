import test from 'node:test';
import assert from 'node:assert/strict';
import {createCase,applyCaseEvent,getCaseView,buildCaseTimeline} from '../src/modules/case/index.ts';
import {deriveLiveSignals} from '../src/modules/case/live-signals.ts';

function add(state:ReturnType<typeof createCase>,i:number,text:string,speaker:'caller'|'user'|'unknown'='caller',revision=0){
 return applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:`event_${i}_${revision}`,turnId:`T${i}`,absoluteIndex:i,revision,speaker,text});
}

test('old threat evidence survives twelve calm turns, but live urgency falls',()=>{
 let s=createCase('call_mem');s=add(s,0,'당신 아들을 해칠 거야. 지금 당장 송금하세요.');
 const first=getCaseView(s);assert.equal(first.assessment.emergencyFlag,true);assert.equal(first.live.urgency,85);
 for(let i=1;i<=12;i++)s=add(s,i,`안녕하세요 평범한 대화 ${i}`);
 const last=getCaseView(s);assert.equal(last.assessment.emergencyFlag,true);
 assert.equal(last.live.urgency,0);assert.equal(last.live.actionProximity,0);
 assert.ok(last.assessment.riskIndex>=first.assessment.riskIndex);
 assert.equal(last.lastUtteranceId,'T12');
 assert.equal(s.history[1].urgencyDelta,-85);
});
test('calm money request increases action proximity without urgency',()=>{
 const state=add(createCase('calm_1'),0,'해당 계좌로 송금하세요.');
 const view=getCaseView(state);
 assert.equal(view.live.urgency,0);assert.equal(view.live.coercivePressure,0);
 assert.ok(view.live.actionProximity>=80);assert.equal(view.assessment.emergencyFlag,false);
});
test('quoted advice and unknown speaker do not become caller proof',()=>{
 let state=add(createCase('quote1'),0,'인증번호를 알려주지 마세요.');
 assert.equal(getCaseView(state).live.actionProximity,0);
 state=add(state,1,'당신 아들을 해치겠다','unknown');
 assert.equal(getCaseView(state).assessment.emergencyFlag,false);
 assert.equal(getCaseView(state).live.urgency,0);
});
test('revision replaces threat, older revision does not restore it',()=>{
 let state=add(createCase('correct'),0,'아들을 해칠 거야.');
 assert.equal(getCaseView(state).assessment.emergencyFlag,true);
 state=add(state,0,'그런 일이 없어요.', 'caller',1);
 assert.equal(getCaseView(state).assessment.emergencyFlag,false);
 const v=state.version;state=add(state,0,'아들을 해칠 거야.','caller',0);
 assert.equal(state.version,v);assert.equal(getCaseView(state).assessment.emergencyFlag,false);
});
test('evidence dispute and explicit resolution are not silent deletion',()=>{
 let s=add(createCase('case_checked'),0,'아들을 해칠 거야.');
 s=applyCaseEvent(s,{type:'EVIDENCE_STATUS',caseId:s.caseId,eventId:'dispute',turnId:'T0',revision:1,status:'DISPUTED',reason:'전사 정정 확인 필요'});
 assert.equal(getCaseView(s).assessment.emergencyFlag,false);
 assert.equal(getCaseView(s).disputedEvidenceCount,1);
 assert.equal(s.checkpoint.turns[0].signals.length>0,true);
 s=applyCaseEvent(s,{type:'EVIDENCE_STATUS',caseId:s.caseId,eventId:'resolve',turnId:'T0',revision:2,status:'RESOLVED',reason:'데모 운영자 명시 확인'});
 assert.equal(getCaseView(s).resolvedEvidenceCount,1);
});
test('event idempotency, rejection of cross-case and re-used IDs',()=>{
 const s=createCase('case_a');const event={type:'UTTERANCE_FINAL' as const,caseId:'case_a',eventId:'msg_1',turnId:'T1',absoluteIndex:0,revision:0,speaker:'caller' as const,text:'안녕하세요'};
 const s1=applyCaseEvent(s,event);
 assert.equal(applyCaseEvent(s1,event),s1);
 assert.throws(()=>applyCaseEvent(s1,{...event,text:'다른 내용'}),/동일한 이벤트/);
 assert.throws(()=>applyCaseEvent(s1,{...event,eventId:'x',caseId:'case_b'}),/식별자/);
 assert.throws(()=>applyCaseEvent(s1,{...event,eventId:'x',expectedVersion:0}),/버전 충돌/);
});
test('reordered final results keep absolute sequence, duplicate index rejected',()=>{
 let s=createCase('reorder');s=add(s,5,'지금 당장 송금하세요');s=add(s,2,'안녕하세요');
 assert.deepEqual(s.checkpoint.turns.map(t=>t.absoluteIndex),[2,5]);
 assert.equal(getCaseView(s).lastUtteranceId,'T5');
 assert.throws(()=>applyCaseEvent(s,{type:'UTTERANCE_FINAL',caseId:'reorder',eventId:'dup_ix',turnId:'OTHER',absoluteIndex:5,revision:0,speaker:'caller',text:'x'}),/순서 충돌/);
});
test('close prevents any later mutation; duplicate close is idempotent',()=>{
 const s=add(createCase('done'),0,'안녕하세요');const end={type:'CASE_CLOSED' as const,caseId:'done',eventId:'end'};
 const ended=applyCaseEvent(s,end);assert.equal(ended.status,'CLOSED');assert.equal(applyCaseEvent(ended,end),ended);
 assert.throws(()=>add(ended,1,'송금하세요'),/종료된 사건/);
});
test('two cases never share evidence; user action remains single scorer',()=>{
 const a=add(createCase('one'),0,'아들을 해칠 거야.');
 const b=add(createCase('two'),0,'안녕하세요');
 assert.equal(getCaseView(a).assessment.emergencyFlag,true);assert.equal(getCaseView(b).assessment.emergencyFlag,false);
 const withAction=applyCaseEvent(b,{type:'USER_ACTION',caseId:'two',eventId:'action_1',action:'TRANSFER_PREPARED'});
 assert.equal(getCaseView(withAction).assessment.riskBand,'CAUTION');
 assert.equal(getCaseView(withAction).live.actionProximity,100);
 assert.equal(getCaseView(b).assessment.riskBand,'LOW');
});
test('timeline only examines provided prefix, not future turns or ground truth',()=>{
 const timeline=buildCaseTimeline('replay_demo',[{turnId:'T1',speaker:'caller',text:'안녕하세요'},{turnId:'T2',speaker:'caller',text:'아들을 해칠 거야.'}]);
 assert.equal(timeline.length,2);assert.equal(getCaseView(timeline[0]).assessment.emergencyFlag,false);
 assert.equal(getCaseView(timeline[1]).assessment.emergencyFlag,true);
});
test('metrics are deterministic, bounded and do not claim to measure stress',()=>{
 const s=deriveLiveSignals([{code:'URGENCY',weight:12,evidence:'당장',turn:0}],10);
 assert.equal(s.urgency,70);assert.equal(s.urgencyDelta,60);assert.ok(s.livePressureIndex<=100);
 assert.ok(s.limitations.some(x=>x.includes('스트레스')));
});

test('latest utterance direct-threat flag is separate from historic unresolved threat',()=>{
 let s=add(createCase('threat_now'),0,'당신 가족을 해칠 거야.');
 assert.equal(getCaseView(s).live.currentThreatObserved,true);
 s=add(s,1,'안녕하세요');
 assert.equal(getCaseView(s).assessment.emergencyFlag,true);
 assert.equal(getCaseView(s).live.currentThreatObserved,false);
});
test('state history and case view share the same urgency delta',()=>{
 let s=add(createCase('delta'),0,'지금 당장 처리하세요');
 s=add(s,1,'안녕하세요');
 assert.equal(s.history.at(-1)?.urgencyDelta,-70);
 assert.equal(getCaseView(s).live.urgencyDelta,-70);
});
test('retraction and closure keep evidence audit but do not allow reuse',()=>{
 let s=add(createCase('removed'),0,'당신 아들을 해칠 거야.');
 s=applyCaseEvent(s,{type:'UTTERANCE_RETRACT',caseId:s.caseId,eventId:'ret',turnId:'T0',revision:1});
 assert.equal(getCaseView(s).assessment.emergencyFlag,false);
 assert.equal(getCaseView(s).retractedEvidenceCount,1);
 s=applyCaseEvent(s,{type:'CASE_CLOSED',caseId:s.caseId,eventId:'bye'});
 assert.equal(getCaseView(s).status,'CLOSED');
});
test('status changes require reason and must reject unknown evidence',()=>{
 const s=add(createCase('status_reason'),0,'아들을 해칠 거야.');
 assert.throws(()=>applyCaseEvent(s,{type:'EVIDENCE_STATUS',caseId:s.caseId,eventId:'status',turnId:'T0',revision:1,status:'DISPUTED',reason:'  '}));
 assert.throws(()=>applyCaseEvent(s,{type:'EVIDENCE_STATUS',caseId:s.caseId,eventId:'status2',turnId:'missing',revision:1,status:'DISPUTED',reason:'문장 근거 미확인'}));
});
