import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {inspectReplayWav,makeReplaySegment,replayEligibility} from '../demo/safety-challenge/public/replay-wav.js';
import {digestAudio,validateAudioInput} from '../src/modules/audio/stt-port.ts';
import {getReplayPolicy,mayEnableExtendedReplay} from '../src/modules/audio/replay-policy.ts';

function makeWav(ms){
 const samples=ms*16, buffer=new Uint8Array(44+samples*2),v=new DataView(buffer.buffer);
 for(const [i,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let j=0;j<s.length;j++)buffer[i+j]=s.charCodeAt(j);
 v.setUint32(4,buffer.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
 v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
 v.setUint32(40,samples*2,true);
 // silence is intentional: adjacent windows have EXACTLY the same bytes/hash.
 return buffer;
}
async function createHarness({scenarioId='benign',modelText='인증번호를 알려주세요.'}={}){
 const temp=await mkdtemp(path.join(tmpdir(),'safecall-v134-'));
 const script=path.join(temp,'cli.sh'),model=path.join(temp,'fake-model.bin');
 await writeFile(script,`#!/bin/sh\nout=''\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = '-of' ]; then shift; out="$1"; fi\n  shift\ndone\nprintf '%s\\n' '${modelText}' > "$out.txt"\n`);await chmod(script,0o700);await writeFile(model,'STUB ONLY: NOT WHISPER STT');
 const app=createDemoServer({port:0,localSttConfig:{executablePath:script,modelPath:model,temporaryRoot:temp,timeoutMs:3000}});
 const {port}=await app.listen(),base=`http://127.0.0.1:${port}`;
 const created=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,mode:'verified'})});assert.equal(created.status,201);
 let state=await created.json();const creds=state.sessionCredentials;
 const auth={'X-SafeCall-Session':creds.sessionId,'X-SafeCall-Token':creds.parentToken};
 async function post(route,payload,headers=auth){const response=await fetch(base+route,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:response.status,body:await response.json()};}
 async function cmd(route,extra={}){const result=await post(route,{runId:state.runId,expectedVersion:state.version,...extra});if(result.status===200)state=result.body;return result;}
 async function upload(segment,idx,opts={}){
  const digest=digestAudio(segment.bytes);
  const response=await fetch(base+'/api/voice/stt/local',{method:'POST',headers:{...auth,'Content-Type':'audio/wav',
   'X-SafeCall-Local-Consent':opts.consent??'granted','X-SafeCall-Consent-At':String(Date.now()),
   'X-SafeCall-Language':'ko-KR','X-SafeCall-Run':state.runId,'X-SafeCall-Version':String(state.version),
   'X-SafeCall-Digest':digest,'X-SafeCall-Segment-Index':String(idx),'X-SafeCall-Segment-Start-Ms':String(idx*5000)},body:segment.bytes});
  return {status:response.status,body:await response.json()};
 }
 return {get state(){return state},auth,base,app,post,cmd,upload,async close(){await app.close();await rm(temp,{recursive:true,force:true});}};
}

test('v134 default bounded 40s and explicit server-side 120s policy are separate',()=>{
 assert.equal(getReplayPolicy().maxSegments,8);assert.equal(getReplayPolicy('EXTENDED_120S').maxSegments,24);
 assert.equal(getReplayPolicy('EXTENDED_120S').maxRequests,32);
 assert.throws(()=>getReplayPolicy('UNLIMITED'));
 const good={scenarioId:'benign',step:0,endedAt:null,voiceMode:'SCRIPTED',eventCount:0,
  localSegmentCount:0,captionActive:false,hasPending:false,inFlight:false,transcriptCount:0,hasCanonicalEvents:false};
 assert.equal(mayEnableExtendedReplay(good),true);
 for(const patch of [{scenarioId:'otp'},{step:1},{endedAt:'now'},{voiceMode:'LOCAL_STT_USER_REVIEWED'},
  {eventCount:1},{localSegmentCount:1},{captionActive:true},{hasPending:true},{inFlight:true},{transcriptCount:1},{hasCanonicalEvents:true}])
   assert.equal(mayEnableExtendedReplay({...good,...patch}),false,JSON.stringify(patch));
});

