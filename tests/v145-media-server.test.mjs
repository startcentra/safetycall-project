import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {normalizeMediaConfig,PROVENANCE} from '../demo/safety-challenge/media-orchestrator.mjs';
import {ASR_URL,MEDIA_CATALOG} from '../demo/safety-challenge/media-realtime.mjs';

const MEDIA_HAS_SYNTHETIC=MEDIA_CATALOG.some(m=>m.kind==='SYNTHETIC_TTS');

const KEY='SERVER_ONLY_TEST_KEY_7f3a';
const FAST_GPS=[1000,2000,3000,4000,5000,6000,7000,8000,9000];
const SCAM=['검찰청 수사관입니다. 계좌가 범죄에 연루됐습니다.','아무에게도 말하지 말고 지금 안전계좌로 돈을 송금하세요.'];
const BENIGN=['엄마 오늘 저녁에 뭐 먹을까요?','내일 학교 끝나고 도서관 갈게요.','비 오니까 우산 챙겨요.'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/** Runner double: the test decides exactly which realtime events arrive and when the stream ends. */
function controlledRunner(){
  const runs=[];
  const runner=opts=>new Promise((resolve,reject)=>{
    const r={opts,resolve,reject,turn:0};runs.push(r);
    opts.signal.addEventListener('abort',()=>reject(new Error('ASR_CANCELLED')),{once:true});
    queueMicrotask(()=>opts.onStatus('STREAM_READY',{session:1}));
  });
  const final=(i,text,{startMediaMs,endMediaMs,quality={ok:true}}={})=>{const r=runs[i],n=r.turn++;
    r.opts.onEvent({type:'ASR_FINAL',text,asrTurnId:n,startMediaMs:startMediaMs??n*4000,endMediaMs:endMediaMs??n*4000+3000,quality,latency:{audioSentToFinalMs:700+n}});};
  const partial=(i,text)=>runs[i].opts.onEvent({type:'ASR_PARTIAL',text,asrTurnId:runs[i].turn,mediaTimeMs:runs[i].turn*4000+500});
  const progress=(i,mediaMs,extra={})=>runs[i].opts.onProgress({mediaMs,silenceMs:0,pauseMs:0,startupMs:0,backlogMs:0,session:1,...extra});
  return {runner,runs,final,partial,progress};
}
function fakeModel(over={}){
  const calls=[];
  return {calls,analyze:async context=>{
    calls.push(context.input);
    if(over.fail)throw Object.assign(new Error('upstream'),{kind:over.fail});
    if(over.delayMs)await sleep(over.delayMs);
    const ids=context.input.turns.map(t=>t.turnId);
    return {analysisMode:'LIVE',model:'test-double',elapsedMs:7,usage:{inputTokens:120,outputTokens:30,totalTokens:150},
      analysis:{riskLevel:'HIGH',riskIndex:82,manipulationIndex:70,detectedSignals:['AUTHORITY_CLAIM'],manipulationTechniques:['AUTHORITY_PRESSURE'],requestedActions:[],
        evidenceUtteranceIds:[ids.at(-1)],normalConversationEvidence:[],uncertainty:'화자 미확인 · 음성인식 오류 가능',recommendedActionCodes:['VERIFY_OFFICIAL_CHANNEL'],emergencyFlag:false,...over.analysis}};
  }};
}
async function withServer(options,fn){
  const app=createDemoServer({mediaAsrEnabled:true,metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:KEY,maxCallsPerProcess:50,...options.meta},
    // Runner and model are in-process doubles: nothing leaves the machine, so test-only authorization is safe here.
    mediaAsrConfig:{gpsScheduleMs:FAST_GPS,externalAuthorizedMediaIds:[],...options.media},mediaAsrRunner:options.runner,metaProvider:options.model??fakeModel()});
  const {port}=await app.listen();
  try{return await fn('http://127.0.0.1:'+port);}finally{await app.close();}
}
async function req(base,path,auth,body,token){
  const resp=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':token??auth.parentToken}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const txt=await resp.text();return {status:resp.status,body:txt?JSON.parse(txt):{}};
}
async function session(base){const cr=await req(base,'/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'});assert.equal(cr.status,201);return {auth:cr.body.sessionCredentials,state:cr.body};}
const startBody=(s,extra={})=>({runId:s.state.runId,expectedVersion:s.state.version,mediaId:'synthetic-prosecutor-en',consented:true,rightsConfirmed:true,...extra});
const state=async(base,s)=>(await req(base,'/api/state',s.auth)).body;
async function until(base,s,pred,ms=3000){const end=Date.now()+ms;let st;while(Date.now()<end){st=await state(base,s);if(pred(st))return st;await sleep(25);}assert.fail('condition not reached: '+JSON.stringify(st?.media?.events?.map(e=>e.type)));}
const types=st=>st.media.events.map(e=>e.type);

