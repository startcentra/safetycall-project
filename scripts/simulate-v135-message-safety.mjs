/** Reproducible HTTP-level scenario simulation. No real SMS, URLs, AI, money, GPS or voice.
 * node --experimental-strip-types scripts/simulate-v135-message-safety.mjs
 */
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';

const app=createDemoServer({port:0});const {port}=await app.listen();const base=`http://127.0.0.1:${port}`;
const results=[];
async function scenario(label,scenarioId,action){
 const r=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,mode:'verified'})});
 assert.equal(r.status,201);let state=await r.json();const sessionId=state.sessionCredentials.sessionId;
 const headers={'Content-Type':'application/json','X-SafeCall-Session':sessionId,'X-SafeCall-Token':state.sessionCredentials.parentToken};
 async function cmd(path,data={}){const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({runId:state.runId,expectedVersion:state.version,...data})});
  const payload=await response.json();if(response.status!==200)throw new Error(`${label}:${path}:${response.status}:${payload.code}`);state=payload;return payload;}
 try{
  const note=await action({cmd,get state(){return state;}});
  results.push({label,caseId:state.runId,callRiskBand:state.risk.band,callEnded:!!state.callEndedAt,
   quarantinedMessages:state.messages.entries.filter(x=>x.verdict==='QUARANTINED').length,
   postCallStatus:state.postCall.status,afterCallActions:state.postCall.steps.map(x=>x.id),
   mockCardStatus:state.mockCard.status,mockBankStatus:state.safeBank.status,realExternalActions:state.externalActionPerformed,note});
  assert.equal(state.externalActionPerformed,false);assert.equal(state.mockCard.status,'ACTIVE');assert.equal(state.safeBank.status,'READY');
 }finally{
  await fetch(base+'/api/session/close',{method:'POST',headers,body:'{}'});
 }
}
try{
 await scenario('OTP_CALL_HIGH_PLUS_UNKNOWN_LINK','otp',async h=>{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'unknown-link',consented:true});
  for(let i=0;i<4;i++)await h.cmd('/api/advance');assert.equal(h.state.risk.band,'HIGH');
  assert.equal(h.state.messages.entries[0].verdict,'QUARANTINED');
  await h.cmd('/api/messages/link-attempt',{messageId:h.state.messages.entries[0].id,attemptId:'msg_attempt_safety001'});
  assert.equal(h.state.messages.lastAttempt.blocked,true);
  await h.cmd('/api/action',{action:'END_CALL'});await h.cmd('/api/postcall/answer',{question:'codeShared',answer:'YES'});
  assert.ok(h.state.postCall.steps.some(s=>s.id==='CONTACT_FINANCIAL_PROVIDER'));
  return 'high-risk call contextual link quarantine plus credential exposure playbook';
 });
 await scenario('BENIGN_CALL_AND_NORMAL_PARCEL','benign',async h=>{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-normal',consented:true});
  assert.equal(h.state.messages.entries[0].verdict,'REVIEW_ONLY');
  await h.cmd('/api/action',{action:'END_CALL'});
  assert.deepEqual(h.state.postCall.steps.map(s=>s.id),['OPTIONAL_REVIEW']);
  return 'normal parcel not flagged, no intrusive post-call warning';
 });
 await scenario('SCAM_PARCEL_LINK_NO_CALL_EVIDENCE','benign',async h=>{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-bait',consented:true});
  assert.equal(h.state.risk.band,'LOW');assert.equal(h.state.messages.entries[0].verdict,'QUARANTINED');
  await h.cmd('/api/action',{action:'END_CALL'});
  assert.ok(h.state.postCall.steps.some(s=>s.id==='VERIFY_OFFICIAL'));
  return 'message-level suspicious requests can quarantine without falsifying call risk';
 });
 await scenario('REMOTE_CONTROL_SELF_REPORT','remote',async h=>{
  await h.cmd('/api/action',{action:'END_CALL'});await h.cmd('/api/postcall/answer',{question:'remoteInstalled',answer:'YES'});
  assert.ok(h.state.postCall.steps.some(s=>s.id==='DEVICE_REVIEW'));
  return 'remote application concern yields device review, does not uninstall anything';
 });
 await scenario('CARD_EXPOSURE_SELF_REPORT','otp',async h=>{
  await h.cmd('/api/action',{action:'CARD_EXPOSURE_REPORTED'});await h.cmd('/api/action',{action:'END_CALL'});
  assert.ok(h.state.postCall.steps.some(s=>s.id==='CONTACT_FINANCIAL_PROVIDER'));
  return 'card exposure guidance without automatic card lock or transfer hold';
 });
 await scenario('KIDNAP_EMERGENCY_SAFETY_PRIORITY','kidnap',async h=>{
  for(let i=0;i<3&&!h.state.risk.emergency;i++)await h.cmd('/api/advance');
  assert.equal(h.state.risk.emergency,true);
  await h.cmd('/api/action',{action:'END_CALL'});
  assert.equal(h.state.postCall.steps[0].id,'EMERGENCY_SAFETY');
  return 'urgent physical safety guidance takes precedence over banking';
 });
 console.log(JSON.stringify({mode:'LOCAL_MOCK_ONLY',cases:results.length,externalNetworkRequests:0,actualSmsRead:false,actualOsLinkBlock:false,
   tests:results,status:'PASS'},null,2));
}finally{await app.close();}