test('v134 120s browser slices are exact and standard rejects >40s',()=>{
 const input=makeWav(120000);
 assert.throws(()=>inspectReplayWav(input),/40초/);
 const info=inspectReplayWav(input,{maxSegments:24});assert.equal(info.totalSegments,24);assert.equal(info.durationMs,120000);
 assert.throws(()=>inspectReplayWav(makeWav(120001),{maxSegments:24}));
 assert.throws(()=>inspectReplayWav(input,{maxSegments:25}));
 for(const i of [0,7,8,11,12,15,23]){
  const segment=makeReplaySegment(input,i,{maxSegments:24});
  assert.equal(segment.startMs,i*5000);assert.equal(segment.endMs,(i+1)*5000);assert.equal(segment.bytes.length,160044);
  validateAudioInput({caseId:'demo_example',sourceType:'CONSENTED_TEST_AUDIO',provenance:'USER_AUTHORIZED_TEST',
   consentReceipt:{granted:true,purpose:'LOCAL_DEMO_ANALYSIS',externalTransfer:false,issuedAtMs:Date.now(),expiresAtMs:Date.now()+60000},
   audioBytes:segment.bytes,inputDigest:digestAudio(segment.bytes),codec:'WAV_PCM16_MONO_16000',durationMs:5000,sizeBytes:segment.bytes.length,
   languageHint:'ko-KR',retentionPolicy:'DISCARD_IMMEDIATELY'});
 }
 const eligibility={caseId:'demo_1',sourceCaseId:'demo_1',mode:'LOCAL_STT_USER_REVIEWED',step:0,ended:false,
  segmentIndex:23,serverSegmentCount:23,serverNextStartMs:115000,hasPending:false,networkReady:true,modelReady:true,totalSegments:24};
 assert.equal(replayEligibility({...eligibility,maxSegments:24}).ok,true);
 assert.equal(replayEligibility(eligibility).ok,false);
 assert.equal(replayEligibility({...eligibility,maxSegments:24,segmentIndex:24}).ok,false);
});