test('config: Meta URL is fixed, simulator must be loopback, caps and GPS schedule validated', ()=>{
  assert.equal(normalizeMediaConfig({url:'wss://evil.example/v1/asr/realtime'}).url,ASR_URL);
  assert.throws(()=>normalizeMediaConfig({provider:'LOCAL_CONTRACT_SIMULATOR',url:'ws://10.0.0.2:9000/v1/asr/realtime'}),/loopback/);
  assert.throws(()=>normalizeMediaConfig({mode:'PUSH_TO_TALK'}),/mode/);
  assert.throws(()=>normalizeMediaConfig({languageBias:['Klingon']}),/languages/);
  assert.throws(()=>normalizeMediaConfig({gpsScheduleMs:[5,4,3,2,1,0,0,0,0]}),/GPS/);
  assert.throws(()=>normalizeMediaConfig({maxRunsPerProcess:99}),/config/);
  const d=normalizeMediaConfig();
  assert.deepEqual([d.provider,d.mode,d.maxReconnects,d.clockStaleMs],['META','ENDPOINTING',1,1500]);
});

test('only locally generated TTS WAV calls are in catalog; originals never reach the ASR or model', async()=>{
  const runner=controlledRunner(),model=fakeModel();
  assert.throws(()=>normalizeMediaConfig({externalAuthorizedMediaIds:['synthetic-prosecutor-en']}),/authorization/);
  await withServer({runner:runner.runner,model},async base=>{
    const catalog=(await req(base,'/api/media/catalog')).body;
    assert.equal(catalog.cases.length,4);
    assert.equal(catalog.cases.filter(c=>c.replayAvailable).length,2);
    assert.ok(catalog.cases.every(c=>c.kind==='SYNTHETIC_TTS'&&c.src.endsWith('.wav')&&c.externalTransfer==='SYNTHETIC_OWNED'));
    for(const id of ['prosecutor','delivery']){
      assert.equal(catalog.cases.some(c=>c.id===id),false);
      assert.equal((await req(base,`/media/${id}.mp4`)).status,404);
      const s=await session(base);
      const r=await req(base,'/api/media/start',s.auth,startBody(s,{mediaId:id}));
      assert.equal(r.status,400);
    }
    const s=await session(base);
    const started=await req(base,'/api/media/start',s.auth,startBody(s));
    assert.equal(started.status,202);
    assert.equal(started.body.media.consentReceipt.rightsBasis,'SYNTHETIC_OWNED');
    assert.equal(runner.runs.length,1);
  });
});

