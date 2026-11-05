import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {digestAudio,makeSyntheticTone} from '../src/modules/audio/stt-port.ts';
import {LocalWhisperCliAdapter} from '../src/modules/audio/local-whisper-stt.ts';
import {evaluateTranscripts,editDistance} from '../src/modules/audio/stt-evaluation.ts';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';

const audio=(caseId='demo_test')=>{
 const bytes=makeSyntheticTone(330);return {caseId,sourceType:'CONSENTED_TEST_AUDIO',
  provenance:'USER_AUTHORIZED_TEST',consentReceipt:{granted:true,purpose:'LOCAL_DEMO_ANALYSIS',externalTransfer:false,
    issuedAtMs:Date.now()-500,expiresAtMs:Date.now()+40_000},audioBytes:bytes,inputDigest:digestAudio(bytes),
  codec:'WAV_PCM16_MONO_16000',durationMs:100,sizeBytes:bytes.byteLength,languageHint:'ko-KR',retentionPolicy:'DISCARD_IMMEDIATELY'};
};
async function fakeCli(text='은행 직원입니다. 지금 인증번호를 알려주세요. 절대 다른 사람에게 말하지 마세요.',delay=0){
 const root=await mkdtemp(path.join(tmpdir(),'safecall-v130-test-'));
 const executablePath=path.join(root,'fake-whisper.sh'),modelPath=path.join(root,'mock-model.bin');
 // This is intentionally NOT a speech recognizer. It emulates an operator-supplied CLI for integration testing.
 await writeFile(executablePath,`#!/bin/sh\nout=''\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = '-of' ]; then shift; out="$1"; fi\n shift\ndone\n${delay?`sleep ${delay}\n`:''}printf '%s\\n' '${text}' > "$out.txt"\n`);
 await chmod(executablePath,0o700);await writeFile(modelPath,'not a model');
 return {root,config:{executablePath,modelPath,temporaryRoot:root,timeoutMs:2000}};
}
async function api(cfg){
 const server=createDemoServer({port:0,localSttConfig:cfg});const {port}=await server.listen();const base=`http://127.0.0.1:${port}`;
 const post=async(url,body,headers={})=>{const response=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const created=await post('/api/session/create',{scenarioId:'benign',mode:'verified'});
 const auth={'X-SafeCall-Session':created.body.sessionCredentials.sessionId,'X-SafeCall-Token':created.body.sessionCredentials.parentToken};
 const child={'X-SafeCall-Session':created.body.sessionCredentials.sessionId,'X-SafeCall-Token':created.body.sessionCredentials.childToken};
 const get=async(url,headers=auth)=>{const response=await fetch(base+url,{headers});return {status:response.status,body:await response.json()};};
 const upload=async({headers=auth,digest=null,caseId=created.body.runId,version=created.body.version,consent='granted',mime='audio/wav',bytes=makeSyntheticTone(320),issuedAt=Date.now()}={})=>{
  const response=await fetch(base+'/api/voice/stt/local',{method:'POST',headers:{...headers,'content-type':mime,
    'x-safecall-local-consent':consent,'x-safecall-consent-at':String(issuedAt),'x-safecall-language':'ko-KR',
    'x-safecall-run':caseId,'x-safecall-version':String(version),'x-safecall-digest':digest||digestAudio(bytes)},body:bytes});
  return {status:response.status,body:await response.json()};
 };
 return {server,auth,child,created,post,get,upload};
}
test('v130 independent reference error metrics (WER/CER), without model accuracy claims',()=>{
 assert.equal(editDistance(['a','b'],['a','c']),1);
 const result=evaluateTranscripts([
  {id:'ko1',language:'ko-KR',reference:'돈을 보내지 마세요',hypothesis:'돈을 보내세요',independentlyLabeled:true},
  {id:'en1',language:'en-US',reference:'send no money',hypothesis:'send money',independentlyLabeled:true},
 ]);
 assert.equal(result.sampleCount,2);assert.equal(result.wordErrors,3);assert.equal(result.referenceWords,6);
 assert.equal(result.byLanguage['en-US'].CER,3/13);assert.equal(result.byLanguage['en-US'].WER,1/3);
 assert.ok(result.CER>0);
 assert.equal(evaluateTranscripts([]).WER,null);
 assert.throws(()=>evaluateTranscripts([{id:'fake',language:'ko-KR',reference:'a',hypothesis:'a',independentlyLabeled:false}]));
 assert.throws(()=>evaluateTranscripts([{id:'dup',language:'ko-KR',reference:'a',hypothesis:'a',independentlyLabeled:true},{id:'dup',language:'en-US',reference:'a',hypothesis:'a',independentlyLabeled:true}]));
});
test('v130 disabled local recognizer is unavailable and never fabricates a transcript',async()=>{
 const app=await api(null);try{
  const r=await app.upload();assert.equal(r.status,503);assert.equal(r.body.code,'STT_UNAVAILABLE');
  const caps=await app.get('/api/voice/stt/capabilities');assert.equal(caps.body.localStt.enabled,false);assert.equal(caps.body.actualStt,false);
 }finally{await app.server.close();}
});
test('v130 local CLI missing model fails closed',async()=>{
 const adapter=new LocalWhisperCliAdapter({executablePath:'/no/whisper',modelPath:'/no/model'});
 assert.equal(await adapter.isReady(),false);
 await assert.rejects(()=>adapter.recognize(audio()),e=>e.code==='STT_NOT_CONFIGURED');
});
test('v130 local CLI stub output is UNATTRIBUTED and temporary files are removed',async()=>{
 const f=await fakeCli();try{
  const adapter=new LocalWhisperCliAdapter(f.config);
  assert.equal(await adapter.isReady(),true);
  const result=await adapter.recognize(audio());
  assert.equal(result.speaker,'unknown');assert.equal(result.quality,'UNCERTAIN');assert.equal(result.requiresUserReview,true);
  assert.equal(result.externalCalls,0);assert.equal(result.persisted,false);
  assert.deepEqual((await readdir(f.root)).sort(),['fake-whisper.sh','mock-model.bin']);
  await assert.rejects(()=>adapter.recognize({...audio(),sourceType:'SYNTHETIC_DEMO_AUDIO',provenance:'GENERATED_TEST_FIXTURE'}),e=>e.code==='INVALID_AUDIO');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('v130 local CLI timeout and cancellation clean up temporary audio',async()=>{
 const f=await fakeCli('slow',2);f.config.timeoutMs=100;
 try{
  const adapter=new LocalWhisperCliAdapter(f.config);
  await assert.rejects(()=>adapter.recognize(audio()),e=>e.code==='STT_TIMEOUT');
  assert.deepEqual((await readdir(f.root)).sort(),['fake-whisper.sh','mock-model.bin']);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('v130 authenticated local audio upload stays a candidate until explicit confirmation',async()=>{
 const f=await fakeCli();const app=await api(f.config);
 try{
  const initial=await app.get('/api/state');
  assert.equal((await app.upload({headers:app.child})).status,403);
  assert.equal((await app.upload({consent:'no'})).status,400);
  assert.equal((await app.upload({mime:'text/plain'})).status,400);
  assert.equal((await app.upload({issuedAt:Date.now()-100_000})).status,400);
  assert.equal((await app.upload({digest:'sha256:'+'0'.repeat(64)})).status,400);
  assert.equal((await app.upload({version:999})).status,409);
  const draft=await app.upload();assert.equal(draft.status,200);assert.equal(draft.body.requiresUserReview,true);
  const before=await app.get('/api/state');assert.equal(before.body.version,initial.body.version);
  assert.equal(before.body.risk.index,0);assert.equal(before.body.mockCard.status,'ACTIVE');assert.equal(before.body.safeBank.status,'READY');
  const fake=await app.post('/api/voice/stt/confirm',{runId:initial.body.runId,expectedVersion:initial.body.version,candidateId:'wrong',speaker:'caller',confirmedText:draft.body.text,consented:true},app.auth);
  assert.equal(fake.status,409);
  const confirmed=await app.post('/api/voice/stt/confirm',{runId:initial.body.runId,expectedVersion:initial.body.version,candidateId:draft.body.candidateId,speaker:'caller',confirmedText:draft.body.text,consented:true},app.auth);
  assert.equal(confirmed.status,200);assert.ok(confirmed.body.risk.index>0);
  assert.equal(confirmed.body.safeBank.status,'READY');assert.equal(confirmed.body.mockCard.status,'ACTIVE');
  assert.equal(confirmed.body.voiceFixture.mode,'LOCAL_STT_USER_REVIEWED');
  const review=await app.get('/api/voice/review');assert.equal(review.status,200);assert.equal(review.body.metaCalled,false);
  const replay=await app.post('/api/voice/stt/confirm',{runId:initial.body.runId,expectedVersion:confirmed.body.version,candidateId:draft.body.candidateId,speaker:'caller',confirmedText:draft.body.text,consented:true},app.auth);
  assert.equal(replay.status,409);
 }finally{await app.server.close();await rm(f.root,{recursive:true,force:true});}
});
test('v130 old case candidate fails closed on reset, and no financial execution occurs',async()=>{
 const f=await fakeCli();const app=await api(f.config);
 try{
  const draft=await app.upload();assert.equal(draft.status,200);
  const reset=await app.post('/api/reset',{runId:app.created.body.runId,expectedVersion:app.created.body.version,scenarioId:'benign',mode:'verified'},app.auth);
  assert.equal(reset.status,200);assert.notEqual(reset.body.runId,app.created.body.runId);
  const stale=await app.post('/api/voice/stt/confirm',{runId:reset.body.runId,expectedVersion:reset.body.version,
   candidateId:draft.body.candidateId,speaker:'caller',confirmedText:draft.body.text,consented:true},app.auth);
  assert.equal(stale.status,409);
  const state=await app.get('/api/state');assert.equal(state.body.risk.index,0);
  assert.equal(state.body.mockCard.status,'ACTIVE');assert.equal(state.body.safeBank.status,'READY');
 }finally{await app.server.close();await rm(f.root,{recursive:true,force:true});}
});
test('v130 no mixing of manual MOCK and local STT; user confirmation cannot bypass version',async()=>{
 const f=await fakeCli();const app=await api(f.config);
 try{
  const fixture=await app.post('/api/voice/stt/fixture',{runId:app.created.body.runId,expectedVersion:app.created.body.version,
   fixtureId:'otp',consented:true},app.auth);
  assert.equal(fixture.status,200);
  const disallowed=await app.upload({version:fixture.body.version});assert.equal(disallowed.status,409);
  assert.equal(disallowed.body.code,'POLICY_DENIED');
 }finally{await app.server.close();await rm(f.root,{recursive:true,force:true});}
});
test('v130 rejects blank/overlong local recognizer output and deletes all temporary files',async()=>{
 for(const result of ['', 'x'.repeat(810)]){
  const f=await fakeCli(result);
  try{
   const adapter=new LocalWhisperCliAdapter(f.config);
   await assert.rejects(()=>adapter.recognize(audio()),e=>e.code==='STT_OUTPUT_INVALID');
   assert.deepEqual((await readdir(f.root)).sort(),['fake-whisper.sh','mock-model.bin']);
  }finally{await rm(f.root,{recursive:true,force:true});}
 }
});
test('v130 discard removes one-time draft without changing case or bank state',async()=>{
 const f=await fakeCli();const app=await api(f.config);
 try{
  const draft=await app.upload();assert.equal(draft.status,200);
  const dropped=await app.post('/api/voice/stt/discard',{runId:app.created.body.runId,expectedVersion:app.created.body.version,candidateId:draft.body.candidateId},app.auth);
  assert.equal(dropped.status,200);assert.equal(dropped.body.version,app.created.body.version);
  const stale=await app.post('/api/voice/stt/confirm',{runId:app.created.body.runId,expectedVersion:app.created.body.version,
   candidateId:draft.body.candidateId,speaker:'caller',confirmedText:draft.body.text,consented:true},app.auth);
  assert.equal(stale.status,409);
  const state=await app.get('/api/state');assert.equal(state.body.safeBank.status,'READY');assert.equal(state.body.mockCard.status,'ACTIVE');
 }finally{await app.server.close();await rm(f.root,{recursive:true,force:true});}
});
