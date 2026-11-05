import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
let server,root;
before(async()=>{server=createDemoServer({port:0});root=`http://127.0.0.1:${(await server.listen()).port}`;});
after(async()=>await server.close());
const post=async(path,body={},auth=null)=>{const r=await fetch(root+path,{method:'POST',headers:{'content-type':'application/json',...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
const get=async(path,auth=null)=>{const r=await fetch(root+path,{headers:auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.token}:{}});return {status:r.status,data:await r.json()};};
async function make(scenarioId='benign',mode='verified'){const r=await post('/api/session/create',{scenarioId,mode});assert.equal(r.status,201,r.data.error);return {state:r.data,parent:{sessionId:r.data.sessionCredentials.sessionId,token:r.data.sessionCredentials.parentToken},child:{sessionId:r.data.sessionCredentials.sessionId,token:r.data.sessionCredentials.childToken}};}
const body=s=>({runId:s.runId,expectedVersion:s.version});
test('default server denies all unauthenticated case and SSE views, retains public static assets',async()=>{
 assert.equal((await get('/api/state')).status,403);
 assert.equal((await get('/api/report')).status,403);
 assert.equal((await get('/api/events')).status,403);
 assert.equal((await post('/api/reset',{scenarioId:'kidnap'})).status,403);
 assert.equal((await get('/api/scenarios')).status,200);
 const page=await fetch(root+'/');assert.equal(page.status,200);
});
test('sessions isolate transcript state, recovery progress, and independent run resets',async()=>{
 const a=await make('kidnap'),b=await make('benign');
 let sa=a.state,sb=b.state;
 sa=(await post('/api/advance',body(sa),a.parent)).data;
 assert.equal(sa.step,1);
 assert.equal((await get('/api/state',b.parent)).data.step,0);
 sa=(await post('/api/reset',{...body(sa),scenarioId:'otp',mode:'verified'},a.parent)).data;
 assert.equal(sa.scenario.id,'otp');
 assert.equal((await get('/api/state',b.parent)).data.runId,sb.runId);
 sb=(await post('/api/recovery/event',{...body(sb),eventId:'path_event_093',type:'CARE_PATH_SELECTED',pathId:'PAYMENT',expectedRecoveryVersion:sb.recovery.version},b.parent)).data;
 assert.equal(sb.recovery.selectedPath,'PAYMENT');assert.equal((await get('/api/state',a.parent)).data.recovery.selectedPath,null);
 assert.equal((await post('/api/action',{...body(sb),action:'END_CALL'},a.parent)).status,409);
});
test('tokens are scoped by session and parent vs child role',async()=>{
 const a=await make(),b=await make();
 assert.equal((await get('/api/state',{...a.parent,token:'bad'})).status,403);
 assert.equal((await get('/api/state',{...b.parent,token:a.parent.token})).status,403);
 assert.equal((await post('/api/advance',body(a.state),a.child)).status,403);
 assert.equal((await post('/api/verification/respond',{...body(a.state),requestId:'bad',response:'HELP_REQUESTED'},a.parent)).status,403);
 assert.equal((await post('/api/reset',{scenarioId:'kidnap',mode:'verified'},a.child)).status,403);
});
test('family HELP_REQUESTED changes top coaching without claiming verified emergency',async()=>{
 const a=await make('benign');
 let s=(await post('/api/verification/request',body(a.state),a.parent)).data;
 const requestId=s.verification.requestId;
 const rejectParent=await post('/api/verification/respond',{...body(s),requestId,response:'HELP_REQUESTED'},a.parent);
 assert.equal(rejectParent.status,403);
 const childResponse=(await post('/api/verification/respond',{...body(s),requestId,response:'HELP_REQUESTED'},a.child)).data;
 assert.equal(childResponse.verification.status,'HELP_REQUESTED');
 assert.equal(childResponse.transcript,undefined); // child cannot see private parent evidence
 s=(await get('/api/state',a.parent)).data;
 assert.equal(s.care.coaching.kind,'HELP_VERIFY');
 assert.equal(s.care.phase,'FAMILY_HELP_UNVERIFIED');
 assert.match(s.care.primary,/가상 가족|도움/);
 assert.equal(s.risk.emergency,false);assert.equal(s.care.coaching.identityVerified,false);
 assert.equal(s.externalActionPerformed,false);
 assert.equal((await get('/api/state',a.parent)).data.verification.status,'HELP_REQUESTED');
});
test('emergency cannot be removed by mock family self-report',async()=>{
 const a=await make('kidnap');let s=a.state;
 s=(await post('/api/advance',body(s),a.parent)).data;
 s=(await post('/api/advance',body(s),a.parent)).data;
 assert.equal(s.risk.emergency,true);
 s=(await post('/api/verification/request',body(s),a.parent)).data;
 const childResponse=(await post('/api/verification/respond',{...body(s),requestId:s.verification.requestId,response:'SELF_REPORTED_SAFE'},a.child)).data;
 assert.equal(childResponse.verification.status,'SELF_REPORTED_SAFE');
 assert.equal(childResponse.risk,undefined);
 s=(await get('/api/state',a.parent)).data;
 assert.equal(s.care.phase,'EMERGENCY');assert.equal(s.care.coaching.kind,'EMERGENCY');
});
test('screen unsafe is distinct from remote software request; user does not have to answer questions',async()=>{
 const a=await make();let s=a.state;
 s=(await post('/api/care/question/event',{...body(s),eventId:'unsafe093_event',type:'CARE_SCREEN_UNSAFE_REPORTED',caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version},a.parent)).data;
 assert.equal(s.careInteraction.screenUnsafe,true);
 assert.equal(s.care.coaching.kind,'SCREEN_UNSAFE');assert.match(s.care.primary,/이 화면|기기/);
 assert.equal(s.careInteraction.questionProposal.decision,'SKIP_UNSAFE');
});
test('remote access already granted uses different coaching from request only',async()=>{
 const a=await make();let s=a.state;
 s=(await post('/api/care/question/event',{...body(s),eventId:'present093_remote',type:'CARE_QUESTION_PRESENTED',questionId:'REQUEST_TYPE',caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version},a.parent)).data;
 s=(await post('/api/care/question/event',{...body(s),eventId:'answer093_remote',type:'CARE_QUESTION_ANSWERED',questionId:'REQUEST_TYPE',choiceId:'REMOTE',caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version},a.parent)).data;
 assert.equal(s.care.coaching.kind,'REMOTE');assert.equal(s.careInteraction.questionProposal.decision,'ASK');
 s=(await post('/api/care/question/event',{...body(s),eventId:'present093_status',type:'CARE_QUESTION_PRESENTED',questionId:'ACTION_STATUS',caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version},a.parent)).data;
 s=(await post('/api/care/question/event',{...body(s),eventId:'answer093_status',type:'CARE_QUESTION_ANSWERED',questionId:'ACTION_STATUS',choiceId:'DONE',caseVersion:s.careCaseVersion,expectedInteractionVersion:s.careInteraction.version},a.parent)).data;
 assert.equal(s.care.coaching.kind,'REMOTE_GRANTED');assert.match(s.care.primary,/이미 허용/);
});
test('SSE emits only the authorized session and does not broadcast other run events',async()=>{
 const a=await make(),b=await make();const ac=new AbortController();
 const url=root+'/api/events';
 const response=await fetch(url,{signal:ac.signal,headers:{'X-SafeCall-Session':a.parent.sessionId,'X-SafeCall-Token':a.parent.token}});assert.equal(response.status,200);const reader=response.body.getReader();
 let text='';const first=await reader.read();text+=new TextDecoder().decode(first.value);assert.match(text,new RegExp(a.state.runId));
 const sb=await post('/api/advance',body(b.state),b.parent);assert.equal(sb.status,200);
 // No cross-event read: a scoped subscriber only receives events from a.
 const sa=await post('/api/advance',body(a.state),a.parent);assert.equal(sa.status,200);
 const second=await reader.read();text=new TextDecoder().decode(second.value);assert.match(text,new RegExp(a.state.runId));assert.doesNotMatch(text,new RegExp(b.state.runId));
 ac.abort();await reader.cancel().catch(()=>{});
});
