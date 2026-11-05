import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';

let host,server;
before(async()=>{server=createDemoServer({port:0});host=`http://127.0.0.1:${(await server.listen()).port}`;});
after(async()=>server.close());
async function call(path,{method='GET',auth,body}={}){
  const res=await fetch(host+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.token}:{})},body:body?JSON.stringify(body):undefined});
  const data=await res.json();return {status:res.status,data};
}
const post=(path,body,auth)=>call(path,{method:'POST',body,auth});
const payload=s=>({runId:s.runId,expectedVersion:s.version});
async function session(){const {status,data}=await post('/api/session/create',{scenarioId:'kidnap',mode:'verified'});assert.equal(status,201);return {
 state:data,parent:{sessionId:data.sessionCredentials.sessionId,token:data.sessionCredentials.parentToken},child:{sessionId:data.sessionCredentials.sessionId,token:data.sessionCredentials.childToken}};}
async function load(s,auth,id){const result=await post('/api/demo/scene/load',{...payload(s),sceneId:id},auth);assert.equal(result.status,200,result.data.error);return result.data;}

test('public runbook and readiness disclose MOCK with no live Meta calls',async()=>{
 const scenes=await call('/api/demo/scenes');assert.equal(scenes.status,200);assert.equal(scenes.data.scenes.length,4);
 assert.deepEqual(scenes.data.scenes.map(s=>s.id),['normal','early','family','recovery']);
 const readiness=await call('/api/readiness');assert.equal(readiness.status,200);
 assert.equal(readiness.data.metaCalled,false);assert.equal(readiness.data.liveVerified,false);
 assert.equal(readiness.data.providerInThisDemo,'SCRIPTED_MOCK');
 assert.equal((await call('/api/state')).status,403);
});
test('scene loading is parent-only and revision-scoped',async()=>{
 const a=await session(),b=await session();
 const body={...payload(a.state),sceneId:'early'};
 assert.equal((await post('/api/demo/scene/load',body)).status,403);
 assert.equal((await post('/api/demo/scene/load',body,a.child)).status,403);
 assert.equal((await post('/api/demo/scene/load',{...body,sceneId:'made-up'},a.parent)).status,400);
 assert.equal((await post('/api/demo/scene/load',{...body,runId:b.state.runId},a.parent)).status,409);
 const loaded=await load(a.state,a.parent,'early');
 assert.equal(loaded.scenario.id,'otp');assert.equal(loaded.mode,'guidance');
 assert.equal(loaded.sceneGuide.progress.done,1);
 assert.equal((await post('/api/demo/scene/load',body,a.parent)).status,409);
 assert.equal((await call('/api/state',{auth:b.parent})).data.runId,b.state.runId);
});
test('normal scene milestone is derived from observed transcript, not button-only fake progress',async()=>{
 const a=await session();let s=await load(a.state,a.parent,'normal');
 assert.equal(s.sceneGuide.progress.done,1);
 s=(await post('/api/advance',payload(s),a.parent)).data;
 assert.equal(s.sceneGuide.progress.done,2);
 while(s.step<s.scenario.totalSteps)s=(await post('/api/advance',payload(s),a.parent)).data;
 assert.equal(s.sceneGuide.completed,true);assert.equal(s.risk.emergency,false);
});
test('early care scene distinguishes user self-report from passive detection',async()=>{
 const a=await session();let s=await load(a.state,a.parent,'early');
 s=(await post('/api/care/check-in',{...payload(s),concern:'PAYMENT_OR_CODE'},a.parent)).data;
 assert.equal(s.step,0);assert.equal(s.sceneGuide.progress.done,2);assert.equal(s.metaCalled,false);
 s=(await post('/api/action',{...payload(s),action:'STOP_TRANSFER'},a.parent)).data;
 assert.equal(s.sceneGuide.completed,true);assert.equal(s.review.checkInBeforeObservedMoneyRequest,true);
 assert.equal(s.review.stoppedTransfer,true);assert.equal(s.realMoneySent,false);
});
test('family scene requires child role and exposes unverified HELP as safe primary coaching',async()=>{
 const a=await session();let s=await load(a.state,a.parent,'family');
 s=(await post('/api/verification/request',payload(s),a.parent)).data;
 assert.equal(s.sceneGuide.progress.done,2);
 const attempt=await post('/api/verification/respond',{...payload(s),response:'HELP_REQUESTED',requestId:s.verification.requestId},a.parent);
 assert.equal(attempt.status,403);
 const childResponse=(await post('/api/verification/respond',{...payload(s),response:'HELP_REQUESTED',requestId:s.verification.requestId},a.child)).data;
 assert.equal(childResponse.sceneGuide,undefined);
 s=(await call('/api/state',{auth:a.parent})).data;
 assert.equal(s.sceneGuide.completed,true);assert.equal(s.care.coaching.kind,'HELP_VERIFY');
 assert.equal(s.care.coaching.identityVerified,false);
});
test('recovery scene completes only after post-closure recovery review, does not reopen case',async()=>{
 const a=await session();let s=await load(a.state,a.parent,'recovery');
 s=(await post('/api/action',{...payload(s),action:'RECOVERY_OPEN'},a.parent)).data;
 s=(await post('/api/recovery/event',{...payload(s),eventId:'v100path',type:'CARE_PATH_SELECTED',pathId:'PAYMENT',expectedRecoveryVersion:s.recovery.version},a.parent)).data;
 assert.equal(s.sceneGuide.progress.done,3);
 s=(await post('/api/end',payload(s),a.parent)).data;
 assert.equal(s.sceneGuide.progress.done,4);
 const prevCase=s.careCaseVersion;
 s=(await post('/api/recovery/event',{...payload(s),eventId:'v100review',type:'RECOVERY_REVIEWED',pathId:'PAYMENT',expectedRecoveryVersion:s.recovery.version},a.parent)).data;
 assert.equal(s.sceneGuide.completed,true);assert.equal(s.careCaseVersion,prevCase);
 assert.equal(s.recovery.verifiedCompletion,false);
});
test('manual reset leaves presenter scene and session access separated',async()=>{
 const a=await session();let s=await load(a.state,a.parent,'normal');
 s=(await post('/api/reset',{...payload(s),scenarioId:'remote',mode:'guidance'},a.parent)).data;
 assert.equal(s.sceneGuide,null);
 assert.equal(s.scenario.id,'remote');
});
