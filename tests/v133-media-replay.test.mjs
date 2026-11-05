import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inspectReplayWav,makeReplaySegment,replayEligibility} from '../demo/safety-challenge/public/replay-wav.js';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {validateAudioInput,digestAudio} from '../src/modules/audio/stt-port.ts';

function wav(ms=12000){
 const frames=ms*16, bytes=new Uint8Array(44+frames*2),view=new DataView(bytes.buffer);
 const label=(at,str)=>{for(let i=0;i<str.length;i++)bytes[at+i]=str.charCodeAt(i);};
 label(0,'RIFF');view.setUint32(4,bytes.length-8,true);label(8,'WAVE');label(12,'fmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 label(36,'data');view.setUint32(40,frames*2,true);
 // Different signal per 5s interval; prevents identical hash replay across segments.
 for(let i=0;i<frames;i++)view.setInt16(44+i*2,(Math.floor(i/80000)*333+((i*13)%811))-405,true);
 return bytes;
}
function audioInput(segment){return {caseId:'demo_1',sourceType:'CONSENTED_TEST_AUDIO',provenance:'USER_AUTHORIZED_TEST',
 consentReceipt:{granted:true,purpose:'LOCAL_DEMO_ANALYSIS',externalTransfer:false,issuedAtMs:Date.now(),expiresAtMs:Date.now()+60000},
 audioBytes:segment.bytes,inputDigest:digestAudio(segment.bytes),codec:'WAV_PCM16_MONO_16000',
 durationMs:Math.round(segment.durationMs),sizeBytes:segment.bytes.length,languageHint:'ko-KR',retentionPolicy:'DISCARD_IMMEDIATELY'};}

test('v133 precise 5s slicing preserves server WAV contract and timeline',()=>{
 const source=wav(12000);const info=inspectReplayWav(source);
 assert.equal(info.durationMs,12000);assert.equal(info.totalSegments,3);
 for(const [i,start,end] of [[0,0,5000],[1,5000,10000],[2,10000,12000]]){
  const s=makeReplaySegment(source,i);assert.equal(s.index,i);assert.equal(s.startMs,start);assert.equal(s.endMs,end);
  assert.equal(s.bytes.length,44+(end-start)*32);assert.equal(validateAudioInput(audioInput(s)).durationMs,end-start);
  assert.equal(new DataView(s.bytes.buffer).getUint32(4,true),s.bytes.length-8);
  assert.equal(new DataView(s.bytes.buffer).getUint32(40,true),s.bytes.length-44);
 }
 assert.throws(()=>makeReplaySegment(source,3),/구간/);
});
test('v133 5s standard PCM WAV rejects malformed RIFF, fake codec, oversized or empty audio',()=>{
 for(const len of [0,44,46])if(len<46)assert.throws(()=>inspectReplayWav(new Uint8Array(len)));
 const original=wav(5000);let b=original.slice();b[0]=0;assert.throws(()=>inspectReplayWav(b));
 b=original.slice();new DataView(b.buffer).setUint32(24,44100,true);assert.throws(()=>inspectReplayWav(b));
 b=original.slice();new DataView(b.buffer).setUint16(22,2,true);assert.throws(()=>inspectReplayWav(b));
 b=original.slice();b=b.subarray(0,b.length-1);assert.throws(()=>inspectReplayWav(b));
 assert.throws(()=>inspectReplayWav(wav(40001)),/40초|데이터 청크/);
 assert.equal(inspectReplayWav(wav(40000)).totalSegments,8);
});
test('v133 accepts FFmpeg-style LIST chunk and strips metadata from normalized 5s upload',()=>{
 const canonical=wav(6000),list=Uint8Array.from([76,73,83,84,4,0,0,0,73,78,70,79]);
 const decorated=new Uint8Array(canonical.length+list.length);
 decorated.set(canonical.subarray(0,36));decorated.set(list,36);
 decorated.set(canonical.subarray(36),36+list.length);
 new DataView(decorated.buffer).setUint32(4,decorated.length-8,true);
 const info=inspectReplayWav(decorated);assert.equal(info.dataOffset,56);
 const seg=makeReplaySegment(decorated,0);
 assert.equal(seg.bytes.length,160044);assert.equal(seg.bytes[36],100);
 assert.deepEqual(seg.bytes,makeReplaySegment(canonical,0).bytes);
 assert.equal(validateAudioInput(audioInput(seg)).durationMs,5000);
});
test('v133 replay eligibility checks case, ordering, consent preconditions and blocks interleaved source',()=>{
 const valid={caseId:'demo_1',sourceCaseId:'demo_1',mode:'SCRIPTED',step:0,ended:false,segmentIndex:0,
 serverSegmentCount:0,serverNextStartMs:0,hasPending:false,networkReady:true,modelReady:true,totalSegments:3};
 assert.equal(replayEligibility(valid).ok,true);
 for(const patch of [{caseId:'other'},{mode:'CAPTION_OBSERVATION'},{step:1},{ended:true},{hasPending:true},
 {serverSegmentCount:1},{segmentIndex:1},{modelReady:false},{networkReady:false},{serverNextStartMs:1500}]){
  assert.equal(replayEligibility({...valid,...patch}).ok,false,JSON.stringify(patch));
 }
 assert.equal(replayEligibility({...valid,mode:'LOCAL_STT_USER_REVIEWED',segmentIndex:1,serverSegmentCount:1,serverNextStartMs:5000}).ok,true);
 assert.equal(replayEligibility({...valid,segmentIndex:3,serverSegmentCount:3,serverNextStartMs:15000}).ok,false);
});
test('v133 local player uses no automatic Meta, external media extraction or bank command',async()=>{
 const moduleText=await readFile(new URL('../demo/safety-challenge/public/replay-wav.js',import.meta.url),'utf8');
 assert.ok(moduleText.includes('makeReplaySegment'));
 assert.ok(!/fetch\s*\(|localStorage\s*\.|navigator\.mediaDevices/i.test(moduleText));
 const html=await readFile(new URL('../demo/safety-challenge/public/mobile.html',import.meta.url),'utf8');
 for(const id of ['replay-file','replay-player','replay-prepare','replay-send','replay-clear'])assert.ok(html.includes(`id="${id}"`));
});
test('v133 native Node demo actually serves replay module (no npm dependencies)',async()=>{
 const app=createDemoServer({port:0});try{
  const {port}=await app.listen(),base=`http://127.0.0.1:${port}`;
  for(const file of ['/mobile','/mobile.js','/replay-wav.js']){
   const r=await fetch(base+file);assert.equal(r.status,200,file);const text=await r.text();assert.ok(text.length>500);
  }
  const no=await fetch(base+'/private.env');assert.equal(no.status,404);
 }finally{await app.close();}
});
test('v133 actual HTTP 5s audio segments → fake offline CLI → human-reviewed same Case, no auto finances',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'safecall-v133-'));
 const script=path.join(temp,'stub.sh'),model=path.join(temp,'stub.bin');
 await writeFile(script,`#!/bin/sh\nout=''\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = '-of' ]; then shift; out="$1"; fi\n  shift\ndone\nprintf '%s\\n' '인증번호를 알려주세요.' > "$out.txt"\n`);await chmod(script,0o700);await writeFile(model,'FAKE MODEL - NO STT');
 const app=createDemoServer({port:0,localSttConfig:{executablePath:script,modelPath:model,temporaryRoot:temp,timeoutMs:2500}});
 try{
  const {port}=await app.listen(),base=`http://127.0.0.1:${port}`;
  const init=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:'benign',mode:'verified'})});assert.equal(init.status,201);
  let state=await init.json();const creds=state.sessionCredentials,auth={'X-SafeCall-Session':creds.sessionId,'X-SafeCall-Token':creds.parentToken};
  const caseId=state.runId,source=wav(11000);
  for(let i=0;i<3;i++){
   const seg=makeReplaySegment(source,i);
   const draft=await fetch(base+'/api/voice/stt/local',{method:'POST',headers:{...auth,'Content-Type':'audio/wav',
    'X-SafeCall-Local-Consent':'granted','X-SafeCall-Consent-At':String(Date.now()),'X-SafeCall-Language':'ko-KR',
    'X-SafeCall-Run':caseId,'X-SafeCall-Version':String(state.version),'X-SafeCall-Digest':digestAudio(seg.bytes),
    'X-SafeCall-Segment-Index':String(i),'X-SafeCall-Segment-Start-Ms':String(seg.startMs)},body:seg.bytes});
   assert.equal(draft.status,200);const candidate=await draft.json();
   const before=await fetch(base+'/api/state',{headers:auth});const pre=await before.json();
   assert.equal(pre.risk.index,state.risk.index,'pending candidate cannot alter risk');
   assert.equal(pre.mockCard.status,'ACTIVE');assert.equal(pre.safeBank.status,'READY');
   const confirmed=await fetch(base+'/api/voice/stt/confirm',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({
    runId:caseId,expectedVersion:state.version,candidateId:candidate.candidateId,speaker:'caller',confirmedText:candidate.text,consented:true})});
   assert.equal(confirmed.status,200);state=await confirmed.json();
   assert.equal(state.runId,caseId);assert.equal(state.voiceFixture.localSegmentCount,i+1);
   assert.equal(state.voiceFixture.nextStartMs,seg.endMs);
   assert.equal(state.mockCard.status,'ACTIVE');assert.equal(state.safeBank.status,'READY');
  }
  assert.equal(state.voiceFixture.mode,'LOCAL_STT_USER_REVIEWED');
  assert.equal(state.risk.band,'HIGH');assert.equal(state.canonicalEvents.length,3);
 }finally{await app.close();await rm(temp,{recursive:true,force:true});}
});
