import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {assessTriage} from '../src/modules/risk-triage/index.ts';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {readReplayFixture} from '../demo/safety-challenge/replay-fixture.mjs';
import {mediaById} from '../demo/safety-challenge/media-realtime.mjs';

const mediaDir=path.resolve('demo/safety-challenge/media');
async function req(base,path,auth,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.parentToken}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}

test('explicit English transfer of savings is recognized without misclassifying neutral savings inquiry',()=>{
 const scam=assessTriage({turns:[{speaker:'caller',text:'Do not tell your family. Transfer your savings to a protected account immediately.'}]});
 assert.equal(scam.riskBand,'HIGH');
 assert.ok(scam.signals.some(s=>s.code==='MONEY_REQUEST'));
 const neutral=assessTriage({turns:[{speaker:'caller',text:'We can discuss your savings account and transfer options during regular banking hours.'}]});
 assert.ok(!neutral.signals.some(s=>s.code==='MONEY_REQUEST'));
 assert.notEqual(neutral.riskBand,'HIGH');
});

for (const [id,highBy] of [['training-bank-20-en',9],['training-delivery-20-en',13]]){
 test(`${id}: 20 turns, early high risk, virtual bank protection, no Meta/STT`,async()=>{
  let now=0;const app=createDemoServer({mediaClockNow:()=>now,mediaAsrEnabled:false,metaConfig:{enabled:false,approved:false}});
  const {port}=await app.listen();const base=`http://127.0.0.1:${port}`;
  try {
   const created=await req(base,'/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'});assert.equal(created.status,201);
   const auth=created.data.sessionCredentials,runId=created.data.runId;
   const started=await req(base,'/api/media/replay',auth,{runId,expectedVersion:created.data.version,mediaId:id});assert.equal(started.status,202);
   const fixture=readReplayFixture(mediaById(id),mediaDir);
   assert.equal(fixture.turns.length,20);
   await req(base,'/api/media/clock',auth,{runId,mediaTimeMs:0,playing:true});
   let prev=0,firstHigh=null;
   for(const [i,turn] of fixture.turns.entries()){
    const target=turn.endMs+10;now+=target-prev;prev=target;
    const cr=await req(base,'/api/media/clock',auth,{runId,mediaTimeMs:target,playing:true});assert.equal(cr.status,200);
    const state=(await req(base,'/api/state',auth)).data;
    assert.equal(state.media.usableFinals,i+1);
    if(state.risk.band==='HIGH'&&firstHigh===null)firstHigh=i+1;
   }
   const duration=Math.round(mediaById(id).durationSeconds*1000);now+=duration-prev;
   await req(base,'/api/media/clock',auth,{runId,mediaTimeMs:duration,playing:false});
   const state=(await req(base,'/api/state',auth)).data;
   assert.ok(firstHigh!==null&&firstHigh<=highBy,`${id} high risk must be flagged by turn ${highBy}; got ${firstHigh}`);
   assert.equal(state.media.usableFinals,20);
   assert.equal(state.media.status,'COMPLETE');
   assert.equal(state.location.zone,'AT_BANK');
   assert.equal(state.protectionGate.blocked,true);
   assert.equal(state.media.actualStt,false);
   assert.equal(state.metaReview.status,'DISABLED');
   const glasses=await req(base,'/api/glasses/state',auth);assert.equal(glasses.data.severity,'HIGH');
   const transfer=await req(base,'/api/action',auth,{runId,expectedVersion:state.version,action:'SIMULATED_TRANSFER'});
   assert.equal(transfer.status,409);assert.equal(transfer.data.code,'POLICY_DENIED');
  }finally{await app.close()}
 });
}
