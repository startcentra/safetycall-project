import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {newRecoveryProgress,recoveryView} from '../demo/safety-challenge/recovery.mjs';

let app,root;
before(async()=>{app=createDemoServer({port:0,allowLegacyShared:true});const addr=await app.listen();root=`http://127.0.0.1:${addr.port}`;});
after(async()=>{await app.close();});
const post=async(path,body)=>{const response=await fetch(root+'/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
const get=async(path)=>{const response=await fetch(root+'/api/'+path);return {status:response.status,data:await response.json()};};
async function reset(scenarioId='kidnap',mode='verified'){const r=await post('reset',{scenarioId,mode});assert.equal(r.status,200);return r.data;}
const args=s=>({runId:s.runId,expectedVersion:s.version});
async function call(path,s,other={}){const r=await post(path,{...args(s),...other});assert.equal(r.status,200,r.data.error);return r.data;}
let counter=0;
async function recovery(s,type,other={}){return call('recovery/event',s,{eventId:'rec_'+(++counter),type,expectedRecoveryVersion:s.recovery.version,pathId:s.recovery.selectedPath,...other});}

test('five explicit recovery paths are present with scoped official sources and no external execution',async()=>{
 const s=await reset();assert.deepEqual(s.recovery.paths.map(x=>x.id).sort(),['CREDENTIALS','IDENTITY','PAYMENT','REMOTE_ACCESS','UNKNOWN']);
 assert.equal(s.recovery.sourceCountry,'KR');assert.equal(s.recovery.externalActionPerformed,false);
 assert.equal(s.recovery.verifiedCompletion,false);assert.equal(s.recovery.realMoneySent,false);
 assert.ok(s.recovery.sources.every(x=>x.url.startsWith('https://')));
});
test('a recovery path and done/not-applicable/reopened steps work without changing case engine',async()=>{
 let s=await reset('benign','guidance');const initial={...s.risk},transcript=s.transcript;
 s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'PAYMENT'});
 assert.equal(s.recovery.version,1);assert.equal(s.recovery.selectedPath,'PAYMENT');assert.equal(s.recovery.steps.length,3);
 assert.equal(s.recovery.sources.length,1);assert.match(s.recovery.sources[0].url,/police\.go\.kr/);
 s=await recovery(s,'RECOVERY_STEP_MARKED',{stepId:'STOP',status:'DONE'});
 assert.equal(s.recovery.steps[0].status,'DONE');assert.equal(s.recovery.verifiedCompletion,false);
 s=await recovery(s,'RECOVERY_STEP_MARKED',{stepId:'PROVIDER',status:'NOT_APPLICABLE'});
 assert.equal(s.recovery.steps[1].status,'NOT_APPLICABLE');
 s=await recovery(s,'RECOVERY_STEP_REOPENED',{stepId:'STOP',status:'TODO'});
 assert.equal(s.recovery.steps[0].status,'TODO');assert.deepEqual(s.risk,initial);assert.deepEqual(s.transcript,transcript);
 s=await recovery(s,'RECOVERY_REVIEWED');assert.ok(s.recovery.reviewedAt);assert.equal(s.recovery.events.length,5);
});
test('recovery is accessible after case closure; risk, transcript and case outcome remain immutable',async()=>{
 let s=await reset('kidnap','verified');s=await call('advance',s);s=await call('advance',s);
 assert.equal(s.risk.emergency,true);s=await call('end',s);
 const closedRisk=s.risk,closedTranscript=s.transcript, closedEndedAt=s.endedAt;
 assert.equal(s.guidance.status,'CLOSED');assert.equal(s.care.emergencyGuidancePreserved,true);
 assert.equal(s.care.playbookActionId,'EMERGENCY_CONTACT_GUIDANCE');
 s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'UNKNOWN'});
 s=await recovery(s,'RECOVERY_STEP_MARKED',{stepId:'STOP',status:'DONE'});
 assert.equal(s.endedAt,closedEndedAt);assert.deepEqual(s.risk,closedRisk);assert.deepEqual(s.transcript,closedTranscript);
 assert.equal(s.recovery.steps[0].status,'DONE');assert.equal(s.care.phase,'EMERGENCY');
 assert.equal((await post('advance',args(s))).status,409);
 assert.equal((await post('care/check-in',{...args(s),concern:'UNSURE'})).status,409);
});
test('a closed benign case retains no threat verdict after recovery updates',async()=>{
 let s=await reset('benign','guidance');s=await call('end',s);
 assert.equal(s.care.phase,'CLOSED');s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'UNKNOWN'});
 assert.equal(s.care.phase,'CLOSED');assert.equal(s.risk.emergency,false);
});
test('two recovery pathways retain separate progress when switching',async()=>{
 let s=await reset();s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'PAYMENT'});
 s=await recovery(s,'RECOVERY_STEP_MARKED',{stepId:'STOP',status:'DONE'});
 s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'REMOTE_ACCESS'});
 s=await recovery(s,'RECOVERY_STEP_MARKED',{stepId:'SAFE_DEVICE',status:'DONE'});
 s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'PAYMENT'});
 assert.equal(s.recovery.steps[0].status,'DONE');
 s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'REMOTE_ACCESS'});
 assert.equal(s.recovery.steps.find(x=>x.id==='SAFE_DEVICE').status,'DONE');
});
test('same recovery event id with identical payload is idempotent even after global version changes',async()=>{
 let s=await reset();const original=s;
 const payload={...args(s),eventId:'recover_exact_replay',type:'CARE_PATH_SELECTED',expectedRecoveryVersion:s.recovery.version,pathId:'PAYMENT'};
 s=(await post('recovery/event',payload)).data;
 const after=await call('action',s,{action:'STOP_TRANSFER'});
 const dup=await post('recovery/event',payload);
 assert.equal(dup.status,200);assert.equal(dup.data.version,after.version);assert.equal(dup.data.recovery.version,1);
 assert.equal((await post('recovery/event',{...payload,pathId:'UNKNOWN'})).status,400);
 assert.equal((await post('recovery/event',{...args(original),eventId:'recover_new',type:'CARE_PATH_SELECTED',pathId:'UNKNOWN',expectedRecoveryVersion:0})).status,409);
});
test('stale recovery and global versions are rejected for new events',async()=>{
 let s=await reset();const prev=s;s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'PAYMENT'});
 assert.equal((await post('recovery/event',{...args(s),eventId:'stale_recovery',type:'RECOVERY_STEP_MARKED',pathId:'PAYMENT',stepId:'STOP',status:'DONE',expectedRecoveryVersion:0})).status,409);
 assert.equal((await post('recovery/event',{...args(prev),eventId:'stale_global',type:'CARE_PATH_SELECTED',pathId:'UNKNOWN',expectedRecoveryVersion:0})).status,409);
});
test('prior-case event and wrong case ID are rejected; data never mixes',async()=>{
 let s=await reset(),other=await reset('bail');
 assert.equal((await post('recovery/event',{...args(s),eventId:'other_case',type:'CARE_PATH_SELECTED',pathId:'PAYMENT',expectedRecoveryVersion:0})).status,409);
 assert.equal(other.recovery.selectedPath,null);
 other=await recovery(other,'CARE_PATH_SELECTED',{pathId:'UNKNOWN'});assert.equal(other.recovery.selectedPath,'UNKNOWN');
});
test('invalid types, forged step IDs, cross-path steps and illegal statuses are rejected',async()=>{
 let s=await reset();const base={...args(s),eventId:'recover_reject',type:'CARE_PATH_SELECTED',pathId:'__proto__',expectedRecoveryVersion:0};
 assert.equal((await post('recovery/event',base)).status,400);
 assert.equal((await post('recovery/event',{...base,eventId:'worse',type:'AUTO_TRANSFER',pathId:'PAYMENT'})).status,400);
 s=await recovery(s,'CARE_PATH_SELECTED',{pathId:'PAYMENT'});
 for(const extra of [
  {pathId:'REMOTE_ACCESS',stepId:'STOP',status:'DONE'},
  {pathId:'PAYMENT',stepId:'DOES_NOT_EXIST',status:'DONE'},
  {pathId:'PAYMENT',stepId:'STOP',status:'SEND_MONEY'},
  {pathId:'PAYMENT',stepId:'STOP',status:'TODO'}]){
   assert.equal((await post('recovery/event',{...args(s),type:'RECOVERY_STEP_MARKED',eventId:'invalid_'+extra.stepId+'_'+extra.status,expectedRecoveryVersion:s.recovery.version,...extra})).status,400);
 }
 assert.equal((await get('state')).data.recovery.version,s.recovery.version);
});
test('warning-only baseline denies recovery progress',async()=>{
 const s=await reset('kidnap','warning');assert.equal(s.recovery,null);
 assert.equal((await post('recovery/event',{...args(s),eventId:'baseline',type:'CARE_PATH_SELECTED',pathId:'PAYMENT',expectedRecoveryVersion:0})).status,403);
});
test('jurisdiction-specific sources are never mixed and unknown jurisdiction does not guess',async()=>{
 const kr=await reset('benign','guidance');const us=await reset('bail','guidance');
 assert.equal(kr.recovery.sourceCountry,'KR');assert.equal(us.recovery.sourceCountry,'US');
 assert.ok(us.recovery.sources.every(x=>x.url.includes('ftc.gov')||x.url.includes('identitytheft.gov')));
 assert.deepEqual(recoveryView(newRecoveryProgress('a_case'),'UNKNOWN').sources,[]);
});
test('OTP and remote access mock scenarios expose risk through canonical engine, without real-world effects',async()=>{
 for(const [scenario] of [['otp','CREDENTIAL_REQUEST'],['remote','REMOTE_CONTROL']]){
  let s=await reset(scenario,'guidance');for(let i=0;i<s.scenario.totalSteps;i++)s=await call('advance',s);
  assert.equal(s.scenario.id,scenario);assert.ok(s.risk.evidence>0);
  if(scenario==='remote'){assert.equal(s.care.phase,'EARLY_OBSERVATION');assert.equal(s.care.earlyCareEvidence.code,'REMOTE_CONTROL');assert.match(s.care.primary,/원격제어/);}
  assert.equal(s.metaCalled,false);assert.equal(s.realMoneySent,false);
  assert.equal(s.recovery.externalActionPerformed,false);
 }
});
test('v0.9.1 regression: isolated institutional claim is not prematurely escalated, while evidence stays observable',async()=>{
 let s=await reset('otp','guidance');s=await call('advance',s);
 assert.equal(s.care.phase,'OBSERVE');assert.equal(s.care.earlyCareNotFraudVerdict,true);
 assert.equal(s.care.earlyCareEvidence,null);assert.equal(s.risk.emergency,false);
 assert.equal(s.guidance.primary.id,'UNCERTAIN_NO_HARD_WARNING');
 assert.equal(s.care.coaching.actionId,'KR_OBSERVE');
});
test('normal everyday scenario has neither emergency nor observational authority cue',async()=>{
 let s=await reset('benign','guidance');for(let i=0;i<s.scenario.totalSteps;i++)s=await call('advance',s);
 assert.equal(s.care.phase,'OBSERVE');assert.equal(s.risk.emergency,false);
});
test('UI exposes explicit checklist, country citations and post-close access, without asserting completion',async()=>{
 const html=await (await fetch(root+'/')).text();const js=await (await fetch(root+'/app.js')).text();
 assert.match(html,/id="recovery-path"/);assert.match(html,/id="recovery-steps"/);
 assert.match(html,/완료 표시는 실제 조치 확인이 아닙니다/);
 assert.match(js,/RECOVERY_STEP_REOPENED/);assert.match(js,/session\.recoveryExpanded=true/);
 assert.match(js,/externalActionPerformed|verifiedCompletion|recovery\.sources/);
});