test('consent and rights are both required; extra fields, legacy, child and glasses roles are refused', async()=>{
  const c=controlledRunner();
  await withServer({runner:c.runner},async base=>{
    const s=await session(base);
    assert.equal((await req(base,'/api/media/start',s.auth,startBody(s,{consented:false}))).body.code,'CONSENT_REQUIRED');
    assert.equal((await req(base,'/api/media/start',s.auth,startBody(s,{rightsConfirmed:false}))).body.code,'CONSENT_REQUIRED');
    assert.equal((await req(base,'/api/media/start',s.auth,startBody(s,{rightsConfirmed:'yes'}))).body.code,'CONSENT_REQUIRED');
    assert.equal((await req(base,'/api/media/start',s.auth,startBody(s,{autoPlay:true}))).status,400);
    assert.equal((await req(base,'/api/media/start',s.auth,startBody(s,{mediaId:'../../etc/passwd'}))).status,400);
    assert.equal((await req(base,'/api/media/start',s.auth,startBody(s),s.auth.childToken)).status,403);
    assert.equal((await req(base,'/api/media/start',s.auth,startBody(s),s.auth.glassesToken)).status,403);
    assert.equal(c.runs.length,0,'nothing is transmitted before both confirmations');
    const ok=await req(base,'/api/media/start',s.auth,startBody(s));
    assert.equal(ok.status,202);
    assert.deepEqual(ok.body.media.consentReceipt.rightsConfirmed,true);
    assert.equal(ok.body.media.consentReceipt.externalTransfer,'META_ASR_AND_SPARK');
    assert.equal((await req(base,'/api/media/start',s.auth,startBody(s,{expectedVersion:ok.body.version}))).body.code,'MEDIA_ALREADY_STARTED');
  });
  const legacy=createDemoServer({allowLegacyShared:true,mediaAsrEnabled:true,mediaAsrRunner:c.runner,metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:KEY}});
  const {port}=await legacy.listen();
  try{
    const st=(await req('http://127.0.0.1:'+port,'/api/state')).body;
    assert.equal((await req('http://127.0.0.1:'+port,'/api/media/start',null,{runId:st.runId,expectedVersion:st.version,mediaId:'synthetic-prosecutor-en',consented:true,rightsConfirmed:true})).status,403);
  }finally{await legacy.close();}
});

test('kill switch, missing approval or missing key keep paid streaming unavailable (503)', async()=>{
  const c=controlledRunner();
  for(const meta of [{killSwitch:true},{approved:false},{apiKey:''},{enabled:false}]){
    await withServer({runner:c.runner,meta},async base=>{
      const s=await session(base);
      assert.equal((await req(base,'/api/media/start',s.auth,startBody(s))).status,503,JSON.stringify(meta));
      const ready=(await req(base,'/api/readiness')).body;
      assert.equal(JSON.stringify(ready).includes(KEY),false);
    });
  }
  assert.equal(c.runs.length,0);
});

test('process caps: run count and audio budget return 429; per-run cap is passed to the stream', async()=>{
  const c=controlledRunner();
  await withServer({runner:c.runner,media:{maxRunsPerProcess:2,maxAudioSecondsPerProcess:12,maxAudioSecondsPerRun:10}},async base=>{
    const a=await session(base);
    assert.equal((await req(base,'/api/media/start',a.auth,startBody(a))).status,202);
    assert.equal(c.runs[0].opts.limits.maxAudioMs,10_000);
    c.progress(0,3000);
    const b=await session(base);
    assert.equal((await req(base,'/api/media/start',b.auth,startBody(b))).body.code,'RATE_LIMITED','remaining process audio below 10 s');
    const ready=(await req(base,'/api/readiness')).body.media;
    assert.equal(ready.usage.runs,1);assert.equal(ready.usage.audioSeconds,3);
  });
});

test('partials overwrite each other and never reach rules; finals feed the case with speaker unverified', async()=>{
  const c=controlledRunner(),model=fakeModel();
  await withServer({runner:c.runner,model},async base=>{
    const s=await session(base);
    await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
    c.partial(0,'검찰');c.partial(0,'검찰청 수사');c.partial(0,'검찰청 수사관입니다 송금');
    let st=await state(base,s);
    assert.equal(types(st).filter(t=>t==='ASR_PARTIAL').length,1);
    assert.equal(st.media.partial.text,'검찰청 수사관입니다 송금');
    assert.equal(st.transcript.length,0);assert.equal(st.risk.band,'LOW','partials never score');
    c.final(0,SCAM[0]);c.final(0,SCAM[1]);
    st=await until(base,s,x=>x.transcript.length===2);
    assert.equal(st.media.partial,null);
    assert.ok(st.transcript.every(t=>t.speakerVerified===false&&t.provenance===PROVENANCE.ACTUAL_STREAMED_ASR&&Number.isFinite(t.startMediaMs)));
    assert.equal(st.risk.band,'HIGH');
    assert.ok(st.ruleSignals.length>0&&st.ruleSignals.every(r=>r.source==='RULE_ENGINE'||r.source));
    assert.ok(types(st).includes('RULES_UPDATED'));
    const latency=st.media.latency;
    assert.equal(latency.audioSentToFinalMs.count,2);assert.ok(latency.finalToRiskMs.p50!==null);
  });
});

