import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {selectActionCoaching} from '../demo/safety-challenge/coaching-policy.mjs';
import {sourceById} from '../src/modules/playbook/sources.ts';
import {createCase,applyCaseEvent,getCaseView} from '../src/modules/case/index.ts';
import {selectLiveGuidance} from '../src/modules/playbook/select.ts';
import {coachingCases} from '../src/modules/evaluation/coaching-cases.mjs';
let app,root;
before(async()=>{app=createDemoServer({port:0,allowLegacyShared:true});root=`http://127.0.0.1:${(await app.listen()).port}`;});
after(async()=>app.close());
const post=async(p,body)=>{const r=await fetch(root+'/api/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
const reset=async(scenarioId='otp',mode='guidance')=>(await post('reset',{scenarioId,mode})).data;
const args=s=>({runId:s.runId,expectedVersion:s.version});
async function call(p,s,more={}){const r=await post(p,{...args(s),...more});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
function evaluate(country,text){let s=createCase('case_eval');s=applyCaseEvent(s,{type:'UTTERANCE_FINAL',caseId:s.caseId,eventId:'evt_1',turnId:'u_1',revision:0,absoluteIndex:0,speaker:'caller',text});
 const g=selectLiveGuidance({caseState:s,jurisdiction:country});return {state:s,guide:g,care:selectActionCoaching({caseState:s,guidance:g,jurisdiction:country,emergency:getCaseView(s).assessment.emergencyFlag})};}
test('country and source choices use a strict allowlist, including UNKNOWN',()=>{
 for(const country of ['KR','US','UNKNOWN']){
  const {care}=evaluate(country,'인증번호를 저에게 알려주세요.');
  assert.equal(care.jurisdiction,country);assert.equal(care.externalActionAuthorized,false);
  assert.equal(care.identityVerified,false);assert.equal(care.realWorldOutcomeVerified,false);
  for(const id of care.sourceIds)assert.equal(sourceById(id).jurisdiction,country);
  if(country==='UNKNOWN'){assert.equal(care.sourceLinks.length,0);assert.doesNotMatch(care.primaryInstruction,/112|911|1394|118/);}
 }
});
test('English exact action request is classified through same canonical engine with US-only sources',()=>{
 for(const [text,kind] of [['Tell me your verification code.','CREDENTIALS'],['Install the remote-access app.','REMOTE'],['Wire the money now.','PAYMENT_HOLD'],['We kidnapped your son.','EMERGENCY']]){
  const {care}=evaluate('US',text);assert.equal(care.kind,kind,text);
  assert.ok(care.sourceIds.every(id=>sourceById(id).jurisdiction==='US'));
 }
});
test('English family claim without demand leads to independent checking, never verified family identity',()=>{
 const {care}=evaluate('US','Your grandson was injured in an accident.');
 assert.equal(care.kind,'VERIFY');assert.equal(care.identityVerified,false);
});
test('country selection is versioned, does not change case risk or scenario fixture',async()=>{
 let s=await reset('otp','guidance');s=await call('advance',s);
 const original={...s.risk},transcript=s.transcript;
 const stale={...args(s),jurisdiction:'US'};
 s=await call('jurisdiction',s,{jurisdiction:'US'});
 assert.equal(s.jurisdiction,'US');assert.equal(s.jurisdictionSource,'USER_SELECTED_UNVERIFIED');
 assert.equal(s.care.coaching.jurisdiction,'US');assert.equal(s.scenario.country,'KR');
 assert.equal(s.care.coaching.actionId,'US_OBSERVE');
 assert.deepEqual(s.risk,original);assert.deepEqual(s.transcript,transcript);
 assert.equal((await post('jurisdiction',stale)).status,409);
 assert.equal((await post('jurisdiction',{...args(s),jurisdiction:'CA'})).status,400);
 s=await call('jurisdiction',s,{jurisdiction:'UNKNOWN'});
 assert.equal(s.care.coaching.sourceLinks.length,0);
 assert.equal(s.recovery.sourceCountry,'UNKNOWN');
});
test('emergency overrides family safe report and recovery paths and stays jurisdiction-scoped',async()=>{
 let s=await reset('kidnap','verified');s=await call('advance',s);s=await call('advance',s);
 assert.equal(s.risk.emergency,true);assert.equal(s.care.coaching.kind,'EMERGENCY');
 s=await call('verification/request',s);s=await call('verification/respond',s,{requestId:s.verification.requestId,response:'SELF_REPORTED_SAFE'});
 assert.equal(s.care.coaching.kind,'EMERGENCY');assert.equal(s.care.emergencyGuidancePreserved,true);
 s=await call('jurisdiction',s,{jurisdiction:'US'});assert.equal(s.care.coaching.kind,'EMERGENCY');
 assert.ok(s.care.coaching.sourceIds.every(id=>sourceById(id).jurisdiction==='US'));
 s=await call('end',s);assert.equal(s.care.coaching.kind,'EMERGENCY');
});
test('baseline A warning mode still has no detailed advice/citations',async()=>{
 const s=await reset('otp','warning');assert.equal(s.care,null);assert.equal(s.guidance,null);
});
test('synthetic KR and US fixture contains 30 each, segregated split and no labels enter policy input',()=>{
 assert.equal(coachingCases.length,60);
 for(const c of ['KR','US']){
  const cases=coachingCases.filter(x=>x.country===c);assert.equal(cases.length,30);
  assert.equal(cases.filter(x=>x.split==='HOLDOUT').length,12);
  assert.equal(cases.filter(x=>x.category==='normal').length,10);
 }
 const ids=new Set(coachingCases.map(x=>x.id));assert.equal(ids.size,60);
});
