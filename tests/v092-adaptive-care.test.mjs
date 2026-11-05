import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {createCase} from '../src/modules/case/index.ts';
import {selectLiveGuidance} from '../src/modules/playbook/select.ts';
import {createCareInteraction,nextCareQuestion,applyCareInteractionEvent,deriveActiveCare} from '../demo/safety-challenge/adaptive-care.mjs';
let app,root;
before(async()=>{app=createDemoServer({port:0,allowLegacyShared:true});root=`http://127.0.0.1:${(await app.listen()).port}`;});
after(async()=>app.close());
const post=async(route,data)=>{const r=await fetch(root+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
const reset=async(mode='guidance',scenarioId='benign')=>(await post('reset',{scenarioId,mode})).data;
const args=s=>({runId:s.runId,expectedVersion:s.version});
const call=async(route,s,payload={})=>{const r=await post(route,{...args(s),...payload});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const evt=async(s,type,extra={})=>call('care/question/event',s,{eventId:randomUUID(),type,caseVersion:s.careCaseVersion,
 expectedInteractionVersion:s.careInteraction.version,...extra});
const present=async s=>evt(s,'CARE_QUESTION_PRESENTED',{questionId:s.careInteraction.questionProposal.questionId});
const answer=async(s,choice)=>evt(s,'CARE_QUESTION_ANSWERED',{questionId:s.careInteraction.activeQuestion.id,choiceId:choice});

test('A arm never offers questionnaire or receives user-specific coaching',async()=>{
 let s=await reset('warning');assert.equal(s.careInteraction,null);
 assert.equal((await post('care/question/event',{...args(s),eventId:randomUUID(),type:'CARE_SCREEN_UNSAFE_REPORTED'})).status,403);
});
test('opt-in first question, payment self-report guides without modifying canonical risk',async()=>{
 let s=await reset();const before=s.risk;assert.equal(s.careInteraction.questionProposal.decision,'ASK');
 assert.equal(s.careInteraction.questionProposal.questionId,'REQUEST_TYPE');
 s=await present(s);assert.equal(s.careInteraction.activeQuestion.id,'REQUEST_TYPE');
 const pres=s.careInteraction.version;
 s=await answer(s,'PAYMENT');assert.equal(s.careInteraction.version,pres+1);
 assert.equal(s.care.coaching.kind,'PAYMENT_HOLD');assert.equal(s.care.coaching.basis.includes('사용자'),true);
 assert.deepEqual(s.risk,before);assert.equal(s.careInteraction.countsAsAutomaticDetection,false);
 assert.equal(s.careInteraction.answerProvenance,'USER_SELF_REPORT_UNVERIFIED');
 assert.equal(s.care.coaching.evidenceUtteranceIds.length,0);
 assert.equal(s.careInteraction.questionProposal.questionId,'ACTION_STATUS');
 s=await present(s);s=await answer(s,'DONE');
 assert.equal(s.care.coaching.kind,'PAID');assert.deepEqual(s.risk,before);
 assert.equal(s.realMoneySent,false);assert.equal(s.externalActionPerformed,false);
});
test('unknown country advice never produces guessed authority, number, or link',async()=>{
 let s=await reset();s=await call('jurisdiction',s,{jurisdiction:'UNKNOWN'});
 s=await present(s);s=await answer(s,'PAYMENT');s=await present(s);s=await answer(s,'DONE');
 assert.equal(s.care.coaching.kind,'PAID');assert.equal(s.care.coaching.sourceLinks.length,0);
 assert.doesNotMatch(s.care.coaching.primaryInstruction,/112|911|1394/);
});
test('US self-reported action routes to US coaching and matching official sources',async()=>{
 let s=await reset();s=await call('jurisdiction',s,{jurisdiction:'US'});
 s=await present(s);s=await answer(s,'CREDENTIALS');
 assert.equal(s.care.coaching.kind,'CREDENTIALS');assert.ok(s.care.coaching.sourceIds.every(id=>id.startsWith('FTC_')));
});
test('remote-access self report suppresses additional questions and gives trusted-device guidance',async()=>{
 let s=await reset();s=await present(s);s=await answer(s,'REMOTE');
 assert.equal(s.careInteraction.questionProposal.decision,'SKIP_NO_NEED');assert.equal(s.care.coaching.kind,'REMOTE');
 assert.match(s.care.coaching.primaryInstruction,/기기/);
});
test('screen unsafe self report terminates live question and prevents further collection',async()=>{
 let s=await reset();s=await present(s);
 s=await evt(s,'CARE_SCREEN_UNSAFE_REPORTED');
 assert.equal(s.careInteraction.screenUnsafe,true);assert.equal(s.careInteraction.activeQuestion,null);
 assert.equal(s.careInteraction.questionProposal.decision,'SKIP_UNSAFE');
 assert.equal(s.care.coaching.kind,'REMOTE');
 assert.equal((await post('care/question/event',{...args(s),eventId:randomUUID(),type:'CARE_QUESTION_ANSWERED',
   caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version,questionId:'REQUEST_TYPE',choiceId:'PAYMENT'})).status,409);
});
test('completed caller emergency takes priority and suppresses questions',async()=>{
 let s=await reset('guidance','kidnap');s=await call('advance',s);s=await call('advance',s);
 assert.equal(s.risk.emergency,true);assert.equal(s.careInteraction.questionProposal.decision,'SKIP_EMERGENCY');
 assert.equal(s.care.coaching.kind,'EMERGENCY');
 const r=await post('care/question/event',{...args(s),eventId:randomUUID(),type:'CARE_QUESTION_PRESENTED',
   questionId:'REQUEST_TYPE',caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version});
 assert.equal(r.status,409);
});
test('remote-access caller signal suppresses question even without self report',async()=>{
 let s=await reset('guidance','remote');
 for(let i=0;i<s.scenario.totalSteps;i++){
  s=await call('advance',s);
  if(s.care.coaching.kind==='REMOTE')break;
 }
 assert.equal(s.care.coaching.kind,'REMOTE');assert.equal(s.careInteraction.questionProposal.decision,'SKIP_UNSAFE');
});
test('safe question skip does not force follow-up or alarming advice',async()=>{
 let s=await reset();s=await present(s);
 s=await evt(s,'CARE_QUESTION_SKIPPED',{questionId:'REQUEST_TYPE'});
 assert.equal(s.careInteraction.questionProposal.decision,'SKIP_NO_NEED');
 assert.equal(s.care.coaching.kind,'OBSERVE');
});
test('question is invalidated after canonical utterance update; stale response rejected',async()=>{
 let s=await reset();s=await present(s);const old=s;
 s=await call('advance',s);assert.equal(s.careInteraction.activeQuestion,null);
 const replay=await post('care/question/event',{...args(s),eventId:randomUUID(),type:'CARE_QUESTION_ANSWERED',questionId:'REQUEST_TYPE',choiceId:'PAYMENT',
  caseVersion:old.careCaseVersion,expectedInteractionVersion:old.careInteraction.version});
 assert.equal(replay.status,409);assert.equal(s.careInteraction.answers.REQUEST_TYPE,undefined);
});
test('different run IDs, invalid choices, and arbitrary user text are rejected',async()=>{
 let s=await reset();s=await present(s);
 const rootArgs={...args(s),caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version,
  eventId:randomUUID(),type:'CARE_QUESTION_ANSWERED',questionId:'REQUEST_TYPE'};
 assert.equal((await post('care/question/event',{...rootArgs,choiceId:'UNAUTHORIZED_TRANSFER'})).status,409);
 assert.equal((await post('care/question/event',{...rootArgs,choiceId:'PAYMENT',runId:'other'})).status,409);
 assert.equal((await post('care/question/event',{...rootArgs,choiceId:'PAYMENT',eventId:'<script>alert(1)</script>'})).status,409);
 assert.equal((await post('care/question/event',{...rootArgs,choiceId:'PAYMENT',expectedVersion:s.version-1})).status,409);
});
test('exact event replay is idempotent, conflicting replay is rejected',async()=>{
 let s=await reset();const payload={...args(s),eventId:randomUUID(),type:'CARE_QUESTION_PRESENTED',questionId:'REQUEST_TYPE',
  caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version};
 const r=await post('care/question/event',payload);assert.equal(r.status,200);s=r.data;
 const same=await post('care/question/event',payload);assert.equal(same.status,200);assert.equal(same.data.careInteraction.version,s.careInteraction.version);
 const conflict=await post('care/question/event',{...payload,questionId:'ACTION_STATUS'});assert.equal(conflict.status,409);
});
test('closed case disallows new questions while recovery remains available',async()=>{
 let s=await reset();s=await call('end',s);
 assert.equal(s.careInteraction.questionProposal.decision,'SKIP_CASE_CLOSED');
 assert.equal((await post('care/question/event',{...args(s),eventId:randomUUID(),type:'CARE_SCREEN_UNSAFE_REPORTED',
  caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version})).status,409);
 assert.ok(s.recovery);
});
test('observed family concern gives guidance without requiring additional sensitive questions',async()=>{
 let s=await reset();s=await call('care/check-in',s,{concern:'FAMILY_CONCERN'});
 assert.equal(s.careInteraction.questionProposal.decision,'SKIP_NO_NEED');
 assert.equal(s.care.coaching.kind,'VERIFY');
});
test('pure policy never consults future labels and question event never modifies risk engine',()=>{
 const c=createCase('pure_case'),i=createCareInteraction('pure_case');
 const decision=nextCareQuestion({caseState:c,interaction:i,emergency:false,guidance:selectLiveGuidance({caseState:c})});
 assert.equal(decision.question.id,'REQUEST_TYPE');
 const event={caseId:'pure_case',eventId:'pure_event_1',type:'CARE_QUESTION_PRESENTED',questionId:'REQUEST_TYPE',caseVersion:c.version,expectedInteractionVersion:0};
 const next=applyCareInteractionEvent(i,event,{caseState:c,decision});
 assert.equal(next.activeQuestion.id,'REQUEST_TYPE');assert.equal(c.version,0);assert.equal(next.version,1);
 assert.equal(deriveActiveCare(next).countsAsPassiveDetection,false);
});