test('quarantined finals are shown but never become evidence or model input', async()=>{
  const c=controlledRunner(),model=fakeModel();
  await withServer({runner:c.runner,model},async base=>{
    const s=await session(base);
    await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
    c.final(0,SCAM[1],{quality:{ok:false,reason:'DURING_PAUSE_SILENCE'}});
    c.final(0,'시청해 주셔서 감사합니다',{quality:null});
    const st=await until(base,s,x=>x.media.quarantined.length===2);
    assert.deepEqual(st.media.quarantined.map(q=>q.reason),['DURING_PAUSE_SILENCE','KNOWN_ASR_ARTIFACT']);
    assert.equal(st.transcript.length,0);assert.equal(st.risk.band,'LOW');
    assert.equal(model.calls.length,0);
  });
});

test('player clock: validation, forward-jump clamp, pause/resume events, stale player treated as paused, GPS follows player time', async()=>{
  const c=controlledRunner();
  await withServer({runner:c.runner,media:{clockStaleMs:300}},async base=>{
    const s=await session(base);
    const started=await req(base,'/api/media/start',s.auth,startBody(s));
    const runId=started.body.runId,clock=(b,t)=>req(base,'/api/media/clock',s.auth,{runId,...b},t);
    assert.equal((await clock({mediaTimeMs:-1,playing:true})).status,400);
    assert.equal((await clock({mediaTimeMs:0,playing:'yes'})).status,400);
    assert.equal((await clock({mediaTimeMs:0,playing:true,extra:1})).status,400);
    assert.equal((await clock({mediaTimeMs:999_999,playing:true})).status,400);
    assert.equal((await req(base,'/api/media/clock',s.auth,{runId:'other',mediaTimeMs:0,playing:true})).status,409);
    assert.equal((await clock({mediaTimeMs:0,playing:true},s.auth.childToken)).status,403);
    assert.equal((await clock({mediaTimeMs:0,playing:true},s.auth.glassesToken)).status,403);
    assert.equal(c.runs[0].opts.playerClock().playing,false,'no media is released before the player starts');
    assert.equal((await clock({mediaTimeMs:0,playing:true})).body.acceptedMediaMs,0);
    const jump=(await clock({mediaTimeMs:30_000,playing:true})).body.acceptedMediaMs;
    assert.ok(jump<=2600,`seeking ahead is clamped, got ${jump}`);
    await clock({mediaTimeMs:1500,playing:false});
    const paused=c.runs[0].opts.playerClock();assert.deepEqual([paused.playing,Math.round(paused.mediaMs)],[false,1500]);
    await sleep(700);
    let st=await state(base,s);
    assert.equal(st.media.gps.nextStep,1,'only the 1 s GPS step fired; time stood still while paused');
    await clock({mediaTimeMs:1500,playing:true});
    await sleep(450);
    const stale=c.runs[0].opts.playerClock();
    assert.equal(stale.playing,false,'a player that stops reporting is treated as stalled');
    assert.ok(stale.mediaMs<=1500+300+1);
    st=await state(base,s);
    assert.ok(types(st).includes('PLAYER_STARTED')&&types(st).includes('MEDIA_PAUSED')&&types(st).includes('MEDIA_RESUMED'));
    assert.ok(st.media.events.filter(e=>e.type==='SIMULATED_GPS').every(e=>e.provenance==='SIMULATED_GPS'));
    assert.equal((await req(base,'/api/media/control',s.auth,{runId,action:'PAUSE'})).status,200);
    assert.equal(c.runs[0].opts.playerClock().playing,false);
  });
});

