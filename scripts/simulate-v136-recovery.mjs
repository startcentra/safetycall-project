/** v1.36 real local HTTP simulation (not OS SMS/real call/browser). */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
const output=[];
async function harness(scenarioId='benign'){
 const server=createDemoServer({port:0});const address=await server.listen();
 const base=`http://127.0.0.1:${address.port}`;
 const response=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,mode:'verified'})});
 assert.equal(response.status,201);let state=await response.json();
 const headers={'Content-Type':'application/json','X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.parentToken};
 async function cmd(path,data={}){const res=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({runId:state.runId,expectedVersion:state.version,...data})});
  const body=await res.json();assert.equal(res.status,200,`${path}: ${body.code}`);if(typeof body.version==='number')state=body;return body;}
 return {cmd,get state(){return state;},close:()=>server.close()};
}
const pass='v136 encrypted demo recovery passphrase';
const old=await harness('otp');let capsule;
try{
 await old.cmd('/api/messages/mock-receive',{fixtureId:'unknown-link',consented:true});
 for(let i=0;i<3;i++)await old.cmd('/api/advance');
 assert.equal(old.state.messages.entries[0].verdict,'QUARANTINED');
 const messageId=old.state.messages.entries[0].id;
 await old.cmd('/api/messages/review',{reviewId:'msg_review_'+randomUUID(),messageId,action:'RELEASE_PREVIEW',reason:'INDEPENDENT_OFFICIAL_CHECK_SELF_REPORTED',confirmed:true});
 assert.equal(old.state.messages.entries[0].verdict,'REVIEW_ONLY');
 await old.cmd('/api/messages/link-attempt',{messageId,attemptId:'msg_attempt_v136mock001'});
 assert.equal(old.state.messages.lastAttempt.blocked,false);
 await old.cmd('/api/advance');assert.equal(old.state.messages.entries[0].verdict,'QUARANTINED');
 output.push({scenario:'HIGH_CALL_CONTEXTUAL_MESSAGE',result:'PASS',reason:'evidence update revokes self-reported review; no external URL opened'});
 await old.cmd('/api/action',{action:'END_CALL'});
 await old.cmd('/api/postcall/answer',{question:'codeShared',answer:'YES'});
 capsule=(await old.cmd('/api/postcall/export',{passphrase:pass,consented:true})).capsule;
 assert.equal(typeof capsule,'string');
 output.push({scenario:'POSTCALL_USER_MANAGED_BACKUP',result:'PASS',reason:'opt-in AES-256-GCM capsule; original mock finance untouched'});
}finally{await old.close()}
const fresh=await harness('benign');
try{
 await fresh.cmd('/api/action',{action:'END_CALL'});
 await fresh.cmd('/api/postcall/import',{capsule,passphrase:pass,consented:true});
 assert.equal(fresh.state.postCall.answers.codeShared,'YES');
 assert.equal(fresh.state.safeBank.status,'READY');assert.equal(fresh.state.mockCard.status,'ACTIVE');
 output.push({scenario:'SERVER_RESTART_NEW_CASE_RECOVERY',result:'PASS',reason:'new isolated session self-report only'});
 await fresh.cmd('/api/postcall/delete',{scope:'POSTCALL_ONLY',confirmed:true});
 assert.deepEqual(fresh.state.postCall.answers,{});
 output.push({scenario:'SELECTIVE_DELETION',result:'PASS',reason:'delete self-report without making external actions'});
}finally{await fresh.close()}
console.log(JSON.stringify({mode:'LOCAL_HTTP_MOCK_ONLY',scenarioCount:output.length,status:'PASS',realPhoneSmsBlock:false,externalUrlNavigation:false,realMoneyActions:false,scenarios:output},null,2));
