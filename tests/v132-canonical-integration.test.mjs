import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {makeCanonicalEvent} from '../src/modules/events/canonical.ts';
import {makeSyntheticTone,digestAudio} from '../src/modules/audio/stt-port.ts';

async function cli(){
 const root=await mkdtemp(path.join(tmpdir(),'safecall-v132-fixture-'));
 const bin=path.join(root,'fake.sh'),model=path.join(root,'fake-model.bin');
 // Stub only: no real speech recognized. In tests the CLI merely writes a fixed sentence.
 await writeFile(bin,`#!/bin/sh\nout=''\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = '-of' ]; then shift; out="$1"; fi\n shift\ndone\nprintf '%s\\n' '지금 인증번호를 알려주세요.' > "$out.txt"\n`);
 await chmod(bin,0o700);await writeFile(model,'STUB NOT SPEECH');
 return {root,config:{executablePath:bin,modelPath:model,temporaryRoot:root,timeoutMs:2500}};
}
async function session(config=null,scenarioId='benign'){
 const srv=createDemoServer({port:0,localSttConfig:config});const {port}=await srv.listen();const url=`http://127.0.0.1:${port}`;
 async function post(route,body,headers={}){
  const resp=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  return {status:resp.status,body:await resp.json()};
 }
 const init=await post('/api/session/create',{scenarioId,mode:'verified'});assert.equal(init.status,201);
 const auth={'X-SafeCall-Session':init.body.sessionCredentials.sessionId,'X-SafeCall-Token':init.body.sessionCredentials.parentToken};
 const child={'X-SafeCall-Session':init.body.sessionCredentials.sessionId,'X-SafeCall-Token':init.body.sessionCredentials.childToken};
 let state=init.body;
 return {srv,url,auth,child,init,post,get state(){return state;},async get(route,headers=auth){const res=await fetch(url+route,{headers});return {status:res.status,body:await res.json()};},
  async call(route,extra={}){const res=await post(route,{runId:state.runId,expectedVersion:state.version,...extra},auth);if(res.status===200&&res.body?.runId)state=res.body;return res;},
  async upload({segmentIndex,segmentStartMs,bytes=makeSyntheticTone(320),headers=auth,version=state.version,caseId=state.runId}={}){
   const r=await fetch(url+'/api/voice/stt/local',{method:'POST',headers:{...headers,'Content-Type':'audio/wav',
    'X-SafeCall-Local-Consent':'granted','X-SafeCall-Consent-At':String(Date.now()),'X-SafeCall-Language':'ko-KR',
    'X-SafeCall-Run':caseId,'X-SafeCall-Version':String(version),'X-SafeCall-Digest':digestAudio(bytes),
    ...(segmentIndex===undefined?{}:{'X-SafeCall-Segment-Index':String(segmentIndex)}),
    ...(segmentStartMs===undefined?{}:{'X-SafeCall-Segment-Start-Ms':String(segmentStartMs)})},body:bytes});
   return {status:r.status,body:await r.json()};
  }};
}
test('v132 canonical event schema rejects provenance spoofing, invalid time and PII keys',()=>{
 const v={caseId:'demo_a',eventId:'event_a',turnId:'voice_a',sequence:0,kind:'UTTERANCE_FINAL',
 source:'LOCAL_STT_HUMAN_REVIEWED',speaker:'caller',revision:0,startMs:0,endMs:5000,status:'HUMAN_REVIEWED'};
 const event=makeCanonicalEvent(v);assert.equal(event.schemaVersion,1);assert.equal(Object.hasOwn(event,'text'),false);
 assert.throws(()=>makeCanonicalEvent({...v,status:'CAPTION_ONLY'}),/INVALID_EVENT_PROVENANCE/);
 assert.throws(()=>makeCanonicalEvent({...v,source:'REAL_PHONE_INTERCEPT'}),/INVALID_CANONICAL_EVENT/);
 assert.throws(()=>makeCanonicalEvent({...v,startMs:7000,endMs:5000}),/INVALID_CANONICAL_EVENT/);
});
test('v132 successive 3 user-reviewed local segments share one case and never touch bank/card',async()=>{
 const f=await cli(),h=await session(f.config);try{
  const initial=h.state.runId;
  for(let idx=0;idx<3;idx++){
   const before=h.state;
   const draft=await h.upload({segmentIndex:idx,segmentStartMs:idx*100,bytes:makeSyntheticTone(320+idx)});
   assert.equal(draft.status,200);assert.equal(draft.body.segmentIndex,idx);assert.equal(draft.body.caseId,initial);
   assert.equal((await h.get('/api/state')).body.careCaseVersion,before.careCaseVersion);
   const accepted=await h.call('/api/voice/stt/confirm',{candidateId:draft.body.candidateId,speaker:'caller',confirmedText:draft.body.text,consented:true});
   assert.equal(accepted.status,200);assert.equal(h.state.voiceFixture.localSegmentCount,idx+1);
   assert.equal(h.state.voiceFixture.nextStartMs,(idx+1)*100);
   assert.equal(h.state.canonicalEvents.at(-1).source,'LOCAL_STT_HUMAN_REVIEWED');
   assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
  }
  assert.equal(h.state.runId,initial);assert.equal(h.state.transcript.length,3);
  assert.equal(h.state.risk.band,'HIGH');assert.equal(h.state.canonicalEvents.length,3);
  assert.equal((await h.get('/api/voice/review')).body.metaCalled,false);
 }finally{await h.srv.close();await rm(f.root,{recursive:true,force:true});}
});
test('v132 pending draft blocks second upload and user discard allows same segment retry',async()=>{
 const f=await cli(),h=await session(f.config);try{
  const first=await h.upload();assert.equal(first.status,200);
  const second=await h.upload();assert.equal(second.status,409);assert.equal(second.body.code,'POLICY_DENIED');
  const discard=await h.call('/api/voice/stt/discard',{candidateId:first.body.candidateId});assert.equal(discard.status,200);
  const third=await h.upload({segmentIndex:0,segmentStartMs:0});assert.equal(third.status,200);
  assert.notEqual(third.body.candidateId,first.body.candidateId);assert.equal(h.state.risk.index,0);
 }finally{await h.srv.close();await rm(f.root,{recursive:true,force:true});}
});
test('v132 rejects skipped/out-of-order segment and stale case version',async()=>{
 const f=await cli(),h=await session(f.config);try{
  const future=await h.upload({segmentIndex:1,segmentStartMs:5000});assert.equal(future.status,409);
  const first=await h.upload({segmentIndex:0,segmentStartMs:0});assert.equal(first.status,200);
  await h.call('/api/voice/stt/confirm',{candidateId:first.body.candidateId,speaker:'user',confirmedText:'안녕하세요.',consented:true});
  const repeat=await h.upload({segmentIndex:0,segmentStartMs:0});assert.equal(repeat.status,409);
  const timeMismatch=await h.upload({segmentIndex:1,segmentStartMs:5000});assert.equal(timeMismatch.status,409);
  const valid=await h.upload({segmentIndex:1,segmentStartMs:100,bytes:makeSyntheticTone(321)});assert.equal(valid.status,200);
  const stale=await h.upload({version:h.state.version-1});assert.equal(stale.status,409);
 }finally{await h.srv.close();await rm(f.root,{recursive:true,force:true});}
});
test('v132 reviewed STT correction and retraction update evidence, not bank state',async()=>{
 const f=await cli(),h=await session(f.config);try{
  const draft=await h.upload();await h.call('/api/voice/stt/confirm',{candidateId:draft.body.candidateId,speaker:'caller',confirmedText:draft.body.text,consented:true});
  assert.equal(h.state.risk.band,'HIGH');
  const bad=await h.call('/api/voice/stt/revise',{turnId:'voice_local_0',revision:3,operation:'RETRACT',consented:true});assert.equal(bad.status,409);
  const corrected=await h.call('/api/voice/stt/revise',{turnId:'voice_local_0',revision:1,operation:'CORRECT',speaker:'caller',text:'안녕하세요.',consented:true});
  assert.equal(corrected.status,200);assert.equal(h.state.risk.index,0);
  const retracted=await h.call('/api/voice/stt/revise',{turnId:'voice_local_0',revision:2,operation:'RETRACT',consented:true});
  assert.equal(retracted.status,200);assert.equal(h.state.transcript.length,0);assert.equal(h.state.risk.index,0);
  assert.equal(h.state.canonicalEvents.length,3);assert.equal(h.state.canonicalEvents.at(-1).kind,'UTTERANCE_RETRACT');
  assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
 }finally{await h.srv.close();await rm(f.root,{recursive:true,force:true});}
});
test('v132 caption 5s milestones never peek at future text; same case risk and context evidence',async()=>{
 const h=await session();try{
  const first=await h.call('/api/voice/benchmark/advance',{fixtureId:'registered-mail',consented:true});
  assert.equal(first.status,200);assert.equal(h.state.captionReplay.elapsedMs,5000);
  assert.equal(h.state.transcript.length,0);assert.equal(h.state.risk.index,0);
  assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
  for(let i=1;i<12;i++){const r=await h.call('/api/voice/benchmark/advance',{fixtureId:'registered-mail',consented:true});assert.equal(r.status,200);}
  assert.equal(h.state.captionReplay.elapsedMs,60000);
  assert.equal(h.state.captionReplay.contextEvidence.some(e=>e.code==='NAVIGATION_PROMPT'),true);
  assert.equal(h.state.captionReplay.provisionalAdvisory.canAuthorizeFinance,false);
  assert.equal(h.state.captionReplay.provisionalAdvisory.isFraudDetermination,false);
  assert.equal(h.state.canonicalEvents.length,6);assert.equal(h.state.canonicalEvents[0].source,'SPARSE_CAPTION_OBSERVATION_NOT_STT');
  assert.equal(h.state.risk.index,0);assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
  const review=await h.get('/api/voice/review');assert.equal(review.status,200);assert.equal(review.body.metaCalled,false);
 }finally{await h.srv.close();}
});
test('v132 prosecutor caption case detects authority without falsely promoting quote to credential theft',async()=>{
 const h=await session();try{
  for(let i=0;i<16;i++){const res=await h.call('/api/voice/benchmark/advance',{fixtureId:'prosecutor-personal-data',consented:true});assert.equal(res.status,200);}
  assert.equal(h.state.captionReplay.elapsedMs,80000);
  assert.ok(h.state.captionReplay.contextEvidence.some(e=>e.code==='CRIME_INVOLVEMENT_CLAIM'));
  assert.equal(h.state.captionReplay.provisionalAdvisory.canAuthorizeFinance,false);
  assert.equal(h.state.risk.index,8);
  assert.equal(h.state.safeBank.status,'READY');
  assert.equal(h.state.canonicalEvents.some(e=>e.status!=='CAPTION_ONLY'),false);
 }finally{await h.srv.close();}
});
test('v132 caption replay cannot mix scripted/local/fixture or switch scenario and rejects child',async()=>{
 const h=await session();try{
  const init=await h.call('/api/voice/benchmark/advance',{fixtureId:'registered-mail',consented:true});assert.equal(init.status,200);
  const switchCase=await h.call('/api/voice/benchmark/advance',{fixtureId:'prosecutor-personal-data',consented:true});assert.equal(switchCase.status,409);
  const scripted=await h.call('/api/advance');assert.equal(scripted.status,409);
  const fixture=await h.call('/api/voice/stt/fixture',{fixtureId:'otp',consented:true});assert.equal(fixture.status,409);
  const child=await h.post('/api/voice/benchmark/advance',{runId:h.state.runId,expectedVersion:h.state.version,fixtureId:'registered-mail',consented:true},h.child);
  assert.equal(child.status,403);
 }finally{await h.srv.close();}
});
test('v132 missing consent and closed case reject caption and local revisions',async()=>{
 const h=await session();try{
  const no=await h.call('/api/voice/benchmark/advance',{fixtureId:'registered-mail',consented:false});assert.equal(no.status,400);
  const t=await h.call('/api/end');assert.equal(t.status,200);
  const c=await h.call('/api/voice/benchmark/advance',{fixtureId:'registered-mail',consented:true});assert.equal(c.status,409);
  const r=await h.call('/api/voice/stt/revise',{turnId:'voice_local_0',revision:1,operation:'RETRACT',consented:true});assert.equal(r.status,409);
 }finally{await h.srv.close();}
});
test('v132 caption onboarding metadata does not expose secret audio or future transcript',async()=>{
 const h=await session();try{
  const caps=await h.get('/api/voice/benchmark/cases');assert.equal(caps.status,200);
  assert.equal(caps.body.actualStt,false);assert.equal(caps.body.externalCalls,0);
  assert.ok(caps.body.fixtures.length>=2);assert.ok(!JSON.stringify(caps.body).includes('videoFilename'));
  assert.equal((await h.get('/api/voice/benchmark/cases',h.child)).status,403);
 }finally{await h.srv.close();}
});