test('SIMULATED_GPS alone never blocks: benign conversation at the bank still allows the virtual transfer', async()=>{
  const c=controlledRunner(),model=fakeModel();
  await withServer({runner:c.runner,model},async base=>{
    const s=await session(base);
    await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
    for(const line of BENIGN)c.final(0,line);
    c.progress(0,9500);
    let st=await until(base,s,x=>x.media.gps.nextStep===9);
    assert.equal(st.location.zone,'AT_BANK');assert.equal(st.location.source??'SIMULATED_GPS','SIMULATED_GPS');
    assert.equal(st.risk.band,'LOW');assert.equal(st.protectionGate.blocked,false,'model HIGH + location alone must not block');
    assert.equal((await req(base,'/api/location/fixture',s.auth,{runId:st.runId,expectedVersion:st.version,routeId:'BANK_APPROACH_V1',step:0})).status,409,'manual GPS is locked while the recording drives it');
    const t=await req(base,'/api/action',s.auth,{runId:st.runId,expectedVersion:st.version,action:'SIMULATED_TRANSFER'});
    assert.equal(t.status,200);
    st=await state(base,s);
    const allowed=st.media.events.find(e=>e.type==='SAFEBANK_TRANSFER_ALLOWED');
    assert.equal(allowed.realMoneySent,false);
  });
});

test('HIGH rules risk + bank proximity denies only the SafeBank virtual transfer, labelled as simulated', async()=>{
  const c=controlledRunner();
  await withServer({runner:c.runner},async base=>{
    const s=await session(base);
    await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
    c.final(0,SCAM[0]);c.final(0,SCAM[1]);
    c.progress(0,9500);
    let st=await until(base,s,x=>x.media.gps.nextStep===9&&x.protectionGate.blocked);
    const on=st.media.events.find(e=>e.type==='SIMULATED_BANK_HOLD_ON');
    assert.deepEqual([on.provenance,on.realBankControlled,on.osControlled],['SIMULATED_BANK_HOLD',false,false]);
    const t=await req(base,'/api/action',s.auth,{runId:st.runId,expectedVersion:st.version,action:'SIMULATED_TRANSFER'});
    assert.equal(t.status,409);
    st=await state(base,s);
    const denied=st.media.events.find(e=>e.type==='SAFEBANK_TRANSFER_DENIED');
    assert.equal(denied.realBankControlled,false);
  });
});

test('Spark review: speaker sent as unknown, location as context, fields stored, protection unaffected, last call reserved', async()=>{
  const c=controlledRunner(),model=fakeModel();
  await withServer({runner:c.runner,model,meta:{maxCallsPerRun:2}},async base=>{
    const s=await session(base);
    await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
    c.final(0,SCAM[0]);
    let st=await until(base,s,x=>x.metaReview.review?.trigger==='RULE_SIGNAL');
    assert.ok(model.calls[0].turns.every(t=>t.speaker==='unknown'));
    const r=st.metaReview.review;
    assert.equal(r.provenance,'MODEL_VERIFIED');assert.equal(r.accepted,true);
    assert.ok(r.uncertainty.length>0&&Array.isArray(r.detectedSignals)&&Array.isArray(r.manipulationTechniques)&&typeof r.emergencyFlag==='boolean');
    assert.deepEqual(r.inputTurnIds,['media_turn_0']);
    assert.ok(st.media.events.find(e=>e.type==='AI_ANALYSIS_COMPLETED').protectionEffect==='NONE_SERVER_RULES_DECIDE');
    c.final(0,SCAM[1]);
    st=await until(base,s,x=>x.media.events.some(e=>e.type==='AI_ANALYSIS_SKIPPED'));
    assert.equal(st.media.events.find(e=>e.type==='AI_ANALYSIS_SKIPPED').cause,'RESERVED_FOR_COMPLETION');
    c.progress(0,9500);await until(base,s,x=>x.media.gps.nextStep===9);
    c.runs[0].resolve({closeCode:1000,reconnects:0,unknownEventTypes:[]});
    st=await until(base,s,x=>x.metaReview.review?.trigger==='AUDIO_COMPLETED');
    assert.equal(model.calls.length,2,'the reserved call is used for the end-of-audio review');
    assert.deepEqual(st.metaReview.review.inputTurnIds,['media_turn_0','media_turn_1']);
    assert.ok(model.calls[1].locationObservation,'SIMULATED_GPS context is sent to the model');
    assert.equal(st.media.cost.sparkCalls,2);assert.equal(st.media.cost.sparkInputTokens,240);
    assert.ok(st.media.latency.finalToModelMs.count>=1);
  });
});

