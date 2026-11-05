import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';

async function harness(scenarioId='bail'){
 const app=createDemoServer({port:0});
 const {port}=await app.listen();
 const base='http://127.0.0.1:'+port;
 const post=async(path,body={},auth)=>{
  const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',
    ...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.token}:{})},body:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
 };
 const created=await post('/api/session/create',{scenarioId,mode:'verified'});
 assert.equal(created.status,201);
 const c=created.data.sessionCredentials;
 return {app,post,initial:created.data,auth:{sessionId:c.sessionId,token:c.parentToken}};
}
const at=s=>({runId:s.runId,expectedVersion:s.version});
const bank=(s,type,id)=>({...at(s),type,confirmed:true,commandId:id,expectedBankRevision:s.safeBank.revision});
async function ready(h){
 let s=h.initial;
 for(let i=0;i<4;i++){
  const x=await h.post('/api/advance',at(s),h.auth);
  assert.equal(x.status,200);s=x.data;
 }
 for(const type of ['ARRIVAL_CONFIRM','ASSIST_CONSENT']){
  const x=await h.post('/api/safebank/command',bank(s,type,'stage_'+type),h.auth);
  assert.equal(x.status,200);s=x.data;
 }
 return s;
}
test('lost response followed by same HOLD command is idempotent',async()=>{
 const h=await harness();
 try{
  let s=await ready(h);
  const original=bank(s,'HOLD','retry_safe_1');
  const held=await h.post('/api/safebank/command',original,h.auth);
  assert.equal(held.status,200);assert.equal(held.data.safeBank.status,'HELD');
  const again=await h.post('/api/safebank/command',original,h.auth);
  assert.equal(again.status,200);
  assert.equal(again.data.version,held.data.version);
  assert.deepEqual(again.data.safeBank.activity,held.data.safeBank.activity);
 }finally{await h.app.close();}
});
test('country change clears assistance consent and prevents HOLD until reconsent',async()=>{
 const h=await harness();
 try{
  const s=await ready(h);
  const changed=await h.post('/api/jurisdiction',{...at(s),jurisdiction:'KR'},h.auth);
  assert.equal(changed.status,200);
  assert.equal(changed.data.bankHelpConsented,false);
  const denied=await h.post('/api/safebank/command',bank(changed.data,'HOLD','no_consent'),h.auth);
  assert.equal(denied.status,409);
 }finally{await h.app.close();}
});
test('caller evidence revision invalidates previous bank arrival and staff approval',async()=>{
 const h=await harness();
 try{
  let s=h.initial;
  for(let i=0;i<2;i++){
   const x=await h.post('/api/advance',at(s),h.auth);assert.equal(x.status,200);s=x.data;
  }
  let x=await h.post('/api/safebank/command',bank(s,'ARRIVAL_CONFIRM','arrival'),h.auth);
  assert.equal(x.status,200);s=x.data;
  x=await h.post('/api/advance',at(s),h.auth);assert.equal(x.status,200);s=x.data;
  assert.notEqual(s.bankArrivalVersion,s.careCaseVersion);
  x=await h.post('/api/safebank/command',bank(s,'ASSIST_CONSENT','stale'),h.auth);
  assert.equal(x.status,409);
 }finally{await h.app.close();}
});

test('replayed command ID with changed type or consent fails with HTTP 409',async()=>{
 const h=await harness();
 try{
  const state=await ready(h);
  const original=bank(state,'HOLD','integrity_1');
  const once=await h.post('/api/safebank/command',original,h.auth);
  assert.equal(once.status,200);
  const changedConsent=await h.post('/api/safebank/command',{...original,confirmed:false},h.auth);
  assert.equal(changedConsent.status,409);
  const changedType=await h.post('/api/safebank/command',{...original,type:'CANCEL'},h.auth);
  assert.equal(changedType.status,409);
  assert.equal(changedType.data.error.includes('Conflicting'),true);
 }finally{await h.app.close();}
});