test('v132 duplicate audio digest in a later segment is rejected before local STT starts',async()=>{
 const f=await cli(),h=await session(f.config);try{
  const first=await h.upload({bytes:makeSyntheticTone(320)});assert.equal(first.status,200);
  await h.call('/api/voice/stt/confirm',{candidateId:first.body.candidateId,speaker:'caller',confirmedText:first.body.text,consented:true});
  const repeat=await h.upload({segmentIndex:1,segmentStartMs:100,bytes:makeSyntheticTone(320)});
  assert.equal(repeat.status,409);assert.equal(repeat.body.code,'COMMAND_REPLAY_CONFLICT');
  const fresh=await h.upload({segmentIndex:1,segmentStartMs:100,bytes:makeSyntheticTone(321)});assert.equal(fresh.status,200);
 }finally{await h.srv.close();await rm(f.root,{recursive:true,force:true});}
});

test('v132 eight local reviewed chunks are bounded and each keeps sequence/digest distinct',async()=>{
 const f=await cli(),h=await session(f.config);try{
  for(let i=0;i<8;i++){
   const a=await h.upload({segmentIndex:i,segmentStartMs:i*100,bytes:makeSyntheticTone(340+i)});assert.equal(a.status,200);
   const c=await h.call('/api/voice/stt/confirm',{candidateId:a.body.candidateId,speaker:'caller',confirmedText:a.body.text,consented:true});
   assert.equal(c.status,200);assert.equal(h.state.canonicalEvents[i].sequence,i);
  }
  assert.equal(h.state.voiceFixture.localSegmentCount,8);
  const ninth=await h.upload({bytes:makeSyntheticTone(349)});
  assert.equal(ninth.status,429);
  assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
 }finally{await h.srv.close();await rm(f.root,{recursive:true,force:true});}
});
test('v132 local WAV five-second segment fits upload boundary and remains pending until reviewed',async()=>{
 const f=await cli(),h=await session(f.config);try{
  const fiveSec=makeSyntheticTone(340,100); // makeSyntheticTone intentionally caps at one second
  const data=new Uint8Array(44+16000*2*5);data.set(fiveSec.slice(0,44));
  const view=new DataView(data.buffer);view.setUint32(4,data.length-8,true);view.setUint32(40,data.length-44,true);
  const draft=await h.upload({bytes:data,segmentIndex:0,segmentStartMs:0});
  assert.equal(draft.status,200);assert.equal(draft.body.segmentEndMs,5000);
  assert.equal(h.state.risk.index,0);
  const yes=await h.call('/api/voice/stt/confirm',{candidateId:draft.body.candidateId,speaker:'caller',confirmedText:draft.body.text,consented:true});
  assert.equal(yes.status,200);assert.equal(h.state.voiceFixture.nextStartMs,5000);
 }finally{await h.srv.close();await rm(f.root,{recursive:true,force:true});}
});
test('v132 local demo HTML and JS expose caption replay and reviewed audio tools without external calls',async()=>{
 const h=await session();try{
  const html=await fetch(h.url+'/mobile').then(r=>r.text());
  const js=await fetch(h.url+'/mobile.js').then(r=>r.text());
  assert.ok(html.includes('id="caption-case"'));assert.ok(html.includes('id="caption-consent"'));
  assert.ok(html.includes('id="local-stt-revise"'));assert.ok(js.includes("mutate('voice/benchmark/advance'"));
  assert.ok(js.includes("mutate('voice/stt/revise'"));
 }finally{await h.srv.close();}
});