test('model output without evidence is not accepted; model errors leave rules in charge', async()=>{
  const c=controlledRunner();
  await withServer({runner:c.runner,model:fakeModel({analysis:{evidenceUtteranceIds:[]}})},async base=>{
    const s=await session(base);
    await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
    c.final(0,SCAM[0]);
    const st=await until(base,s,x=>x.metaReview.review);
    assert.equal(st.metaReview.review.accepted,false);
  });
  const d=controlledRunner();
  await withServer({runner:d.runner,model:fakeModel({fail:'TIMEOUT'})},async base=>{
    const s=await session(base);
    await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
    d.final(0,SCAM[0]);d.final(0,SCAM[1]);
    const st=await until(base,s,x=>x.media.events.some(e=>e.type==='AI_ANALYSIS_ERROR')&&x.transcript.length===2);
    assert.equal(st.media.events.find(e=>e.type==='AI_ANALYSIS_ERROR').errorCode,'TIMEOUT');
    assert.equal(st.risk.band,'HIGH');
  });
});

test('ASR failure is reported as a code only; upstream text and key never reach state', async()=>{
  const c=controlledRunner();
  await withServer({runner:c.runner},async base=>{
    const s=await session(base);
    await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
    c.runs[0].reject(Object.assign(new Error(`upstream said Bearer ${KEY} invalid`),{closeCode:1008}));
    let st=await until(base,s,x=>x.media.status==='ERROR');
    assert.equal(st.media.errorCode,'ASR_FAILED');assert.equal(st.media.closeCode,1008);
    assert.equal(JSON.stringify(st).includes(KEY),false);
    const s2=await session(base);
    await req(base,'/api/media/start',s2.auth,startBody(s2,{clockSource:'SERVER'}));
    c.runs[1].reject(Object.assign(new Error('ASR_POLICY_1008'),{closeCode:1008}));
    st=await until(base,s2,x=>x.media.status==='ERROR');
    assert.equal(st.media.errorCode,'ASR_POLICY_1008');
    assert.equal(st.media.actualStt,false,'a failed run never claims actual transcription');
  });
});

test('stop, end call, reset and session close abort the stream; nothing leaks across sessions or to glasses', async()=>{
  const c=controlledRunner();
  await withServer({runner:c.runner},async base=>{
    const a=await session(base),b=await session(base);
    let st=(await req(base,'/api/media/start',a.auth,startBody(a))).body;
    c.final(0,SCAM[0]);c.partial(0,'비밀 부분 전사');
    st=await until(base,a,x=>x.transcript.length===1);
    const other=await state(base,b);
    assert.equal(other.media,null);assert.equal(other.transcript.length,0);
    const hudA=(await req(base,'/api/glasses/state',a.auth,undefined,a.auth.glassesToken)).body;
    const hudJson=JSON.stringify(hudA);
    assert.equal(hudJson.includes('검찰청')||hudJson.includes('비밀 부분'),false,'glasses never receive transcript text');
    assert.equal((await req(base,'/api/media/control',a.auth,{runId:st.runId,action:'STOP'},a.auth.glassesToken)).status,403);
    assert.equal((await req(base,'/api/state',a.auth,undefined,b.auth.parentToken)).status,403,'tokens are bound to their own session');
    await req(base,'/api/media/control',a.auth,{runId:st.runId,action:'STOP'});
    assert.equal(c.runs[0].opts.signal.aborted,true);
    st=await state(base,a);
    assert.deepEqual([st.media.status,st.media.errorCode],['STOPPED','USER_STOPPED']);

    let sb=(await req(base,'/api/media/start',b.auth,startBody({state:other}))).body;
    sb=(await req(base,'/api/action',b.auth,{runId:sb.runId,expectedVersion:sb.version,action:'END_CALL'})).body;
    assert.equal(c.runs[1].opts.signal.aborted,true);
    assert.equal(sb.media.errorCode,'CALL_ENDED');

    const cS=await session(base);
    const sc=(await req(base,'/api/media/start',cS.auth,startBody(cS))).body;
    await req(base,'/api/reset',cS.auth,{runId:sc.runId,expectedVersion:sc.version,scenarioId:'kidnap',mode:'guidance'});
    assert.equal(c.runs[2].opts.signal.aborted,true);assert.equal((await state(base,cS)).media,null);

    const dS=await session(base);
    await req(base,'/api/media/start',dS.auth,startBody(dS));
    await fetch(base+'/api/session/close',{method:'POST',headers:{'Content-Type':'application/json','X-SafeCall-Session':dS.auth.sessionId,'X-SafeCall-Token':dS.auth.parentToken},body:'{}'});
    assert.equal(c.runs[3].opts.signal.aborted,true);
  });
});

