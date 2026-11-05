import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {deriveCarePlan} from '../demo/safety-challenge/care-plan.mjs';

let app,root;
before(async()=>{app=createDemoServer({port:0,allowLegacyShared:true});const addr=await app.listen();root=`http://127.0.0.1:${addr.port}`;});
after(async()=>{await app.close();});
const get=async u=>{const r=await fetch(root+u);return {status:r.status,data:await r.json()};};
const post=async(u,body)=>{const r=await fetch(root+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
async function reset(scenarioId='kidnap',mode='verified'){
 const r=await post('/api/reset',{scenarioId,mode});assert.equal(r.status,200);return r.data;
}
const args=s=>({runId:s.runId,expectedVersion:s.version});
async function call(endpoint,s,extra={}){const r=await post('/api/'+endpoint,{...args(s),...extra});assert.equal(r.status,200,r.data.error);return r.data;}

test('direct family care starts without phone or transcripts, and does not fabricate a threat',async()=>{
 let s=await reset();assert.equal(s.step,0);assert.equal(s.care.phase,'OBSERVE');
 s=await call('care/check-in',s,{concern:'FAMILY_CONCERN'});
 assert.equal(s.step,0);assert.equal(s.risk.index,0);assert.equal(s.risk.emergency,false);
 assert.equal(s.care.phase,'EARLY_CARE');assert.match(s.care.primary,/평소 알고 있던/);
 assert.equal(s.care.userReportUnverified,true);
 assert.equal(s.care.realWorldActionAuthorized,false);
 assert.equal(s.review.careCheckInRequested,true);
 assert.equal(s.review.checkInBeforeObservedMoneyRequest,true);
 assert.equal(s.guidance.primary.id,'UNCERTAIN_NO_HARD_WARNING');
});
test('payment or code check-in gives low-regret pause guidance before any demand evidence',async()=>{
 let s=await reset('benign','guidance');s=await call('care/check-in',s,{concern:'PAYMENT_OR_CODE'});
 assert.equal(s.care.phase,'EARLY_CARE');assert.match(s.care.primary,/송금하거나 인증번호/);
 assert.equal(s.risk.index,0);assert.equal(s.care.playbookActionId,'UNCERTAIN_NO_HARD_WARNING');
 assert.equal(s.care.verificationIsAuthenticated,false);
});
test('unsure self report is never interpreted as a crime',async()=>{
 let s=await reset('benign','verified');s=await call('care/check-in',s,{concern:'UNSURE'});
 assert.equal(s.care.phase,'EARLY_CARE');assert.match(s.care.primary,/위험을 단정하지/);
 for(let i=0;i<4;i++)s=await call('advance',s);
 assert.equal(s.risk.emergency,false);assert.equal(s.care.phase,'EARLY_CARE');
});
test('first actual family claim replaces optional self-report advice with grounded family verification',async()=>{
 let s=await reset('bail','guidance');s=await call('care/check-in',s,{concern:'UNSURE'});
 s=await call('advance',s);
 assert.equal(s.care.phase,'VERIFY');
 assert.equal(s.care.playbookActionId,'FAMILY_INDEPENDENT_VERIFY');
 assert.deepEqual(s.care.evidenceUtteranceIds,['turn_1']);
});
test('emergency guidance is never hidden by family self-reported safe response',async()=>{
 let s=await reset('kidnap','verified');s=await call('advance',s);s=await call('advance',s);
 assert.equal(s.care.phase,'EMERGENCY');
 const emergency=s.care.primary;
 s=await call('verification/request',s);
 s=await call('verification/respond',s,{requestId:s.verification.requestId,response:'SELF_REPORTED_SAFE'});
 assert.equal(s.care.phase,'EMERGENCY');assert.equal(s.care.primary,emergency);
 assert.equal(s.care.emergencyGuidancePreserved,true);assert.equal(s.care.playbookActionId,'EMERGENCY_CONTACT_GUIDANCE');
 assert.match(s.care.verificationNotice,/안전하다고 자가 보고/);
 assert.match(s.care.nextStep,/긴급기관/);assert.equal(s.care.verificationIsAuthenticated,false);
});
test('even family help requests do not authorize outside actions; remain separate from safety guidance',async()=>{
 let s=await reset();s=await call('verification/request',s);
 s=await call('verification/respond',s,{requestId:s.verification.requestId,response:'HELP_REQUESTED'});
 assert.equal(s.risk.emergency,false);assert.equal(s.care.phase,'OBSERVE');
 assert.match(s.care.verificationNotice,/도움을 요청/);
 assert.equal(s.care.realWorldActionAuthorized,false);assert.equal(s.metaCalled,false);
});
test('family no-response is not treated as danger or safety and provides another safe verification step',async()=>{
 let s=await reset('bail','verified');s=await call('advance',s);
 s=await call('verification/request',s);s=await call('verification/expire',s);
 assert.equal(s.care.phase,'VERIFY');assert.match(s.care.verificationNotice,/미응답은 안전 또는 납치의 증거가 아닙니다/);
 assert.equal(s.risk.emergency,false);
});
test('aftercare is a user-selected explanation, not a claim of financial harm',async()=>{
 let s=await reset('benign','guidance');s=await call('action',s,{action:'RECOVERY_OPEN'});
 assert.equal(s.care.phase,'AFTERCARE');assert.match(s.care.basis,/실제 피해 주장 아님/);
 assert.equal(s.realMoneySent,false);
});
test('emergency retains higher priority than aftercare and user check-in',async()=>{
 let s=await reset();s=await call('advance',s);s=await call('advance',s);
 s=await call('action',s,{action:'RECOVERY_OPEN'});
 s=await call('care/check-in',s,{concern:'UNSURE'});
 assert.equal(s.care.phase,'EMERGENCY');assert.equal(s.care.playbookActionId,'EMERGENCY_CONTACT_GUIDANCE');
});
test('warning-only comparison refuses proactive care; arbitrary strings refused',async()=>{
 let s=await reset('kidnap','warning');assert.equal(s.care,null);
 assert.equal((await post('/api/care/check-in',{...args(s),concern:'FAMILY_CONCERN'})).status,403);
 s=await reset('kidnap','verified');
 assert.equal((await post('/api/care/check-in',{...args(s),concern:'REAL_TRANSFER'})).status,400);
 assert.equal((await post('/api/care/check-in',{...args(s),concern:'__proto__'})).status,400);
});
test('care events respect run identity, expected version, and idempotent re-selection',async()=>{
 let s=await reset();const old=s;s=await call('care/check-in',s,{concern:'FAMILY_CONCERN'});
 assert.equal((await post('/api/care/check-in',{...args(old),concern:'UNSURE'})).status,409);
 const again=await call('care/check-in',s,{concern:'FAMILY_CONCERN'});
 assert.equal(again.version,s.version);
 const replaced=await reset();assert.equal((await post('/api/care/check-in',{...args(s),concern:'UNSURE'})).status,409);
 assert.equal(replaced.concern,null);
});
test('UI exposes care check-in and separate verification notice for distinct statuses',async()=>{
 const {status}=await get('/api/state');assert.equal(status,200);
 const r=await fetch(root+'/');const html=await r.text();
 assert.match(html,/data-concern="FAMILY_CONCERN"/);
 assert.match(html,/id="verification-note"/);
 const js=await (await fetch(root+'/app.js')).text();
 assert.match(js,/care\?\.primary/);assert.match(js,/verification-note/);
});
test('care policy independently guards emergency precedence with conflicting mock input',()=>{
 const guidance={primary:{id:'EMERGENCY_CONTACT_GUIDANCE',userAction:'긴급 연락 우선',sourceIds:[],evidenceUtteranceIds:[]},secondary:null,status:'ACTIVE'};
 const care=deriveCarePlan({mode:'verified',guidance,risk:{emergency:true},verification:{status:'SELF_REPORTED_SAFE'},concern:{type:'UNSURE'},actions:[{kind:'RECOVERY_OPEN'}]});
 assert.equal(care.phase,'EMERGENCY');assert.equal(care.primary,'긴급 연락 우선');
 assert.equal(care.verificationIsAuthenticated,false);
});