test('v134 enable requires parent consent, pristine benign case, and valid mode; repeat opt-in denied',async()=>{
 const h=await createHarness();try{
  const state=h.state;
  assert.equal((await h.cmd('/api/voice/replay/enable',{consented:false,mode:'EXTENDED_120S'})).status,400);
  assert.equal((await h.cmd('/api/voice/replay/enable',{consented:true,mode:'UNLIMITED'})).status,400);
  assert.equal((await h.post('/api/voice/replay/enable',{runId:state.runId,expectedVersion:state.version,consented:true,mode:'EXTENDED_120S'},
    {'X-SafeCall-Session':h.auth['X-SafeCall-Session'],'X-SafeCall-Token':'WRONG'})).status,403);
  const ok=await h.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'});
  assert.equal(ok.status,200);assert.equal(ok.body.voiceFixture.replayMaxSegments,24);
  assert.equal(ok.body.voiceFixture.replayMode,'EXTENDED_120S');
  assert.equal((await h.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'})).status,409);
  assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
 }finally{await h.close();}
 const bad=await createHarness({scenarioId:'otp'});try{assert.equal((await bad.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'})).status,409);}finally{await bad.close();}
});

test('v134 24 x 5s same Case with repeated silent audio, 25th blocked and corrections preserved',async()=>{
 const h=await createHarness();try{
  const initial=h.state,caseId=initial.runId;
  const selected=await h.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'});
  assert.equal(selected.status,200);
  const source=makeWav(120000);
  for(let i=0;i<24;i++){
   const seg=makeReplaySegment(source,i,{maxSegments:24});
   const candidate=await h.upload(seg,i);assert.equal(candidate.status,200,`upload ${i}: ${JSON.stringify(candidate.body)}`);
   assert.equal(candidate.body.requiresUserReview,true);
   assert.equal(candidate.body.segmentStartMs,i*5000);
   const pre=await fetch(h.base+'/api/state',{headers:h.auth});const before=await pre.json();
   assert.equal(before.voiceFixture.localSegmentCount,i,'draft does not mutate Case');
   assert.equal(before.mockCard.status,'ACTIVE');assert.equal(before.safeBank.status,'READY');
   if(i===12)assert.equal((await h.upload(seg,i)).status,409,'duplicate pending must be denied');
   const confirmed=await h.cmd('/api/voice/stt/confirm',{candidateId:candidate.body.candidateId,speaker:'caller',
    confirmedText:i===12?'송금하지 마세요.':`정상 확인 요청 ${i}`,consented:true});
   assert.equal(confirmed.status,200,`confirm ${i}: ${JSON.stringify(confirmed.body)}`);
   assert.equal(h.state.runId,caseId);assert.equal(h.state.voiceFixture.localSegmentCount,i+1);
   assert.equal(h.state.voiceFixture.nextStartMs,(i+1)*5000);
   assert.equal(h.state.canonicalEvents.at(-1).sequence,i);
   assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
  }
  assert.equal(h.state.voiceFixture.replayMaxSegments,24);
  assert.equal(h.state.transcript.length,24);
  const denied=await h.upload(makeReplaySegment(makeWav(5000),0,{maxSegments:24}),24);
  assert.equal(denied.status,400,'HTTP shape should reject index >= 24');
  const revised=await h.cmd('/api/voice/stt/revise',{turnId:'voice_local_12',revision:1,operation:'CORRECT',
   speaker:'caller',text:'일반적인 고객 안내입니다.',consented:true});
  assert.equal(revised.status,200);assert.equal(h.state.transcript.find(x=>x.turnId==='voice_local_12').text,'일반적인 고객 안내입니다.');
  const retracted=await h.cmd('/api/voice/stt/revise',{turnId:'voice_local_23',revision:1,operation:'RETRACT',consented:true});
  assert.equal(retracted.status,200);assert.equal(h.state.transcript.length,23);
  assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
 }finally{await h.close();}
});

test('v134 extended duplicate slot, wrong ordering, missing consent and closed case are denied',async()=>{
 const h=await createHarness();try{
  assert.equal((await h.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'})).status,200);
  const seg=makeReplaySegment(makeWav(10000),0,{maxSegments:24});
  const skip=await h.upload(seg,1);assert.equal(skip.status,409);
  const without=await h.upload(seg,0,{consent:'missing'});assert.equal(without.status,400);
  const good=await h.upload(seg,0);assert.equal(good.status,200);
  assert.equal((await h.cmd('/api/voice/stt/confirm',{candidateId:good.body.candidateId,speaker:'caller',confirmedText:'검찰이라는 단어만 포함된 정상 교육 이야기',consented:true})).status,200);
  assert.equal((await h.upload(seg,0)).status,409);
  // A change to a confirmed event cannot be used to unlock a new extended-mode opt-in.
  assert.equal((await h.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'})).status,409);
  assert.equal((await h.cmd('/api/end')).status,200);
  assert.equal((await h.upload(seg,1)).status,409);
 }finally{await h.close();}
});

test('v134 32-request case budget remains bounded even for discarded drafts',async()=>{
 const h=await createHarness();try{
  assert.equal((await h.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'})).status,200);
  const seg=makeReplaySegment(makeWav(5000),0,{maxSegments:24});
  for(let i=0;i<32;i++){
   const result=await h.upload(seg,0);assert.equal(result.status,200,`attempt ${i}`);
   assert.equal((await h.cmd('/api/voice/stt/discard',{candidateId:result.body.candidateId})).status,200);
  }
  const limited=await h.upload(seg,0);assert.equal(limited.status,429);
  assert.equal(h.state.voiceFixture.localSegmentCount,0);
 }finally{await h.close();}
});

test('v134 a prior ordinary 8-segment case does not silently consume next case 24-segment allowance',async()=>{
 const h=await createHarness();try{
  const seg=makeReplaySegment(makeWav(5000),0);
  for(let i=0;i<8;i++){
   // Default demo's safety ceiling allows different 5-second chunks; use one zero segment
   // only once per case, so explicitly discard candidates in this prior case.
   const r=await h.upload(seg,0);assert.equal(r.status,200);
   assert.equal((await h.cmd('/api/voice/stt/discard',{candidateId:r.body.candidateId})).status,200);
  }
  const reset=await h.cmd('/api/reset',{scenarioId:'benign',mode:'verified'});
  assert.equal(reset.status,200);
  assert.equal(h.state.voiceFixture.localSttAttempts,0);
  assert.equal((await h.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'})).status,200);
  const long=makeWav(120000);
  for(let i=0;i<24;i++){
   const r=await h.upload(makeReplaySegment(long,i,{maxSegments:24}),i);
   assert.equal(r.status,200,`after prior case, index ${i}`);
   assert.equal((await h.cmd('/api/voice/stt/confirm',{candidateId:r.body.candidateId,speaker:'caller',confirmedText:`정상 통화 구간 ${i}`,consented:true})).status,200);
  }
  assert.equal(h.state.voiceFixture.localSegmentCount,24);
 }finally{await h.close();}
});

test('v134 mobile explicit opt-in controls exist; no URL scraping or automatic finance actions',async()=>{
 const html=await readFile(new URL('../demo/safety-challenge/public/mobile.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../demo/safety-challenge/public/mobile.js',import.meta.url),'utf8');
 for(const id of ['replay-extended-consent','replay-extended-enable','replay-mode-status'])assert.ok(html.includes(`id="${id}"`));
 assert.ok(js.includes("mutate('voice/replay/enable'"));
 assert.ok(js.includes('replayPreviewCursor=Math.min('),'model-unavailable preview-only mode should advance without mutating case');
 assert.ok(js.includes('inspectReplayWav(bytes,{maxSegments:max})'));
 assert.ok(!js.includes('window.open(\'https://youtube.com'));
});

test('v134 MP4 preparation requires rights and never replaces existing private output',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'safecall-v134-prepare-'));
 try{
  const src=path.join(temp,'source.mp4'),out=path.join(temp,'output.wav');
  await writeFile(src,Buffer.alloc(250));await writeFile(out,'DO NOT OVERWRITE');
  const helper=path.resolve(new URL('../scripts/prepare-v134-long-replay.mjs',import.meta.url).pathname);
  const without=spawnSync(process.execPath,[helper,src,out],{encoding:'utf8'});
  assert.notEqual(without.status,0);
  const duplicate=spawnSync(process.execPath,[helper,src,out,'--rights-confirmed'],{encoding:'utf8'});
  assert.notEqual(duplicate.status,0);
  assert.equal(await readFile(out,'utf8'),'DO NOT OVERWRITE');
 }finally{await rm(temp,{recursive:true,force:true});}
});