test('a simulator-labelled run without an injected model never constructs the live Meta provider', async()=>{
  const c=controlledRunner(),realFetch=globalThis.fetch,outbound=[];
  globalThis.fetch=(url,...rest)=>{if(!String(url).startsWith('http://127.0.0.1:'))outbound.push(String(url));return realFetch(url,...rest);};
  try{
    const app=createDemoServer({mediaAsrEnabled:true,mediaAsrRunner:c.runner,metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:KEY},
      mediaAsrConfig:{provider:'LOCAL_CONTRACT_SIMULATOR',url:'ws://127.0.0.1:65535/v1/asr/realtime',modelProvider:'LOCAL_CONTRACT_SIMULATOR'}});
    const {port}=await app.listen();const base='http://127.0.0.1:'+port;
    try{
      const s=await session(base);
      await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}));
      c.final(0,SCAM[0]);c.final(0,SCAM[1]);c.final(0,SCAM[0]+' 다시');
      const st=await until(base,s,x=>x.transcript.length===3);
      await sleep(100);
      assert.equal(st.media.events.some(e=>e.type.startsWith('AI_ANALYSIS_STARTED')),false);
      assert.deepEqual(outbound,[]);
    }finally{await app.close();}
  }finally{globalThis.fetch=realFetch;}
});

test('simulator provider is labelled everywhere and never counted as actual transcription', async()=>{
  const c=controlledRunner();
  await withServer({runner:c.runner,media:{provider:'LOCAL_CONTRACT_SIMULATOR',url:'ws://127.0.0.1:65535/v1/asr/realtime',modelProvider:'LOCAL_CONTRACT_SIMULATOR'}},async base=>{
    const catalog=(await req(base,'/api/media/catalog')).body;
    assert.equal(catalog.actualSttAvailable,false);assert.equal(catalog.asrProvider,'LOCAL_CONTRACT_SIMULATOR');
    const s=await session(base);
    const st0=(await req(base,'/api/media/start',s.auth,startBody(s,{clockSource:'SERVER'}))).body;
    assert.equal(st0.media.consentReceipt.externalTransfer,'NONE_LOOPBACK_SIMULATOR');
    c.final(0,SCAM[0]);
    const st=await until(base,s,x=>x.metaReview.review);
    assert.equal(st.media.actualStt,false);
    assert.equal(st.transcript[0].provenance,'LOCAL_CONTRACT_SIMULATOR');
    assert.equal(st.metaReview.review.provenance,'LOCAL_CONTRACT_SIMULATOR');
    const hud=(await req(base,'/api/glasses/state',s.auth,undefined,s.auth.glassesToken)).body;
    assert.notEqual(JSON.stringify(hud).includes('"metaStatus":"LIVE_VERIFIED"'),true);
  });
});
