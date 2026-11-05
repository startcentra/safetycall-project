import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
let app,root;
before(async()=>{app=createDemoServer({port:0,allowLegacyShared:true});const a=await app.listen();root=`http://127.0.0.1:${a.port}`;});
after(async()=>{await app.close();});
const post=async(u,b)=>{const r=await fetch(root+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return{status:r.status,data:await r.json()};};
const args=s=>({runId:s.runId,expectedVersion:s.version});
test('v1.2 mobile shell assets served with CSP, no secrets, legacy UI preserved',async()=>{
  for(const p of ['/mobile','/mobile.css','/mobile.js','/']){const r=await fetch(root+p);assert.equal(r.status,200,p);assert.match(r.headers.get('content-security-policy')||'',/default-src 'self'/);}
  const html=await (await fetch(root+'/mobile')).text();const js=await (await fetch(root+'/mobile.js')).text();
  for(const id of ['view-home','view-phone','view-guard','view-bank','view-map','view-activity'])assert.ok(html.includes(id),id);
  assert.ok(!/MODEL_API_KEY|api\.meta\.ai/.test(js),'mobile client must not call Meta or hold keys');
  assert.ok(js.includes('/api/events')&&js.includes("api('session/create'"),'shared session+SSE contract');
});
test('one Case ID flows phone->guard->SafeBank HOLD (server-approved)',async()=>{
  let s=(await post('/api/reset',{scenarioId:'otp',mode:'verified'})).data;const caseId=s.runId;
  for(let i=0;i<4;i++)s=(await post('/api/advance',args(s))).data;
  assert.equal(s.runId,caseId);assert.notEqual(s.risk.band,'LOW');
  // HOLD without arrival/consent must be rejected by server policy
  const early=await post('/api/safebank/command',{...args(s),type:'HOLD',confirmed:true,commandId:'v120_early',expectedBankRevision:s.safeBank.revision});assert.equal(early.status,409);
  s=(await post('/api/safebank/command',{...args(s),type:'ARRIVAL_CONFIRM',confirmed:true,commandId:'v120_a',expectedBankRevision:s.safeBank.revision})).data;
  s=(await post('/api/safebank/command',{...args(s),type:'ASSIST_CONSENT',confirmed:true,commandId:'v120_c',expectedBankRevision:s.safeBank.revision})).data;
  s=(await post('/api/safebank/command',{...args(s),type:'HOLD',confirmed:true,commandId:'v120_h',expectedBankRevision:s.safeBank.revision})).data;
  assert.equal(s.safeBank.status,'HELD');assert.equal(s.safeBank.activity.at(-1).kind,'HOLD');
  // stale version rejected; closed case rejects new bank commands
  assert.equal((await post('/api/advance',{runId:caseId,expectedVersion:0})).status,409);
  s=(await post('/api/end',args(s))).data;assert.ok(s.endedAt);
  assert.equal((await post('/api/safebank/command',{...args(s),type:'CANCEL',confirmed:true,commandId:'v120_x',expectedBankRevision:s.safeBank.revision})).status,409);
});
test('benign scenario: no risk evidence => bank protection denied',async()=>{
  let s=(await post('/api/reset',{scenarioId:'benign',mode:'verified'})).data;
  for(let i=0;i<4;i++)s=(await post('/api/advance',args(s))).data;
  assert.equal(s.risk.band,'LOW');
  const r=await post('/api/safebank/command',{...args(s),type:'HOLD',confirmed:true,commandId:'v120_benign',expectedBankRevision:s.safeBank.revision});assert.equal(r.status,409);
});
