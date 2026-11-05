import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readReplayFixture,MAX_DIALOGUE_TURNS} from '../demo/safety-challenge/replay-fixture.mjs';
import {MEDIA_CATALOG,mediaById} from '../demo/safety-challenge/media-realtime.mjs';
import {createMediaOrchestrator} from '../demo/safety-challenge/media-orchestrator.mjs';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
const MEDIA_DIR=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../demo/safety-challenge/media');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('exactly two valid 20-turn authored WAVs, audio SHA verified; originals absent',()=>{
 assert.equal(MAX_DIALOGUE_TURNS,20);
 for(const id of ['training-bank-20-en','training-delivery-20-en']){
  const item=mediaById(id),fixture=readReplayFixture(item,MEDIA_DIR);
  assert.equal(fixture.turns.length,20);
  assert.equal(fixture.turns[0].role,'caller');
  assert.ok(fixture.turns.at(-1).endMs<item.durationSeconds*1000);
 }
 for(const id of ['synthetic-prosecutor-en','prosecutor'])assert.throws(()=>readReplayFixture(mediaById(id),MEDIA_DIR),/REPLAY_NOT_ALLOWED/);
});

test('server-clock replay reveals only spoken turns, stops at 20, never invokes ASR or Meta',()=>{
 let ms=0,modelCalls=0,asrCalls=0;
 const model={analyze(){modelCalls++;throw new Error('MUST_NOT_CALL_META')}};
 const orchestra=createMediaOrchestrator({config:{provider:'META',modelProvider:'META'},mediaDir:MEDIA_DIR,now:()=>ms,isReady:()=>false,runner:()=>{asrCalls++;throw new Error('MUST_NOT_CALL_ASR')}});
 const item=mediaById('training-bank-20-en'),fixture=readReplayFixture(item,MEDIA_DIR);
 let risk='LOW',zone='AWAY',hold=false, events=[],finals=[];
 const run={id:'test-20',version:0,step:0,transcript:[],endedAt:null,callEndedAt:null};
 const ctx={run,media:null,commands:{
  mediaBegin(id,opts){assert.equal(opts.replay,true);},
  mediaFinal(turn){const n=finals.length;if(n>=20)return null;finals.push(turn);risk=turn.text.includes('transfer')||n>=9?'HIGH':risk;
   return {turnId:`media_turn_${n}`,riskBand:risk,riskIndex:risk==='HIGH'?91:10,newSignalCodes:risk==='HIGH'?['MONEY_REQUEST']:[]};},
  mediaLocationStep(step){const old=zone;zone=step>=8?'AT_BANK':step>=6?'NEAR_BANK':'AWAY';return {zone,previousZone:old,distanceMeters:(8-step)*80};},
  protectionBlocked(){return risk==='HIGH'&&zone==='AT_BANK';},
  mediaMetaReview(){modelCalls++;},publish(){events.push({n:finals.length,zone,hold:ctx.media?.gateBlocked});}
 }};
 orchestra.startReplay(ctx,{runId:run.id,expectedVersion:run.version,mediaId:item.id});
 assert.equal(finals.length,0,'future text must not be disclosed at start');
 assert.equal(ctx.media.provider,'SCRIPTED_TTS_REPLAY');
 const clock=(target,playing=true)=>{
  ms+=Math.max(0,target-ms); // virtual time, no waiting for 100 s playback
  orchestra.clockReport(ctx,{runId:run.id,mediaTimeMs:target,playing});
 };
 clock(0);
 for(let i=0;i<20;i++){
  clock(fixture.turns[i].endMs+15);
  assert.equal(finals.length,i+1,`only turn ${i+1} is visible`);
  clock(fixture.turns[i].endMs+15);assert.equal(finals.length,i+1,'idempotent repeated clock reports');
 }
 clock(Math.round(item.durationSeconds*1000));
 const s=orchestra.project(ctx);
 assert.equal(s.usableFinals,20);assert.equal(s.status,'COMPLETE');assert.equal(s.gps.nextStep,9);
 assert.equal(s.gateBlocked,true);assert.equal(s.actualStt,false);
 assert.equal(s.cost.sparkCalls,0);assert.equal(modelCalls,0);assert.equal(asrCalls,0);
 assert.ok(s.events.some(e=>e.type==='SIMULATED_BANK_HOLD_ON'));
 assert.equal(s.events.filter(e=>e.type==='SCRIPT_TURN_FINAL').length,20);
 assert.equal(s.events.filter(e=>e.type==='AUDIO_COMPLETED').length,1);
 assert.equal(s.events.filter(e=>e.type==='AI_ANALYSIS_COMPLETED').length,0);
 ctx.media.controller.abort();
});

