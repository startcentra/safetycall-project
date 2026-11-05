import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {GUIDE_PATHS,PAYMENT_METHODS,OFFICIAL_GUIDE_SOURCES,createGuidedJourney,applyGuidedEvent,guidedJourneyView,guidedSteps} from '../demo/safety-challenge/guided-actions.mjs';

const makeEvent=(store,type,extra={},eventId)=>({caseId:store.caseId,eventId:eventId||`event_${store.version+1}`,type,expectedGuidedVersion:store.version,...extra});
const apply=(store,type,extra={},meta={})=>applyGuidedEvent(store,makeEvent(store,type,extra),meta);
const select=(store,path)=>apply(store,'GUIDED_PATH_ADDED',{pathId:path});
const result=(store,stepId,answer,meta={})=>apply(store,'GUIDED_STEP_RESULT',{pathId:store.activePath,stepId,result:answer},meta);

test('all six guided paths provide unique, ordered steps and fallback without collecting secrets',()=>{
 for(const path of Object.keys(GUIDE_PATHS)){
  const steps=guidedSteps(path,'KR');assert.ok(steps.length>=2);assert.equal(new Set(steps.map(s=>s.id)).size,steps.length);
  for(const s of steps){assert.ok(s.instruction.length>20);assert.ok(s.fallback.length>10);assert.ok(!/입력하세요.*(?:OTP|비밀번호|계좌번호)/.test(s.instruction));}
 }
});
test('KR/US/UNKNOWN payment methods disallow mistaken country-specific remedies',()=>{
 assert.ok(PAYMENT_METHODS.KR.includes('BANK_TRANSFER'));
 assert.ok(!PAYMENT_METHODS.KR.includes('ACH'));
 assert.ok(PAYMENT_METHODS.US.includes('ACH'));
 assert.ok(!PAYMENT_METHODS.US.includes('BANK_TRANSFER'));
 assert.deepEqual(PAYMENT_METHODS.UNKNOWN,['UNKNOWN']);
 for(const country of ['KR','US','UNKNOWN']){
  for(const method of PAYMENT_METHODS[country]){
   const x=guidedSteps('PAYMENT',country,{paymentMethod:method,actionStatus:'DONE'});
   assert.ok(x[1].instruction.length>30);
   if(country==='UNKNOWN')assert.doesNotMatch(x[1].instruction,/FTC|112|한국|미국/);
  }
 }
});
test('payment before vs after changes provider guidance but never guarantees refund',()=>{
 const before=guidedSteps('PAYMENT','US',{actionStatus:'NOT_DONE'});
 const after=guidedSteps('PAYMENT','US',{actionStatus:'DONE',paymentMethod:'CARD'});
 assert.notEqual(before[1].instruction,after[1].instruction);
 assert.match(after[1].instruction,/카드 발급사/);
 assert.doesNotMatch(after[1].instruction,/환불 보장/);
});
test('guided journey stores user reported completion, not external verification',()=>{
 let s=select(createGuidedJourney('case1'),'PAYMENT');
 s=result(s,'PAUSE','USER_REPORTED_DONE');
 let view=guidedJourneyView(s,{jurisdiction:'KR'});
 assert.equal(view.steps[0].status,'USER_REPORTED_DONE');assert.equal(view.currentStep.id,'PROVIDER');
 assert.equal(view.verifiedExternalCompletion,false);assert.equal(view.realMoneySent,false);assert.equal(view.metaCalled,false);
});
test('unable / result unknown stays on the step and points to meaningful fallback',()=>{
 let s=select(createGuidedJourney('case2'),'FAMILY');
 s=result(s,'PAUSE','USER_REPORTED_DONE');s=result(s,'INDEPENDENT','UNABLE_TO_COMPLETE');
 let view=guidedJourneyView(s);assert.equal(view.currentStep.id,'INDEPENDENT');
 assert.match(view.currentStep.fallback,/가족|연락/);
 assert.throws(()=>result(s,'INDEPENDENT','UNABLE_TO_COMPLETE'),/같은 상태/);
 s=result(s,'INDEPENDENT','RESULT_UNKNOWN');assert.equal(guidedJourneyView(s).currentStep.id,'INDEPENDENT');
});
test('multiple incident paths hold separate payment and remote action status',()=>{
 let s=select(createGuidedJourney('case3'),'PAYMENT');
 s=apply(s,'GUIDED_CONTEXT_SET',{field:'actionStatus',value:'DONE'});
 s=apply(s,'GUIDED_CONTEXT_SET',{field:'paymentMethod',value:'BANK_TRANSFER'},{jurisdiction:'KR'});
 s=select(s,'REMOTE_ACCESS');
 assert.equal(guidedJourneyView(s).context.actionStatus,'UNKNOWN');
 assert.equal(guidedJourneyView(s).context.paymentMethod,'UNKNOWN');
 s=select(s,'PAYMENT');assert.equal(guidedJourneyView(s,{jurisdiction:'KR'}).context.paymentMethod,'BANK_TRANSFER');
});
test('invalid IDs, paths, contexts, payment methods, stale revisions are rejected',()=>{
 assert.throws(()=>createGuidedJourney('../bad'),/ID/);
 const s=select(createGuidedJourney('case4'),'PAYMENT');
 assert.throws(()=>apply(s,'GUIDED_PATH_ADDED',{pathId:'INVALID'}),/케어 유형/);
 assert.throws(()=>apply(s,'GUIDED_CONTEXT_SET',{field:'paymentMethod',value:'ACH'},{jurisdiction:'KR'}),/국가/);
 assert.throws(()=>apply(s,'GUIDED_CONTEXT_SET',{field:'otp',value:'123456'}),/맥락/);
 assert.throws(()=>applyGuidedEvent(s,{...makeEvent(s,'GUIDED_PAUSED'),expectedGuidedVersion:-1}),/오래된/);
 assert.throws(()=>applyGuidedEvent(s,{...makeEvent(s,'GUIDED_PAUSED'),caseId:'other'}),/불일치/);
 assert.throws(()=>result(s,'PROVIDER','USER_REPORTED_DONE'),/현재 진행 단계/);
});
test('idempotency requires identical event payload; tampered duplicate cannot alter state',()=>{
 let s=select(createGuidedJourney('case5'),'PAYMENT');const e=makeEvent(s,'GUIDED_STEP_RESULT',{pathId:'PAYMENT',stepId:'PAUSE',result:'USER_REPORTED_DONE'},'dup_evt');
 s=applyGuidedEvent(s,e);assert.equal(applyGuidedEvent(s,e),s);
 assert.throws(()=>applyGuidedEvent(s,{...e,result:'SKIPPED'}),/동일 이벤트/);
});
test('paused and closed journeys never progress without explicit transition',()=>{
 let s=select(createGuidedJourney('case6'),'UNKNOWN');
 s=apply(s,'GUIDED_PAUSED');assert.equal(guidedJourneyView(s).phase,'PAUSED');
 assert.throws(()=>result(s,'PAUSE','USER_REPORTED_DONE'),/일시 중단/);
 s=apply(s,'GUIDED_RESUMED');s=result(s,'PAUSE','SKIPPED');
 s=apply(s,'GUIDED_CLOSED');assert.equal(guidedJourneyView(s).phase,'CLOSED');
 assert.throws(()=>apply(s,'GUIDED_RESUMED'),/이미 종료/);
});
test('case closed does not block separate recovery progress; no new live detection implied',()=>{
 let s=select(createGuidedJourney('case7'),'CREDENTIALS');
 s=result(s,'NO_SHARE','USER_REPORTED_DONE',{caseClosed:true});
 assert.equal(guidedJourneyView(s,{caseClosed:true}).caseClosed,true);
 assert.equal(s.events.at(-1).caseClosedAtEvent,true);
});
test('emergency or unsafe mode blocks step UX even when selected',()=>{
 const s=select(createGuidedJourney('case8'),'IDENTITY');
 const x=guidedJourneyView(s,{emergency:true});assert.equal(x.blocker,'EMERGENCY_PRIORITY');assert.equal(x.canRecord,false);
 const y=guidedJourneyView(s,{screenUnsafe:true});assert.equal(y.blocker,'SCREEN_UNSAFE');assert.equal(y.canRecord,false);
});
test('sources only from fixed official allowlist, never inferred for unknown country',()=>{
 let s=select(createGuidedJourney('case9'),'IDENTITY');
 const us=guidedJourneyView(s,{jurisdiction:'US'});assert.ok(us.sources.some(x=>x.sourceId==='US_ID'));
 const unknown=guidedJourneyView(s,{jurisdiction:'UNKNOWN'});assert.deepEqual(unknown.sources,[]);
 for(const source of Object.values(OFFICIAL_GUIDE_SOURCES))assert.ok(source.url.startsWith('https://'));
});
let app,root;
before(async()=>{app=createDemoServer({port:0});root=`http://127.0.0.1:${(await app.listen()).port}`;});
after(async()=>await app.close());
const post=async(path,data,auth)=>{const r=await fetch(root+path,{method:'POST',headers:{'content-type':'application/json',...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.token}:{})},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
async function make(scenarioId='benign',mode='verified'){
 const r=await post('/api/session/create',{scenarioId,mode});assert.equal(r.status,201,r.data.error);
 return {s:r.data,parent:{sessionId:r.data.sessionCredentials.sessionId,token:r.data.sessionCredentials.parentToken},child:{sessionId:r.data.sessionCredentials.sessionId,token:r.data.sessionCredentials.childToken}};
}
const msg=(s,type,x={})=>({runId:s.runId,expectedVersion:s.version,eventId:`guided_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`,type,expectedGuidedVersion:s.guided.version,...x});
const guided=(s,auth,type,x={})=>post('/api/guided/event',msg(s,type,x),auth);
test('API: parent adds playbook, records step, closes case and continues recovery',async()=>{
 const a=await make();let s=a.s;
 let r=await guided(s,a.parent,'GUIDED_PATH_ADDED',{pathId:'PAYMENT'});assert.equal(r.status,200,r.data.error);s=r.data;
 r=await guided(s,a.parent,'GUIDED_STEP_RESULT',{pathId:'PAYMENT',stepId:'PAUSE',result:'USER_REPORTED_DONE'});assert.equal(r.status,200,r.data.error);s=r.data;
 assert.equal(s.guided.currentStep.id,'PROVIDER');
 r=await post('/api/end',{runId:s.runId,expectedVersion:s.version},a.parent);assert.equal(r.status,200);s=r.data;
 r=await guided(s,a.parent,'GUIDED_STEP_RESULT',{pathId:'PAYMENT',stepId:'PROVIDER',result:'RESULT_UNKNOWN'});assert.equal(r.status,200,r.data.error);
 assert.equal(r.data.endedAt,s.endedAt);assert.equal(r.data.guided.currentStep.id,'PROVIDER');
});
test('API: auth roles and session isolation prevent child or another case editing care',async()=>{
 const a=await make(),b=await make();
 const e=msg(a.s,'GUIDED_PATH_ADDED',{pathId:'FAMILY'});
 assert.equal((await post('/api/guided/event',e,a.child)).status,403);
 assert.equal((await post('/api/guided/event',e,b.parent)).status,409);
 assert.equal((await post('/api/guided/event',e,a.parent)).status,200);
 const stateB=await fetch(root+'/api/state',{headers:{'X-SafeCall-Session':b.parent.sessionId,'X-SafeCall-Token':b.parent.token}}).then(r=>r.json());
 assert.equal(stateB.guided.paths.length,0);
});
test('API: unsafe screen forbids step completion; user can close journey',async()=>{
 const a=await make();let s=(await guided(a.s,a.parent,'GUIDED_PATH_ADDED',{pathId:'REMOTE_ACCESS'})).data;
 const r=await post('/api/care/question/event',{runId:s.runId,expectedVersion:s.version,eventId:'unsafe_guided_event',type:'CARE_SCREEN_UNSAFE_REPORTED',caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version},a.parent);
 assert.equal(r.status,200,r.data.error);s=r.data;assert.equal(s.guided.blocker,'SCREEN_UNSAFE');
 assert.equal((await guided(s,a.parent,'GUIDED_STEP_RESULT',{pathId:'REMOTE_ACCESS',stepId:'NO_ACCESS',result:'USER_REPORTED_DONE'})).status,409);
 const closed=await guided(s,a.parent,'GUIDED_CLOSED');assert.equal(closed.status,200);assert.equal(closed.data.guided.phase,'CLOSED');
});
test('API: emergency prioritization prevents marking guided actions until safe',async()=>{
 const a=await make('kidnap');let s=a.s;
 s=(await guided(s,a.parent,'GUIDED_PATH_ADDED',{pathId:'FAMILY'})).data;
 s=(await post('/api/advance',{runId:s.runId,expectedVersion:s.version},a.parent)).data;
 s=(await post('/api/advance',{runId:s.runId,expectedVersion:s.version},a.parent)).data;
 assert.equal(s.risk.emergency,true);assert.equal(s.guided.blocker,'EMERGENCY_PRIORITY');
 assert.equal((await guided(s,a.parent,'GUIDED_STEP_RESULT',{pathId:'FAMILY',stepId:'PAUSE',result:'USER_REPORTED_DONE'})).status,409);
});
test('API: normal event progresses once; replay harmless; old state and invalid payload fail',async()=>{
 const a=await make();let s=a.s;
 let r=await guided(s,a.parent,'GUIDED_PATH_ADDED',{pathId:'PAYMENT'});s=r.data;
 const e=msg(s,'GUIDED_STEP_RESULT',{pathId:'PAYMENT',stepId:'PAUSE',result:'USER_REPORTED_DONE'});
 r=await post('/api/guided/event',e,a.parent);assert.equal(r.status,200);
 assert.equal((await post('/api/guided/event',e,a.parent)).status,200);
 assert.equal((await post('/api/guided/event',{...e,eventId:'new_wrong_event',expectedVersion:s.version},a.parent)).status,409);
 assert.equal((await post('/api/guided/event',{...msg(r.data,'GUIDED_CONTEXT_SET',{field:'otp',value:'SECRET'})},a.parent)).status,400);
});
test('API: warning baseline never receives Guided Care',async()=>{
 const a=await make('benign','warning');assert.equal(a.s.guided,null);
 assert.equal((await post('/api/guided/event',{runId:a.s.runId,expectedVersion:a.s.version,eventId:'warning_case_event',type:'GUIDED_PATH_ADDED',pathId:'PAYMENT'},a.parent)).status,403);
});
test('changing jurisdiction never reuses a foreign-only payment method',()=>{
 let s=select(createGuidedJourney('country_case'),'PAYMENT');
 s=apply(s,'GUIDED_CONTEXT_SET',{field:'paymentMethod',value:'BANK_TRANSFER'},{jurisdiction:'KR'});
 const view=guidedJourneyView(s,{jurisdiction:'US'});
 assert.equal(view.context.paymentMethod,'UNKNOWN');
 assert.doesNotMatch(view.steps[1].instruction,/지급정지/);
});
test('journey transitions are bounded, distinct, and closure is terminal',()=>{
 let s=select(createGuidedJourney('complete_case'),'UNKNOWN');
 for(const stepId of ['PAUSE','CHECK','NEXT'])s=result(s,stepId,'USER_REPORTED_DONE');
 assert.equal(guidedJourneyView(s).currentStep,null);
 s=apply(s,'GUIDED_CLOSED');
 assert.equal(s.phase,'CLOSED');
 assert.throws(()=>select(s,'PAYMENT'),/이미 종료/);
});
test('no automatic model call or external financial side effect introduced in guided UI assets',async()=>{
 const {readFileSync}=await import('node:fs');
 const server=readFileSync(new URL('../demo/safety-challenge/guided-actions.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(server,/\bfetch\s*\(|\bWebSocket\s*\(|\bhttp\.request\s*\(/);
 const rendered=guidedJourneyView(select(createGuidedJourney('mock_only'),'PAYMENT'));
 assert.equal(rendered.externalActionPerformed,false);
 assert.equal(rendered.verifiedExternalCompletion,false);
});
test('unsafe screen is incident-wide and cannot be bypassed by switching playbooks',()=>{
 let s=select(createGuidedJourney('unsafe_global'),'REMOTE_ACCESS');
 s=apply(s,'GUIDED_CONTEXT_SET',{field:'screenUnsafe',value:true});
 s=select(s,'PAYMENT');
 const v=guidedJourneyView(s,{jurisdiction:'KR'});
 assert.equal(v.blocker,'SCREEN_UNSAFE');assert.equal(v.canRecord,false);
 assert.throws(()=>apply(s,'GUIDED_CONTEXT_SET',{field:'screenUnsafe',value:false}),/자동 해제/);
});
