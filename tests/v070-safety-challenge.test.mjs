import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';

let app,root;
before(async()=>{app=createDemoServer({port:0,allowLegacyShared:true});const addr=await app.listen();root=`http://127.0.0.1:${addr.port}`;});
after(async()=>{await app.close();});
const get=async u=>{const r=await fetch(root+u);return {status:r.status,data:await r.json()};};
const post=async(u,body,headers={})=>{const r=await fetch(root+u,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
async function reset(scenarioId='kidnap',mode='verified'){const r=await post('/api/reset',{scenarioId,mode});assert.equal(r.status,200);return r.data;}
const args=s=>({runId:s.runId,expectedVersion:s.version});
async function next(s){const r=await post('/api/advance',args(s));assert.equal(r.status,200,r.data.error);return r.data;}

test('native Node server returns fiction-only boundary flags and three modes',async()=>{
 const s=await reset();assert.equal(s.provider,'SCRIPTED_MOCK');assert.equal(s.metaCalled,false);assert.equal(s.realMoneySent,false);
 const options=await get('/api/scenarios');assert.deepEqual(new Set(options.data.scenarios.map(s=>s.id)),new Set(['kidnap','bail','benign','otp','remote','uncertain']));assert.equal(options.data.modes.length,3);
});
test('incremental transcripts reveal exactly one finalized utterance per step',async()=>{
 let s=await reset();assert.equal(s.transcript.length,0);
 s=await next(s);assert.equal(s.transcript.length,1);assert.equal(s.risk.index>=0,true);
 s=await next(s);assert.equal(s.transcript.length,2);assert.equal(s.transcript[0].turnId,'turn_1');
 assert.equal(s.guidance.primary.id,'EMERGENCY_CONTACT_GUIDANCE');
 assert.equal(s.guidance.replyTemplateId,'NO_SCRIPT');assert.equal(s.guidance.replyText,null);
});
test('replay ignores stale case versions and keeps utterance unchanged',async()=>{
 let s=await reset();const old={...s};s=await next(s);
 const stale=await post('/api/advance',args(old));assert.equal(stale.status,409);
 const live=await get('/api/state');assert.equal(live.data.step,1);
});
test('previous run cannot alter replacement case',async()=>{
 const old=await reset();const current=await reset('bail');
 const bad=await post('/api/action',{...args(old),action:'SIMULATED_TRANSFER'});
 assert.equal(bad.status,409);const good=await get('/api/state');assert.equal(good.data.runId,current.runId);
});
test('family verification is real server state across distinct GET clients',async()=>{
 let s=await reset('kidnap','verified');
 const request=await post('/api/verification/request',args(s));assert.equal(request.status,200);
 s=request.data;assert.equal(s.verification.status,'REQUESTED');
 const child=await get('/api/state');assert.equal(child.data.verification.requestId,s.verification.requestId);
 const reply=await post('/api/verification/respond',{...args(s),requestId:s.verification.requestId,response:'SELF_REPORTED_SAFE'});
 assert.equal(reply.status,200);assert.equal(reply.data.verification.status,'SELF_REPORTED_SAFE');
 assert.equal(reply.data.verification.note.includes('안전 증명 아님'),true);
});
test('unanswered request can expire without implying abduction',async()=>{
 let s=await reset('bail','verified');s=await next(s);
 s=(await post('/api/verification/request',args(s))).data;
 s=(await post('/api/verification/expire',args(s))).data;
 assert.equal(s.verification.status,'EXPIRED');
 assert.equal(s.verification.note.includes('미확인'),true);
 assert.equal(s.risk.emergency,false);
 assert.equal(s.guidance.primary.id,'FAMILY_INDEPENDENT_VERIFY');
});
test('help request response remains unverified and never triggers a call',async()=>{
 let s=await reset();s=(await post('/api/verification/request',args(s))).data;
 s=(await post('/api/verification/respond',{...args(s),requestId:s.verification.requestId,response:'HELP_REQUESTED'})).data;
 assert.equal(s.verification.status,'HELP_REQUESTED');assert.equal(s.realMoneySent,false);
 assert.equal(s.metaCalled,false);
});
test('uncertain child response is not interpreted as kidnapping or safety',async()=>{
 let s=await reset();s=(await post('/api/verification/request',args(s))).data;
 s=(await post('/api/verification/respond',{...args(s),requestId:s.verification.requestId,response:'UNABLE_TO_CONFIRM'})).data;
 assert.equal(s.verification.note.includes('확인할 수 없다고'),true);
 assert.equal(s.risk.index,0); // child response alone does not fake a scam signal
});
test('early family emergency self-report cue produces only independent check, not emergency verdict',async()=>{
 let s=await reset('bail','guidance');s=await next(s);
 assert.equal(s.guidance.primary.id,'FAMILY_INDEPENDENT_VERIFY');
 assert.equal(s.risk.emergency,false);
});
test('verification request blocked in baseline and coaching-only arms',async()=>{
 for(const mode of ['warning','guidance']){
  const s=await reset('kidnap',mode);const r=await post('/api/verification/request',args(s));assert.equal(r.status,403);
 }
});
test('verification cannot be responded to twice, or with another request ID',async()=>{
 let s=await reset();s=(await post('/api/verification/request',args(s))).data;
 const invalid=await post('/api/verification/respond',{...args(s),requestId:'fake',response:'HELP_REQUESTED'});assert.equal(invalid.status,409);
 const reply=await post('/api/verification/respond',{...args(s),requestId:s.verification.requestId,response:'SELF_REPORTED_SAFE'});assert.equal(reply.status,200);
 const duplicate=await post('/api/verification/respond',{...args(reply.data),requestId:s.verification.requestId,response:'HELP_REQUESTED'});assert.equal(duplicate.status,409);
});
test('simulated money attempt changes canonical case action; no money moves',async()=>{
 let s=await reset('bail','guidance');
 s=(await post('/api/action',{...args(s),action:'SIMULATED_TRANSFER'})).data;
 assert.equal(s.review.fakeTransferAttempted,true);assert.equal(s.realMoneySent,false);
 assert.equal(s.guidance.primary.id,'DO_NOT_TRANSFER');
});
test('recovery opens only as a fictional user action',async()=>{
 let s=await reset('kidnap','warning');s=(await post('/api/action',{...args(s),action:'RECOVERY_OPEN'})).data;
 assert.equal(s.actions.at(-1).kind,'RECOVERY_OPEN');assert.equal(s.actions.at(-1).note.includes('가상'),true);
});
test('normal family conversation stays without false emergency action card',async()=>{
 let s=await reset('benign','guidance');for(let i=0;i<4;i++)s=await next(s);
 assert.equal(s.risk.emergency,false);assert.equal(s.guidance.primary.id,'UNCERTAIN_NO_HARD_WARNING');
});
test('normal speech cannot be advanced beyond scenario length',async()=>{
 let s=await reset();for(let i=0;i<4;i++)s=await next(s);
 const r=await post('/api/advance',args(s));assert.equal(r.status,409);
});
test('case is closed and does not accept late events',async()=>{
 let s=await reset();const end=await post('/api/end',args(s));assert.equal(end.status,200);
 s=end.data;assert.ok(s.endedAt);
 assert.equal((await post('/api/advance',args(s))).status,409);
 assert.equal((await post('/api/verification/request',args(s))).status,409);
});
test('server retains prior run summaries but never claims cohort effectiveness',async()=>{
 let s=await reset('bail','verified');s=(await post('/api/action',{...args(s),action:'STOP_TRANSFER'})).data;
 await post('/api/end',args(s));const report=await get('/api/report');
 assert.equal(report.status,200);assert.equal(report.data.runs.some(r=>r.runId===s.runId),true);
 assert.match(report.data.note,/실제 사기 예방 효과 데이터 아님/);
});
test('server refuses invalid scenario/mode and arbitrary action',async()=>{
 assert.equal((await post('/api/reset',{scenarioId:'hack',mode:'verified'})).status,400);
 assert.equal((await post('/api/reset',{scenarioId:'kidnap',mode:'unknown'})).status,400);
 const s=await reset();assert.equal((await post('/api/action',{...args(s),action:'REAL_TRANSFER'})).status,400);
});
test('server refuses wrong origin and JSON-independent content type',async()=>{
 const s=await reset();
 assert.equal((await post('/api/advance',args(s),{Origin:'https://example.org'})).status,403);
 const r=await fetch(root+'/api/advance',{method:'POST',headers:{'Content-Type':'text/plain'},body:'hello'});
 assert.equal(r.status,415);
});
test('server streams state changes over Server-Sent Events',async()=>{
 let s=await reset();const controller=new AbortController();
 const response=await fetch(root+'/api/events',{signal:controller.signal});
 assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
 const reader=response.body.getReader();const first=await reader.read();
 assert.match(Buffer.from(first.value).toString(),/event: state/);
 s=await next(s);const pushed=await reader.read();
 assert.match(Buffer.from(pushed.value).toString(),new RegExp(s.runId));
 controller.abort();try{await reader.cancel();}catch{}
});
test('static assets are local and unknown routes cannot read arbitrary files',async()=>{
 for(const asset of ['/','/styles.css','/app.js']){
   const r=await fetch(root+asset);assert.equal(r.status,200);assert.equal((await r.text()).length>100,true);
 }
 const secret=await fetch(root+'/package.json');assert.equal(secret.status,404);
});
