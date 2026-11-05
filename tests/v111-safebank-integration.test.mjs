import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
async function harness(){
 const app=createDemoServer({port:0});const {port}=await app.listen();const base='http://127.0.0.1:'+port;
 const post=async(path,body={},auth=null)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const created=await post('/api/session/create',{scenarioId:'benign',mode:'verified'});assert.equal(created.status,201);
 const c=created.data.sessionCredentials;return {app,post,state:created.data,parent:{sessionId:c.sessionId,token:c.parentToken},child:{sessionId:c.sessionId,token:c.childToken}};
}
const at=s=>({runId:s.runId,expectedVersion:s.version});
const command=(s,type,changes={})=>({...at(s),type,confirmed:true,commandId:'cmd_'+type,expectedBankRevision:s.safeBank.revision,...changes});
test('banking commands require parent authorization and remain isolated from child role',async()=>{
 const h=await harness();try{
  assert.equal((await h.post('/api/safebank/command',command(h.state,'ARRIVAL_CONFIRM'))).status,403);
  assert.equal((await h.post('/api/safebank/command',command(h.state,'ARRIVAL_CONFIRM'),h.child)).status,403);
  const denied=await h.post('/api/safebank/command',command(h.state,'HOLD'),h.parent);
  assert.equal(denied.status,409);assert.equal(denied.data.error.includes('arrival'),true);
 }finally{await h.app.close();}
});
test('self-reported arrival does not by itself approve mock transfer',async()=>{
 const h=await harness();try{
  let s=h.state;
  let r=await h.post('/api/safebank/command',command(s,'ARRIVAL_CONFIRM'),h.parent);
  assert.equal(r.status,200);s=r.data;assert.equal(s.bankArrivalConfirmed,true);
  r=await h.post('/api/safebank/command',command(s,'HOLD'),h.parent);
  assert.equal(r.status,409);
  r=await h.post('/api/safebank/command',command(s,'ASSIST_CONSENT'),h.parent);
  assert.equal(r.status,409); // Benign case has no active suspicious caller evidence.
  assert.equal(s.safeBank.status,'READY');
 }finally{await h.app.close();}
});
test('explicit affirmative consent required; stale UI and closed case denied',async()=>{
 const h=await harness();try{
  let s=h.state;
  assert.equal((await h.post('/api/safebank/command',command(s,'ARRIVAL_CONFIRM',{confirmed:false}),h.parent)).status,400);
  let r=await h.post('/api/safebank/command',command(s,'ARRIVAL_CONFIRM'),h.parent);
  assert.equal(r.status,200);
  assert.equal((await h.post('/api/safebank/command',command(s,'ASSIST_CONSENT'),h.parent)).status,409);
  s=r.data;r=await h.post('/api/end',at(s),h.parent);assert.equal(r.status,200);
  assert.equal((await h.post('/api/safebank/command',command(r.data,'HOLD'),h.parent)).status,409);
 }finally{await h.app.close();}
});
test('changing scenario resets fictional banking and arrival confirmation',async()=>{
 const h=await harness();try{
  let r=await h.post('/api/safebank/command',command(h.state,'ARRIVAL_CONFIRM'),h.parent);
  assert.equal(r.status,200);const old=r.data;
  r=await h.post('/api/reset',{...at(old),scenarioId:'otp',mode:'verified'},h.parent);
  assert.equal(r.status,200);assert.equal(r.data.safeBank.status,'READY');assert.equal(r.data.bankArrivalConfirmed,false);
  assert.notEqual(r.data.runId,old.runId);
 }finally{await h.app.close();}
});

test('risk scenario mock bank flow: explicit arrival, consent, hold, cancellation',async()=>{
 const h=await harness();try{
  let r=await h.post('/api/reset',{...at(h.state),scenarioId:'bail',mode:'verified'},h.parent);
  assert.equal(r.status,200);let s=r.data;
  for(let i=0;i<4;i++){r=await h.post('/api/advance',at(s),h.parent);assert.equal(r.status,200);s=r.data;}
  assert.notEqual(s.risk.band,'LOW');
  r=await h.post('/api/safebank/command',command(s,'ARRIVAL_CONFIRM'),h.parent);
  assert.equal(r.status,200);s=r.data;
  r=await h.post('/api/safebank/command',command(s,'ASSIST_CONSENT'),h.parent);
  assert.equal(r.status,200);s=r.data;
  r=await h.post('/api/safebank/command',command(s,'HOLD'),h.parent);
  assert.equal(r.status,200);s=r.data;assert.equal(s.safeBank.status,'HELD');
  r=await h.post('/api/safebank/command',command(s,'CANCEL'),h.parent);
  assert.equal(r.status,200);assert.equal(r.data.safeBank.status,'CANCELLED');
  assert.equal(r.data.realMoneySent,false);assert.equal(r.data.externalActionPerformed,false);
 }finally{await h.app.close();}
});
