import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {MEDIA_CATALOG,mediaById,parseServerMessage,PCM_FRAME_BYTES} from '../demo/safety-challenge/media-realtime.mjs';
import {MockMetaProvider} from '../src/modules/analysis/meta-provider.ts';

async function withServer(config,fn){const app=createDemoServer(config);const {port}=await app.listen();try{return await fn('http://127.0.0.1:'+port);}finally{await app.close();}}
async function req(base,path,auth,body,token){const resp=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':token||auth.parentToken}:{})},...(body?{body:JSON.stringify(body)}:{})});const txt=await resp.text();return {status:resp.status,body:txt?JSON.parse(txt):{}};}

test('v147 two standard TTS and two fixed 20-turn replay WAVs, with bounded paths and byte range',async()=>{
 assert.deepEqual(MEDIA_CATALOG.map(m=>m.id),['synthetic-prosecutor-en','synthetic-delivery-en','training-bank-20-en','training-delivery-20-en']);assert.equal(mediaById('../foo'),null);assert.equal(PCM_FRAME_BYTES,3840);
 await withServer({},async base=>{
  const catalog=await req(base,'/api/media/catalog');assert.equal(catalog.status,200);assert.equal(catalog.body.actualSttAvailable,false);assert.ok(catalog.body.cases.length>=2);
  for(const item of catalog.body.cases){const r=await fetch(base+item.src,{headers:{range:'bytes=0-127'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-type'),'audio/wav');assert.equal((await r.arrayBuffer()).byteLength,128);}
  assert.equal((await fetch(base+'/media/secret.mp4')).status,404);
 });
});
test('v144 no key or consent cannot start paid ASR; glasses role cannot start',async()=>{
 await withServer({},async base=>{
  const cr=await req(base,'/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'});const auth=cr.body.sessionCredentials;
  const payload={runId:cr.body.runId,expectedVersion:cr.body.version,mediaId:'synthetic-prosecutor-en',consented:true,rightsConfirmed:true};
  assert.equal((await req(base,'/api/media/start',auth,payload)).body.code,'STT_UNAVAILABLE','Meta configuration is required to analyze synthetic TTS');
  assert.equal((await req(base,'/api/media/start',auth,payload,auth.glassesToken)).status,403);
  assert.equal((await req(base,'/api/media/start',auth,{...payload,consented:false})).status,400);
  assert.equal((await req(base,'/api/media/start',auth,{...payload,rightsConfirmed:false})).body.code,'CONSENT_REQUIRED');
  assert.equal((await req(base,'/api/state',auth)).body.media,null);
 });
});
test('v144 streaming ASR events use actual runner output and feed case risk; Meta is separate',async()=>{
 let called=0;
 const stub=async ({onStatus,onEvent,signal})=>{
  called++;assert.equal(signal.aborted,false);onStatus('STREAM_READY');onEvent({type:'ASR_PARTIAL',text:'검찰청',mediaTimeMs:3000});
  onEvent({type:'ASR_FINAL',text:'검찰청 수사관입니다. 계좌가 범죄에 연루됐습니다.',mediaTimeMs:9000,speaker:'unknown'});
  onEvent({type:'ASR_FINAL',text:'아무에게도 말하지 말고 지금 안전계좌로 돈을 송금하세요.',mediaTimeMs:18000,speaker:'unknown'});
  onStatus('FLUSHING');return {frames:225,mediaTimeMs:18_000};
 };
 const mock=new MockMetaProvider();
 const metaProvider={analyze:async context=>({...await mock.analyze(context),analysisMode:'LIVE'})};
 await withServer({mediaAsrEnabled:true,mediaAsrRunner:stub,mediaAsrConfig:{externalAuthorizedMediaIds:['prosecutor']},metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:'INJECTED_TEST_KEY'},metaProvider},async base=>{
  const cr=await req(base,'/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'});assert.equal(cr.status,201);const auth=cr.body.sessionCredentials;
  const payload={runId:cr.body.runId,expectedVersion:cr.body.version,mediaId:'synthetic-prosecutor-en',consented:true,rightsConfirmed:true};
  assert.equal((await req(base,'/api/media/start',auth,payload)).status,202);
  let state;for(let i=0;i<30;i++){state=(await req(base,'/api/state',auth)).body;if(state.media?.status==='COMPLETE')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(called,1);assert.equal(state.media?.status,'COMPLETE');assert.equal(state.media?.actualStt,true);
  assert.equal(state.transcript.length,2);assert.ok(state.transcript[0].text.includes('검찰청'));assert.equal(state.voiceFixture.mode,'STREAMED_MEDIA_STT');
  assert.ok(state.media.events.some(x=>x.type==='ASR_FINAL'));assert.ok(state.media.events.some(x=>x.type==='RULES_UPDATED'));
  assert.equal(state.media.events.some(x=>x.type==='SCRIPTED_ADVANCE'),false);
  assert.equal(state.risk.band,'HIGH','streamed ASR evidence must drive the existing case engine');
  for(let step=0;step<9;step++){
    const before=(await req(base,'/api/state',auth)).body;
    const loc=await req(base,'/api/location/fixture',auth,{runId:before.runId,expectedVersion:before.version,routeId:'BANK_APPROACH_V1',step});
    assert.equal(loc.status,200,JSON.stringify(loc.body));
  }
  const bank=(await req(base,'/api/state',auth)).body;assert.equal(bank.protectionGate.blocked,true);
  const transfer=await req(base,'/api/action',auth,{runId:bank.runId,expectedVersion:bank.version,action:'SIMULATED_TRANSFER'});assert.equal(transfer.status,409);
  const hud=await req(base,'/api/glasses/state',auth,undefined,auth.glassesToken);assert.equal(hud.status,200);assert.equal(hud.body.transcript,undefined);
 });
});
test('v144 realtime server messages: partial vs completed turn vs error, unknown types ignored',()=>{
 assert.deepEqual(parseServerMessage(JSON.stringify({type:'transcript',transcript:'hello',final:false,audioProcessedMs:800})),{kind:'TRANSCRIPT',text:'hello',final:false,audioMs:800});
 assert.equal(parseServerMessage(JSON.stringify({type:'speechComplete',turnId:2,transcript:'hello',audioProcessedMs:1600})).kind,'SPEECH_COMPLETE');
 assert.equal(parseServerMessage(JSON.stringify({type:'error',message:'oops',sessionId:'s'})).kind,'ERROR');
 assert.equal(parseServerMessage(JSON.stringify({type:'futureThing'})).kind,'UNKNOWN');
 assert.equal(parseServerMessage('not json').kind,'INVALID');
});