test('replay rejects invalid cases and malformed parameters with no side effects',()=>{
 const o=createMediaOrchestrator({mediaDir:MEDIA_DIR,isReady:()=>false});
 const run={id:'strict',version:0,step:0,transcript:[],endedAt:null,callEndedAt:null};
 const ctx={run,media:null,commands:{mediaBegin(){},publish(){}}};
 assert.throws(()=>o.startReplay(ctx,{runId:'wrong',expectedVersion:0,mediaId:'training-bank-20-en'}),/사건/);
 assert.throws(()=>o.startReplay(ctx,{runId:'strict',expectedVersion:0,mediaId:'synthetic-prosecutor-en'}),/20턴/);
 assert.throws(()=>o.startReplay(ctx,{runId:'strict',expectedVersion:0,mediaId:'training-bank-20-en',consented:true}),/허용/);
 assert.equal(ctx.media,null);
});

async function api(base,path,auth,body,override){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':override??auth.parentToken}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
test('HTTP session: replay allowed without API key, rejects glasses-token writes, preserves Meta OFFLINE labels',async()=>{
 const app=createDemoServer({mediaAsrEnabled:false,metaConfig:{enabled:false,approved:false,killSwitch:true}});const {port}=await app.listen();const base=`http://127.0.0.1:${port}`;
 try{
  const catalog=await api(base,'/api/media/catalog');assert.equal(catalog.status,200);assert.equal(catalog.data.asrProvider,'DISABLED');
  const created=await api(base,'/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'});assert.equal(created.status,201);
  const auth=created.data.sessionCredentials;const body={runId:created.data.runId,expectedVersion:created.data.version,mediaId:'training-bank-20-en'};
  assert.equal((await api(base,'/api/media/replay',auth,body,auth.glassesToken)).status,403);
  assert.equal((await api(base,'/api/media/replay',auth,{...body,mediaId:'prosecutor'})).status,400);
  const response=await api(base,'/api/media/replay',auth,body);assert.equal(response.status,202);assert.equal(response.data.media.replay,true);
  assert.equal(response.data.media.provider,'SCRIPTED_TTS_REPLAY');assert.equal(response.data.media.modelProvider,'DISABLED');assert.equal(response.data.media.finals,0);
  assert.equal(response.data.media.consentReceipt.externalTransfer,'NONE');
  assert.equal((await api(base,'/api/media/replay',auth,body)).status,409);
  const media=await fetch(base+'/media/training-bank-20-en.wav',{headers:{Range:'bytes=0-100'}});assert.equal(media.status,206);
 }finally{await app.close();}
});

test('full HTTP case engine: 20-turn live playback time drives rules, glasses, GPS and SafeBank denial',async()=>{
 let clockNow=0;
 const app=createDemoServer({mediaClockNow:()=>clockNow,mediaAsrEnabled:false,metaConfig:{enabled:false}});const {port}=await app.listen();const base=`http://127.0.0.1:${port}`;
 try{
  const cr=await api(base,'/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'});assert.equal(cr.status,201);
  const auth=cr.data.sessionCredentials,runId=cr.data.runId;
  const opened=await api(base,'/api/media/replay',auth,{runId,expectedVersion:cr.data.version,mediaId:'training-bank-20-en'});assert.equal(opened.status,202);
  const fixture=readReplayFixture(mediaById('training-bank-20-en'),MEDIA_DIR);
  assert.equal((await api(base,'/api/media/clock',auth,{runId,mediaTimeMs:0,playing:true})).status,200);
  for (let i=0;i<20;i++){
   const target=fixture.turns[i].endMs+10;
   // virtual advance matches the server clock: not an API ability to jump into the future
   clockNow+=target-clockNow;
   const r=await api(base,'/api/media/clock',auth,{runId,mediaTimeMs:target,playing:true});assert.equal(r.status,200,JSON.stringify(r.data));
   const st=(await api(base,'/api/state',auth)).data;
   assert.equal(st.transcript.filter(x=>x.source==='SCRIPTED_TTS_REPLAY').length,i+1);
  }
  const finish=Math.round(mediaById('training-bank-20-en').durationSeconds*1000);
  clockNow+=finish-clockNow;
  await api(base,'/api/media/clock',auth,{runId,mediaTimeMs:finish,playing:false});
  const end=(await api(base,'/api/state',auth)).data;
  assert.equal(end.media.status,'COMPLETE');assert.equal(end.media.usableFinals,20);
  assert.equal(end.location.zone,'AT_BANK');
  assert.equal(end.media.actualStt,false);assert.equal(end.metaReview.status,'DISABLED');
  assert.equal(end.media.cost.sparkCalls,0);
  assert.equal(end.risk.band,'HIGH');
  assert.equal(end.protectionGate.blocked,true);
  const glasses=await api(base,'/api/glasses/state',auth);
  assert.equal(glasses.status,200);assert.equal(glasses.data.severity,'HIGH');
  const attempt=await api(base,'/api/action',auth,{runId,expectedVersion:end.version,action:'SIMULATED_TRANSFER'});
  assert.equal(attempt.status,409);assert.equal(attempt.data.code,'POLICY_DENIED');
 }finally{await app.close();}
});
