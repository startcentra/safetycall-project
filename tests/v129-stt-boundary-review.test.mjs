import test from 'node:test';
import assert from 'node:assert/strict';
import {digestAudio,makeSyntheticTone,validateAudioInput,DigestMappedFixtureAdapter} from '../src/modules/audio/stt-port.ts';
import {DEMO_AUDIO_OPTIONS,demoAudioAdapter,makeDemoAudioInput} from '../src/modules/audio/stt-demo-catalog.ts';
import {reviewActiveEvidence} from '../src/modules/analysis/evidence-review.ts';
import {MockMetaProvider} from '../src/modules/analysis/meta-provider.ts';
import {createCase,applyCaseEvent,getCaseView} from '../src/modules/case/index.ts';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
const mk=(id='otp')=>makeDemoAudioInput(id,'case_v129');
const throws=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('v129 valid audio metadata and explicit local-only consent',()=>{
 const a=mk();const out=validateAudioInput(a);assert.equal(out.digest,digestAudio(a.audioBytes));assert.equal(out.durationMs,100);
 assert.equal(a.retentionPolicy,'DISCARD_IMMEDIATELY');assert.equal(a.consentReceipt.externalTransfer,false);
});
test('v129 consent absent / external transfer / wrong purpose are rejected',()=>{
 const a=mk();for(const c of [undefined,{...a.consentReceipt,granted:false},{...a.consentReceipt,externalTransfer:true},{...a.consentReceipt,purpose:'REMOTE_LIVE'}])
   throws(()=>validateAudioInput({...a,consentReceipt:c}),'CONSENT_REQUIRED');
});
test('v129 expired, future, overlong consent are rejected',()=>{
 const a=mk(), now=Date.now();
 for(const c of [{...a.consentReceipt,issuedAtMs:now-5000,expiresAtMs:now-1},{...a.consentReceipt,issuedAtMs:now+1000,expiresAtMs:now+2000},{...a.consentReceipt,issuedAtMs:now,expiresAtMs:now+500001}])
   throws(()=>validateAudioInput({...a,consentReceipt:c},now),'EXPIRED_CONSENT');
});
test('v129 wrong hash and missing digest blocked',()=>{const a=mk();throws(()=>validateAudioInput({...a,inputDigest:'sha256:'+'0'.repeat(64)}),'DIGEST_MISMATCH');throws(()=>validateAudioInput({...a,inputDigest:'123'}),'DIGEST_MISMATCH');});
test('v129 wrong byte size/duration rejected',()=>{const a=mk();throws(()=>validateAudioInput({...a,sizeBytes:a.sizeBytes-1}),'INVALID_AUDIO');throws(()=>validateAudioInput({...a,durationMs:500}),'INVALID_AUDIO');});
test('v129 oversize audio rejected before hash work',()=>{const a=mk();throws(()=>validateAudioInput({...a,audioBytes:new Uint8Array(320045),sizeBytes:320045}),'AUDIO_TOO_LARGE');});
test('v129 WAV header mismatch, compressed mime and truncated RIFF rejected',()=>{const a=mk();let b=a.audioBytes.slice();b[0]=0;throws(()=>validateAudioInput({...a,audioBytes:b,inputDigest:digestAudio(b)}),'INVALID_AUDIO');throws(()=>validateAudioInput({...a,codec:'MP3'}),'INVALID_AUDIO');b=a.audioBytes.slice(0,24);throws(()=>validateAudioInput({...a,audioBytes:b,sizeBytes:b.length,inputDigest:digestAudio(b)}),'INVALID_AUDIO');});
test('v129 sample-rate and declared payload mismatches rejected',()=>{const a=mk(),b=a.audioBytes.slice(),v=new DataView(b.buffer);v.setUint32(24,44100,true);throws(()=>validateAudioInput({...a,audioBytes:b,inputDigest:digestAudio(b)}),'INVALID_AUDIO');});
test('v129 source/provenance mismatch and unsupported language rejected',()=>{const a=mk();throws(()=>validateAudioInput({...a,sourceType:'CONSENTED_TEST_AUDIO'}),'INVALID_AUDIO');throws(()=>validateAudioInput({...a,languageHint:'xx'}),'INVALID_AUDIO');});
test('v129 aborted requests fail closed',async()=>{const a=mk(),abort=new AbortController();abort.abort();throws(()=>validateAudioInput({...a,abortSignal:abort.signal}),'ABORTED');await assert.rejects(()=>demoAudioAdapter.recognize({...a,abortSignal:abort.signal}),e=>e.code==='ABORTED');});
test('v129 catalog contains only synthetic non-speech fixtures; zero STT/Meta calls',async()=>{
 for(const id of DEMO_AUDIO_OPTIONS){const out=await demoAudioAdapter.recognize(mk(id));assert.equal(out.mode,'DIGEST_MAPPED_FIXTURE');assert.equal(out.actualStt,false);assert.equal(out.externalCalls,0);assert.equal(out.segments.length,1);}
});
test('v129 arbitrary test audio cannot be mislabeled recognized',async()=>{
 const a=mk();const bytes=makeSyntheticTone(1750),input={...a,audioBytes:bytes,sizeBytes:bytes.length,inputDigest:digestAudio(bytes)};
 await assert.rejects(()=>demoAudioAdapter.recognize(input),e=>e.code==='UNRECOGNIZED_FIXTURE');
});
test('v129 consented real test audio is NOT transcribed by MOCK fixture adapter',async()=>{
 const a=mk();await assert.rejects(()=>demoAudioAdapter.recognize({...a,sourceType:'CONSENTED_TEST_AUDIO',provenance:'USER_AUTHORIZED_TEST'}),e=>e.code==='UNRECOGNIZED_FIXTURE');
});
test('v129 malformed internal fixture segment rejected',async()=>{
 const a=mk();const bad=new DigestMappedFixtureAdapter(new Map([[a.inputDigest,[{kind:'EXECUTE',turnId:'voice_test',text:'hold',speaker:'caller',quality:'OK',revision:0}]]]));
 await assert.rejects(()=>bad.recognize(a),e=>e.code==='INVALID_AUDIO');
});
function caseWith(text='지금 당장 돈을 송금하세요.'){
 let c=createCase('case_review_v129');c=applyCaseEvent(c,{type:'UTTERANCE_FINAL',caseId:c.caseId,eventId:'event_review_0',turnId:'voice_demo_review',revision:0,absoluteIndex:0,speaker:'caller',text});
 return {state:c,turns:[{turnId:'voice_demo_review',speaker:'caller',text}]};
}
test('v129 normal MOCK review preserves only case engine risk',async()=>{
 const r=await reviewActiveEvidence(caseWith());assert.equal(r.mode,'MOCK');assert.equal(r.status,'MOCK_VALIDATED');assert.equal(r.analysis.riskIndex,getCaseView(caseWith().state).assessment.riskIndex);
 assert.deepEqual(r.evidenceIds,['voice_demo_review']);assert.equal(r.metaCalled,false);
});
test('v129 injected LIVE provider never receives sensitive transcript',async()=>{
 let called=0;const provider={mode:'LIVE',async analyze(){called++;throw new Error('must never be called')}};
 const r=await reviewActiveEvidence({...caseWith(),provider});assert.equal(called,0);assert.equal(r.status,'LOCAL_FALLBACK');assert.equal(r.reasonCode,'PROVIDER_INVALID');
});
test('v129 throw from mock provider does not break fallback or execute financial actions',async()=>{
 const provider={mode:'MOCK',async analyze(){throw new Error('upstream exploded')}};
 const r=await reviewActiveEvidence({...caseWith(),provider});assert.equal(r.status,'LOCAL_FALLBACK');assert.equal(r.reasonCode,'PROVIDER_FAILED');assert.equal(r.analysis.riskLevel,'HIGH');
});
test('v129 model-supplied invented evidence rejected and fallback to canonical ids',async()=>{
 const provider={mode:'MOCK',async analyze(c){const result=await new MockMetaProvider().analyze(c);return {...result,analysis:{...result.analysis,evidenceUtteranceIds:['voice_not_real']}}}};
 const r=await reviewActiveEvidence({...caseWith(),provider});assert.equal(r.status,'LOCAL_FALLBACK');assert.deepEqual(r.evidenceIds,['voice_demo_review']);
});
test('v129 model-supplied wrong score or emergency flag rejected',async()=>{
 for(const mutate of [a=>({...a,riskIndex:0}),a=>({...a,emergencyFlag:!a.emergencyFlag})]){
  const provider={mode:'MOCK',async analyze(c){const r=await new MockMetaProvider().analyze(c);return {...r,analysis:mutate(r.analysis)}}};
  const r=await reviewActiveEvidence({...caseWith(),provider});assert.equal(r.status,'LOCAL_FALLBACK');
 }
});
test('v129 aborted review does not call model',async()=>{
 const abort=new AbortController();abort.abort();let called=0;
 const provider={mode:'MOCK',async analyze(){called++;throw new Error('not called')}};
 const r=await reviewActiveEvidence({...caseWith(),provider,signal:abort.signal});assert.equal(called,0);assert.equal(r.reasonCode,'ABORTED');
});
test('v129 educational quotes have no evidence and no finance proposal',async()=>{
 const r=await reviewActiveEvidence(caseWith('보이스피싱 예방 교육에서 예를 들어 지금 당장 송금하세요 라는 말은 위험합니다.'));
 assert.deepEqual(r.evidenceIds,[]);assert.equal(r.analysis.riskIndex,0);
});
test('v129 retracted text cannot be leaked into later model interpretation',async()=>{
 const {state,turns}=caseWith();const retracted=applyCaseEvent(state,{type:'UTTERANCE_RETRACT',caseId:state.caseId,eventId:'retract_1',turnId:'voice_demo_review',revision:1});
 let called=0;const provider={mode:'MOCK',async analyze(){called++;throw new Error('should not call')}};
 const r=await reviewActiveEvidence({state:retracted,turns,provider});assert.equal(r.status,'NO_ACTIVE_EVIDENCE');assert.equal(called,0);
});
async function harness(){
 const srv=createDemoServer({port:0});const {port}=await srv.listen();const base=`http://127.0.0.1:${port}`;
 async function post(path,data,headers={}){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};}
 const init=await post('/api/session/create',{scenarioId:'benign',mode:'verified'});assert.equal(init.status,201);
 const auth={'X-SafeCall-Session':init.body.sessionCredentials.sessionId,'X-SafeCall-Token':init.body.sessionCredentials.parentToken};
 const child={'X-SafeCall-Session':init.body.sessionCredentials.sessionId,'X-SafeCall-Token':init.body.sessionCredentials.childToken};
 return {srv,base,post,auth,child,state:init.body,async get(path,headers=auth){const r=await fetch(base+path,{headers});return {status:r.status,body:await r.json()};},async call(path,data){const r=await post(path,{runId:this.state.runId,expectedVersion:this.state.version,...data},auth);if(r.status===200&&r.body?.runId)this.state=r.body;return r;}};
}
test('v129 authenticated capability endpoint honestly denies actual STT',async()=>{
 const h=await harness();try{const r=await h.get('/api/voice/stt/capabilities');assert.equal(r.status,200);assert.equal(r.body.actualStt,false);assert.equal(r.body.realAudioUpload,false);assert.equal(r.body.metaCalled,false);
 assert.equal((await h.get('/api/voice/stt/capabilities',h.child)).status,403);assert.equal((await h.get('/api/voice/stt/capabilities',{})).status,403);}finally{await h.srv.close();}
});
test('v129 HTTP synthetic OTP fixture to canonical risk and read-only MOCK review',async()=>{
 const h=await harness();try{const v=await h.call('/api/voice/stt/fixture',{fixtureId:'otp',consented:true});assert.equal(v.status,200);assert.ok(v.body.risk.index>0);assert.equal(v.body.voiceFixture.mode,'FIXTURE');assert.equal(v.body.safeBank.status,'READY');assert.equal(v.body.mockCard.status,'ACTIVE');
 const review=await h.get('/api/voice/review');assert.equal(review.body.metaCalled,false);assert.equal(review.body.actualStt,false);assert.equal(review.body.analysisMode,'MOCK');
 const same=await h.call('/api/voice/stt/fixture',{fixtureId:'otp',consented:true});assert.equal(same.status,200);assert.equal(same.body.risk.index,v.body.risk.index);assert.equal(same.body.mockCard.status,'ACTIVE');
 }finally{await h.srv.close();}
});
test('v129 HTTP rejects child, missing consent, unexpected instructions, stale case, and unknown fixtures',async()=>{
 const h=await harness();try{
 const v={runId:h.state.runId,expectedVersion:h.state.version,fixtureId:'otp',consented:true};
 assert.equal((await h.post('/api/voice/stt/fixture',v)).status,403);
 assert.equal((await h.post('/api/voice/stt/fixture',v,h.child)).status,403);
 assert.equal((await h.post('/api/voice/stt/fixture',{...v,consented:false},h.auth)).status,400);
 assert.equal((await h.post('/api/voice/stt/fixture',{...v,fixtureId:'live-model'},h.auth)).status,400);
 assert.equal((await h.post('/api/voice/stt/fixture',{...v,doCardLock:true},h.auth)).status,400);
 assert.equal((await h.post('/api/voice/stt/fixture',{...v,expectedVersion:12345},h.auth)).status,409);
 }finally{await h.srv.close();}
});
test('v129 uncertain fixture ignored, quote benign, synthetic sound never proves user identity',async()=>{
 const h=await harness();try{
 let r=await h.call('/api/voice/stt/fixture',{fixtureId:'noisy',consented:true});assert.equal(r.status,200);assert.equal(r.body.risk.index,0);assert.equal(r.body.transcript.length,0);
 r=await h.call('/api/voice/stt/fixture',{fixtureId:'quote',consented:true});assert.equal(r.status,200);assert.equal(r.body.risk.index,0);
 assert.equal(r.body.mockCard.status,'ACTIVE');assert.equal(r.body.safeBank.status,'READY');
 }finally{await h.srv.close();}
});
test('v129 closing case prevents synthetic voice events and does not enable funds transfer',async()=>{
 const h=await harness();try{
 await h.call('/api/voice/stt/fixture',{fixtureId:'otp',consented:true});const closed=await h.call('/api/end',{});assert.equal(closed.status,200);
 const denied=await h.call('/api/voice/stt/fixture',{fixtureId:'benign',consented:true});assert.equal(denied.status,409);assert.equal(denied.body.code,'CASE_ENDED');
 }finally{await h.srv.close();}
});
