/**
 * Server-side orchestration of one consented recording per case: realtime ASR stream, player clock, transcript routing,
 * quality quarantine, latency/cost accounting, SIMULATED_GPS schedule and model-review triggers.
 * Every event carries a provenance so scripted, streamed, model, simulated-location and simulated-bank data never blur.
 */
import path from 'node:path';
import {mediaById,ASR_URL,ASR_MODEL,ASR_MODES,estimateAsrUsd,assessTranscriptQuality,FRAME_MS,ORIGINAL_MEDIA_IDS} from './media-realtime.mjs';
import {HttpError} from './http-utils.mjs';
import {readReplayFixture,MAX_DIALOGUE_TURNS} from './replay-fixture.mjs';

export const PROVENANCE=Object.freeze({
 SCRIPTED_MOCK:'SCRIPTED_MOCK',SCRIPTED_TTS_REPLAY:'SCRIPTED_MOCK',ACTUAL_STREAMED_ASR:'ACTUAL_STREAMED_ASR',LOCAL_CONTRACT_SIMULATOR:'LOCAL_CONTRACT_SIMULATOR',
 RULE_ENGINE:'RULE_ENGINE',MODEL_VERIFIED:'MODEL_VERIFIED',SIMULATED_GPS:'SIMULATED_GPS',SIMULATED_BANK_HOLD:'SIMULATED_BANK_HOLD',SYSTEM:'SYSTEM'});
export const GPS_SCHEDULE_MS=Object.freeze([24000,40000,56000,72000,88000,104000,120000,136000,150000]);
export const REVIEW_REASONS=Object.freeze(['INITIAL_CONTEXT','RULE_SIGNAL','RISK_BAND_CHANGED','FINALS_WINDOW','GPS_ZONE_CHANGED','AUDIO_COMPLETED']);
const MAX_EVENTS=160,MAX_SAMPLES=240,MAX_QUARANTINE=40;
const LANGS=new Set(['Korean','English']);
const ERROR_CODE=/^[A-Z][A-Z0-9_]{2,47}$/;

const int=(v,min,max,dflt)=>{if(v===undefined)return dflt;if(!Number.isSafeInteger(v)||v<min||v>max)throw new Error('invalid media ASR config');return v;};
export function normalizeMediaConfig(raw={}){
 const provider=raw.provider??'META';
 if(!['META','LOCAL_CONTRACT_SIMULATOR'].includes(provider))throw new Error('invalid media ASR provider');
 const url=provider==='META'?ASR_URL:raw.url;
 // A simulator may only ever run on loopback; the Meta endpoint is fixed and never overridable.
 if(provider!=='META'&&!/^ws:\/\/127\.0\.0\.1:\d{2,5}\/v1\/asr\/realtime$/.test(url??''))throw new Error('simulator must be loopback');
 const mode=raw.mode??'ENDPOINTING';if(!ASR_MODES.includes(mode))throw new Error('invalid media ASR mode');
 const languageBias=raw.languageBias??['Korean'];
 if(!Array.isArray(languageBias)||languageBias.length>2||languageBias.some(l=>!LANGS.has(l)))throw new Error('invalid media ASR languages');
 const gps=raw.gpsScheduleMs??GPS_SCHEDULE_MS,gpsExplicit=raw.gpsScheduleMs!==undefined;
 if(!Array.isArray(gps)||gps.length!==GPS_SCHEDULE_MS.length||gps.some((v,i)=>!Number.isSafeInteger(v)||v<0||v>600_000||(i>0&&v<=gps[i-1])))throw new Error('invalid GPS schedule');
 const modelProvider=raw.modelProvider??'META';if(!['META','LOCAL_CONTRACT_SIMULATOR'].includes(modelProvider))throw new Error('invalid model provider label');
 const authorized=raw.externalAuthorizedMediaIds??[];
 if(!Array.isArray(authorized)||authorized.some(id=>!ORIGINAL_MEDIA_IDS.includes(id)))throw new Error('invalid external transfer authorization');
 return Object.freeze({provider,url,mode,languageBias:[...languageBias],modelProvider,externalAuthorizedMediaIds:Object.freeze([...new Set(authorized)]),
  maxRunsPerProcess:int(raw.maxRunsPerProcess,1,8,4),
  maxAudioSecondsPerRun:int(raw.maxAudioSecondsPerRun,10,600,260),
  maxAudioSecondsPerProcess:int(raw.maxAudioSecondsPerProcess,10,1800,900),
  maxPauseSeconds:int(raw.maxPauseSeconds,5,300,90),
  maxReconnects:int(raw.maxReconnects,0,2,1),
  frameIntervalMs:int(raw.frameIntervalMs,1,FRAME_MS,FRAME_MS),
  clockStaleMs:int(raw.clockStaleMs,250,5000,1500),
  gpsScheduleMs:Object.freeze([...gps]),gpsExplicit,
  ffmpegBin:typeof raw.ffmpegBin==='string'&&raw.ffmpegBin?raw.ffmpegBin:'ffmpeg'});
}

function stats(samples){
 if(!samples.length)return {count:0,p50:null,p95:null,max:null,last:null};
 const s=[...samples].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor(p*(s.length-1)+0.5))];
 return {count:samples.length,p50:q(0.5),p95:q(0.95),max:s.at(-1),last:samples.at(-1)};
}
const safeCode=(value,fallback)=>ERROR_CODE.test(value??'')?value:fallback;

/**
 * `commands` is the per-case command service from server.mjs; it must expose
 * mediaBegin, mediaFinal, mediaLocationStep, mediaMetaReview, protectionBlocked, publish.
 */
export function createMediaOrchestrator({config:rawConfig={},runner,mediaDir,apiKey,isReady,isLegacy=()=>false,now=()=>performance.now(),clock=()=>new Date().toISOString()}){
 const config=normalizeMediaConfig(rawConfig);
 const usage={runs:0,audioMs:0,activeStreams:0};
 const asrProvenance=config.provider==='META'?PROVENANCE.ACTUAL_STREAMED_ASR:PROVENANCE.LOCAL_CONTRACT_SIMULATOR;
 const modelProvenance=config.modelProvider==='META'?PROVENANCE.MODEL_VERIFIED:PROVENANCE.LOCAL_CONTRACT_SIMULATOR;
 const sendsExternally=config.provider==='META'||config.modelProvider==='META';
 /** Rights basis for sending this recording (audio or derived text) to a third-party AI service, or null when not allowed. */
 function transferBasis(item){
  if(!sendsExternally)return 'NOT_APPLICABLE_LOCAL_ONLY';
  if(item?.rights?.externalAiTransfer==='SYNTHETIC_OWNED')return 'SYNTHETIC_OWNED';
  if(config.externalAuthorizedMediaIds.includes(item?.id))return 'OPERATOR_AUTHORIZED';
  return null;
 }

 function pushEvent(ctx,type,provenance,extra={},{publish=true}={}){
  const m=ctx.media;if(!m)return null;
  const event={eventId:`media_${m.eventsSeq++}`,caseId:m.runId,at:clock(),type,provenance,playerMs:Math.round(playerPosition(m)),...extra};
  m.events.push(event);if(m.events.length>MAX_EVENTS)m.events.shift();
  if(publish)ctx.commands.publish();
  return event;
 }
 function sample(m,key,value){if(!Number.isFinite(value))return;const list=m.latency[key];list.push(Math.max(0,Math.round(value)));if(list.length>MAX_SAMPLES)list.shift();}
 function playerState(m){
  const p=m.player;
  if(!p.playing)return {playing:false,mediaMs:p.mediaMs};
  const age=now()-p.at;
  // A browser that stops reporting is treated as stalled: the stream then sends silence instead of racing ahead.
  if(age>config.clockStaleMs)return {playing:false,mediaMs:p.mediaMs+config.clockStaleMs};
  return {playing:true,mediaMs:p.mediaMs+age};
 }
 function playerPosition(m){return m.clockSource==='PLAYER'?playerState(m).mediaMs:m.cost.mediaMs;}

 function assertBody(body,keys){
  if(!body||typeof body!=='object'||Object.keys(body).some(k=>!keys.includes(k)))throw new HttpError(400,'허용되지 않은 미디어 요청 필드','VALIDATION_ERROR');
 }
 function start(ctx,body){
  assertBody(body,['runId','expectedVersion','mediaId','consented','rightsConfirmed','clockSource']);
  const run=ctx.run,item=mediaById(body.mediaId);
  if(!item||body.runId!==run?.id||body.expectedVersion!==run.version)throw new HttpError(400,'미디어 ID와 사건 버전을 확인하세요.','VALIDATION_ERROR');
  if(body.consented!==true||body.rightsConfirmed!==true)throw new HttpError(400,'녹음 자료 사용·외부 전송 권리 확인과 분석 동의가 모두 필요합니다.','CONSENT_REQUIRED');
  const clockSource=body.clockSource??'PLAYER';if(!['PLAYER','SERVER'].includes(clockSource))throw new HttpError(400,'clockSource 오류','VALIDATION_ERROR');
  const basis=transferBasis(item);
  // A user checkbox cannot override this: unverified-licence originals stay local unless the operator authorizes them.
  if(!basis)throw new HttpError(403,'이 녹음 자료는 외부 AI 전송 권한이 확인되지 않았습니다. 로컬 재생만 가능합니다.','EXTERNAL_TRANSFER_NOT_AUTHORIZED');
  if(isLegacy(ctx))throw new HttpError(403,'공유 레거시 세션에서는 외부 전송이 금지됩니다.','FORBIDDEN');
  if(ctx.media)throw new HttpError(409,'이 사건은 이미 녹음 분석을 시작했습니다. 새 사건을 시작하세요.','MEDIA_ALREADY_STARTED');
  if(run.step!==0||run.transcript.length||run.endedAt||run.callEndedAt)throw new HttpError(409,'다른 음성·대본과 섞지 말고 사건을 다시 시작하세요.','POLICY_DENIED');
  if(!isReady())throw new HttpError(503,'실시간 음성 분석이 비활성 상태입니다. 서버 키·승인·비용 차단 설정을 확인하세요.','STT_UNAVAILABLE');
  if(usage.runs>=config.maxRunsPerProcess)throw new HttpError(429,'프로세스당 녹음 분석 횟수 한도에 도달했습니다.','RATE_LIMITED');
  const remainingMs=config.maxAudioSecondsPerProcess*1000-usage.audioMs;
  if(remainingMs<10_000)throw new HttpError(429,'프로세스 오디오 전송 예산을 모두 사용했습니다.','RATE_LIMITED');
  usage.runs++;usage.activeStreams++;
  const controller=new AbortController();
  const m=ctx.media={runId:run.id,mediaId:item.id,durationMs:Math.round(item.durationSeconds*1000),provider:config.provider,modelProvider:config.modelProvider,
   asrModel:ASR_MODEL,mode:config.mode,clockSource,status:'CONNECTING',errorCode:null,controller,events:[],eventsSeq:0,partial:null,speaking:false,
   consentReceipt:{at:clock(),analysisConsent:true,rightsConfirmed:true,rightsBasis:basis,mediaKind:item.kind,purpose:'SAFETY_ANALYSIS_OF_SYNTHETIC_TTS',
    externalTransfer:config.provider==='META'?'META_ASR_AND_SPARK':config.modelProvider==='META'?'META_SPARK_ONLY':'NONE_LOOPBACK_SIMULATOR'},
   player:{mediaMs:0,playing:false,at:now(),reports:0,started:false},
   latency:{audioSentToFinalMs:[],finalToRiskMs:[],finalToModelMs:[],playerLagMs:[],modelElapsedMs:[]},
   cost:{mediaMs:0,silenceMs:0,pauseMs:0,startupMs:0,sentMs:0,estimatedAsrUsd:0,sparkCalls:0,sparkInputTokens:0,sparkOutputTokens:0,
    caps:{audioMsPerRun:Math.min(config.maxAudioSecondsPerRun*1000,remainingMs),audioMsPerProcess:config.maxAudioSecondsPerProcess*1000,pauseMs:config.maxPauseSeconds*1000,modelCallsPerRun:null}},
   finals:0,usableFinals:0,quarantined:[],finalTimes:new Map(),gpsNext:0,zone:null,
   gpsScheduleMs:config.gpsExplicit?config.gpsScheduleMs:item.gpsScheduleMs??config.gpsScheduleMs,gateBlocked:false,lastBand:'LOW',lastReviewFinals:0,reviewRequested:false,reviewed:{finals:0,zone:null},
   result:null,unknownEventTypes:[],sessions:0,reconnects:0,startedAt:clock(),endedAt:null};
  ctx.commands.mediaBegin(item.id,{provider:config.provider});
  pushEvent(ctx,'MEDIA_SELECTED',PROVENANCE.SYSTEM,{mediaId:item.id,durationMs:m.durationMs,clockSource},{publish:false});
  pushEvent(ctx,'ASR_CONNECTING',asrProvenance,{model:ASR_MODEL,mode:config.mode},{publish:false});
  const ticker=setInterval(()=>tick(ctx,m),250);ticker.unref?.();
  controller.signal.addEventListener('abort',()=>clearInterval(ticker),{once:true});
  void run_(ctx,m,item,ticker);
 }


 /**
  * Offline recording mode: a bounded 20-turn text fixture is revealed in lockstep with
  * LOCAL TTS playback. Never calls ASR, Meta or a hosted TTS. No future text in snapshots.
  * The detector is the existing RULE ENGINE, not a model. Use for reliable filming only.
  */
 function startReplay(ctx,body){
  assertBody(body,['runId','expectedVersion','mediaId']);
  const run=ctx.run,item=mediaById(body.mediaId);
  if(ctx.media)throw new HttpError(409,'이미 사건 미디어가 실행 중입니다. 새 사건으로 재시작하세요.','MEDIA_ALREADY_STARTED');
  if(!item||run?.id!==body.runId||run.version!==body.expectedVersion)throw new HttpError(400,'현재 사건과 자료를 확인하세요.','VALIDATION_ERROR');
  if(isLegacy(ctx))throw new HttpError(403,'공유 세션에서 오프라인 재현 불가','FORBIDDEN');
  if(ctx.media||run.step!==0||run.transcript.length||run.endedAt||run.callEndedAt)throw new HttpError(409,'새 사건에서만 시작할 수 있습니다.','MEDIA_ALREADY_STARTED');
  let fixture;try{fixture=readReplayFixture(item,mediaDir);}catch{throw new HttpError(422,'검증된 20턴 합성 음성 자료가 없습니다.','REPLAY_FIXTURE_INVALID');}
  const controller=new AbortController(),durationMs=Math.round(item.durationSeconds*1000);
  const m=ctx.media={replay:true,replayTurns:fixture.turns,replayNext:0,scenarioSeed:fixture.seed,runId:run.id,mediaId:item.id,durationMs,
   provider:'SCRIPTED_TTS_REPLAY',modelProvider:'DISABLED',asrModel:'NONE_OFFLINE_REPLAY',mode:'SCRIPTED_TTS_REPLAY',clockSource:'PLAYER',
   status:'STREAMING',errorCode:null,controller,events:[],eventsSeq:0,partial:null,speaking:false,
   consentReceipt:{at:clock(),analysisConsent:false,rightsConfirmed:false,rightsBasis:'SYNTHETIC_LOCAL_REPLAY',mediaKind:item.kind,purpose:'OFFLINE_DEMO',externalTransfer:'NONE'},
   player:{mediaMs:0,playing:false,at:now(),reports:0,started:false},
   latency:{audioSentToFinalMs:[],finalToRiskMs:[],finalToModelMs:[],playerLagMs:[],modelElapsedMs:[]},
   cost:{mediaMs:0,silenceMs:0,pauseMs:0,startupMs:0,sentMs:0,estimatedAsrUsd:0,sparkCalls:0,sparkInputTokens:0,sparkOutputTokens:0,
    caps:{audioMsPerRun:durationMs,audioMsPerProcess:0,pauseMs:0,modelCallsPerRun:0}},
   finals:0,usableFinals:0,quarantined:[],finalTimes:new Map(),gpsNext:0,zone:null,
   gpsScheduleMs:item.gpsScheduleMs??config.gpsScheduleMs,gateBlocked:false,lastBand:'LOW',lastReviewFinals:0,reviewRequested:false,reviewed:{finals:0,zone:null},
   result:null,unknownEventTypes:[],sessions:0,reconnects:0,startedAt:clock(),endedAt:null};
  ctx.commands.mediaBegin(item.id,{provider:m.provider,replay:true});
  pushEvent(ctx,'REPLAY_READY',PROVENANCE.SCRIPTED_MOCK,{scenarioSeed:fixture.seed,turnLimit:MAX_DIALOGUE_TURNS,analysis:'RULE_ENGINE_ONLY',realModelCalled:false},{publish:false});
  const ticker=setInterval(()=>tick(ctx,m),250);ticker.unref?.();
  controller.signal.addEventListener('abort',()=>clearInterval(ticker),{once:true});
  ctx.commands.publish();
 }

 async function run_(ctx,m,item,ticker){
  const alive=()=>ctx.media===m&&!m.controller.signal.aborted;
  let lastSent=0;
  try{
   const result=await runner({inputPath:path.join(mediaDir,item.filename),apiKey,signal:m.controller.signal,url:config.url,mode:config.mode,languageBias:item.languageHint?[item.languageHint]:config.languageBias,
    maxReconnects:config.maxReconnects,ffmpegBin:config.ffmpegBin,frameIntervalMs:config.frameIntervalMs,
    limits:{maxAudioMs:m.cost.caps.audioMsPerRun,maxPauseMs:m.cost.caps.pauseMs},
    playerClock:m.clockSource==='PLAYER'?()=>playerState(m):null,
    onStatus(code,extra={}){if(!alive())return;onStatus(ctx,m,code,extra);},
    onProgress(p){if(!alive())return;
     usage.audioMs+=Math.max(0,(p.mediaMs+p.silenceMs)-lastSent);lastSent=p.mediaMs+p.silenceMs;
     Object.assign(m.cost,{mediaMs:p.mediaMs,silenceMs:p.silenceMs,pauseMs:p.pauseMs,startupMs:p.startupMs,sentMs:p.mediaMs+p.silenceMs,estimatedAsrUsd:estimateAsrUsd(p.mediaMs+p.silenceMs)});
     m.backlogMs=p.backlogMs;m.sessions=p.session;},
    onEvent(event){if(!alive())return;onAsrEvent(ctx,m,event);}});
   if(!alive())return;
   m.result=result;m.unknownEventTypes=result?.unknownEventTypes??[];m.reconnects=result?.reconnects??0;
   m.status='COMPLETE';m.endedAt=clock();m.partial=null;
   tick(ctx,m);
   pushEvent(ctx,'AUDIO_COMPLETED',asrProvenance,{finals:m.finals,usableFinals:m.usableFinals,closeCode:result?.closeCode??null});
   // Compare against what a started review covered: skipped triggers must not consume the reserved end-of-audio call.
   if(m.usableFinals>0&&(m.usableFinals>m.reviewed.finals||m.zone!==m.reviewed.zone))requestReview(ctx,m,'AUDIO_COMPLETED');
  }catch(error){
   if(ctx.media!==m)return;
   const cancelled=m.controller.signal.aborted;
   m.status=cancelled?'STOPPED':'ERROR';m.endedAt=clock();m.partial=null;
   // Coded failure only: no transcript, credential or upstream body is stored.
   m.errorCode=cancelled?(m.stopReason??'MEDIA_CANCELLED'):safeCode(error?.message,'ASR_FAILED');
   m.closeCode=Number.isSafeInteger(error?.closeCode)?error.closeCode:null;
   if(!cancelled)pushEvent(ctx,'ASR_ERROR',asrProvenance,{errorCode:m.errorCode,closeCode:m.closeCode,upstreamErrorType:safeCode(error?.upstream?.errorType?.toUpperCase?.(),null)});
   else ctx.commands.publish();
  }finally{clearInterval(ticker);usage.activeStreams=Math.max(0,usage.activeStreams-1);}
 }

 function onStatus(ctx,m,code,extra){
  if(code==='STREAM_READY'){m.status='STREAMING';m.sessions=extra.session??m.sessions;pushEvent(ctx,'STREAM_READY',asrProvenance,{reconnect:!!extra.reconnect});return;}
  if(code==='ASR_RECONNECTING'){m.status='RECONNECTING';pushEvent(ctx,'ASR_RECONNECTING',asrProvenance,{reason:safeCode(extra.reason,'ASR_RETRY'),attempt:extra.attempt??1});return;}
  if(code==='ASR_STALLED'){pushEvent(ctx,'ASR_STALLED',asrProvenance,{quietMs:extra.quietMs??null});return;}
  if(code==='ASR_UPSTREAM_ERROR'){pushEvent(ctx,'ASR_UPSTREAM_ERROR',asrProvenance,{errorType:safeCode(extra.errorType?.toUpperCase?.(),null)});return;}
  if(code==='FLUSHING'){m.status='FLUSHING';pushEvent(ctx,'FLUSHING',asrProvenance);return;}
 }

 function onAsrEvent(ctx,m,event){
  const at=now();
  if(event.type==='ASR_SPEECH_START'){m.speaking=true;return;}
  if(event.type==='ASR_PARTIAL'){
   if(typeof event.text!=='string')return;
   // Partials are display-only and overwrite each other; they never reach rules or the model.
   m.partial={text:event.text.slice(0,400),asrTurnId:event.asrTurnId??null,mediaTimeMs:event.mediaTimeMs??null,at:clock()};
   const last=m.events.at(-1);if(last?.type==='ASR_PARTIAL')m.events.pop();
   pushEvent(ctx,'ASR_PARTIAL',asrProvenance,{text:m.partial.text,mediaTimeMs:m.partial.mediaTimeMs});
   return;
  }
  if(event.type!=='ASR_FINAL'||typeof event.text!=='string')return;
  m.partial=null;m.speaking=false;m.finals++;
  if(m.events.at(-1)?.type==='ASR_PARTIAL')m.events.pop();
  const endMediaMs=Number.isFinite(event.endMediaMs)?event.endMediaMs:Number.isFinite(event.mediaTimeMs)?event.mediaTimeMs:null;
  const startMediaMs=Number.isFinite(event.startMediaMs)?event.startMediaMs:endMediaMs===null?null:Math.max(0,endMediaMs-3000);
  const quality=event.quality&&typeof event.quality.ok==='boolean'?event.quality:assessTranscriptQuality({text:event.text,startMediaMs,endMediaMs});
  sample(m,'audioSentToFinalMs',event.latency?.audioSentToFinalMs);
  if(m.clockSource==='PLAYER'&&endMediaMs!==null)sample(m,'playerLagMs',playerState(m).mediaMs-endMediaMs);
  const base={text:event.text.trim().slice(0,800),startMediaMs,endMediaMs,speakerLabel:typeof event.speakerLabel==='string'?event.speakerLabel.slice(0,8):null,speakerVerified:false};
  if(!quality.ok){
   // Shown to the guardian as unreliable, never stored as case evidence.
   m.quarantined.push({...base,reason:quality.reason,at:clock()});if(m.quarantined.length>MAX_QUARANTINE)m.quarantined.shift();
   pushEvent(ctx,'ASR_FINAL_QUARANTINED',asrProvenance,{...base,reason:quality.reason});
   return;
  }
  const applied=ctx.commands.mediaFinal({...base,asrTurnId:event.asrTurnId??null});
  if(!applied){pushEvent(ctx,'ASR_FINAL_IGNORED',asrProvenance,{reason:'CASE_LIMIT_OR_CLOSED',startMediaMs,endMediaMs});return;}
  m.usableFinals++;m.finalTimes.set(applied.turnId,at);
  if(m.finalTimes.size>200)m.finalTimes.delete(m.finalTimes.keys().next().value);
  pushEvent(ctx,'ASR_FINAL',asrProvenance,{...base,turnId:applied.turnId},{publish:false});
  const riskMs=now()-at;sample(m,'finalToRiskMs',riskMs);
  pushEvent(ctx,'RULES_UPDATED',PROVENANCE.RULE_ENGINE,{turnId:applied.turnId,riskBand:applied.riskBand,riskIndex:applied.riskIndex,newSignalCodes:applied.newSignalCodes,finalToRiskMs:Math.round(riskMs)},{publish:false});
  checkGate(ctx,m,{publish:false});
  const bandChanged=applied.riskBand!==m.lastBand;m.lastBand=applied.riskBand;
  const reason=applied.newSignalCodes.length?'RULE_SIGNAL':bandChanged?'RISK_BAND_CHANGED':
   m.lastReviewFinals===0&&m.usableFinals>=3&&!m.reviewRequested?'INITIAL_CONTEXT':m.usableFinals-m.lastReviewFinals>=8?'FINALS_WINDOW':null;
  ctx.commands.publish();
  if(reason)requestReview(ctx,m,reason);
 }

 function requestReview(ctx,m,reason){
  if(m.replay)return;
  m.reviewRequested=true;m.lastReviewFinals=m.usableFinals;
  void ctx.commands.mediaMetaReview(reason);
 }

 function checkGate(ctx,m,{publish=true}={}){
  const blocked=ctx.commands.protectionBlocked();
  if(blocked===m.gateBlocked)return;
  m.gateBlocked=blocked;
  pushEvent(ctx,blocked?'SIMULATED_BANK_HOLD_ON':'SIMULATED_BANK_HOLD_OFF',PROVENANCE.SIMULATED_BANK_HOLD,{realBankControlled:false,osControlled:false},{publish});
 }

 /** Server-owned schedule: SIMULATED_GPS steps follow the media position, never browser timers. */
 function tick(ctx,m){
  if(ctx.media!==m||m.controller.signal.aborted||m.status==='STOPPED'||m.status==='ERROR')return;
  const position=playerPosition(m);
  let changed=false;
  if(m.replay&&m.status==='STREAMING'){
   while(m.replayNext<m.replayTurns.length&&m.replayTurns[m.replayNext].endMs<=position){
    const turn=m.replayTurns[m.replayNext++];
    const applied=ctx.commands.mediaFinal({text:turn.text,role:turn.role,startMediaMs:turn.startMs,endMediaMs:turn.endMs});
    if(!applied)break;
    m.finals++;m.usableFinals++;m.cost.mediaMs=turn.endMs;
    pushEvent(ctx,'SCRIPT_TURN_FINAL',PROVENANCE.SCRIPTED_MOCK,{turnId:applied.turnId,role:turn.role,text:turn.text,startMediaMs:turn.startMs,endMediaMs:turn.endMs,turn:m.replayNext,turnLimit:MAX_DIALOGUE_TURNS},{publish:false});
    pushEvent(ctx,'RULES_UPDATED',PROVENANCE.RULE_ENGINE,{turnId:applied.turnId,riskBand:applied.riskBand,riskIndex:applied.riskIndex,newSignalCodes:applied.newSignalCodes},{publish:false});
    checkGate(ctx,m,{publish:false});changed=true;
   }
   if(m.replayNext===m.replayTurns.length&&position>=m.durationMs-160&&m.player.started){
    m.status='COMPLETE';m.endedAt=clock();m.cost.mediaMs=m.durationMs;
    pushEvent(ctx,'AUDIO_COMPLETED',PROVENANCE.SCRIPTED_MOCK,{finals:m.finals,usableFinals:m.usableFinals,actualStt:false,modelCalls:0},{publish:false});
    changed=true;
   }
  }
  while(m.gpsNext<m.gpsScheduleMs.length&&position>=m.gpsScheduleMs[m.gpsNext]){
   const step=m.gpsNext;
   let applied;try{applied=ctx.commands.mediaLocationStep(step);}catch{break;}
   m.gpsNext=step+1;m.zone=applied.zone;changed=true;
   pushEvent(ctx,'SIMULATED_GPS',PROVENANCE.SIMULATED_GPS,{step,zone:applied.zone,distanceMeters:applied.distanceMeters,mediaTimeMs:m.gpsScheduleMs[step]},{publish:false});
   checkGate(ctx,m,{publish:false});
   if(!m.replay&&applied.zone!==applied.previousZone&&(applied.zone==='NEAR_BANK'||applied.zone==='AT_BANK')&&m.usableFinals>0)requestReview(ctx,m,'GPS_ZONE_CHANGED');
  }
  if(changed)ctx.commands.publish();
 }

 function clockReport(ctx,body){
  assertBody(body,['runId','mediaTimeMs','playing']);
  const m=ctx.media;
  if(!m||body.runId!==m.runId||ctx.run?.id!==m.runId)throw new HttpError(409,'현재 녹음 분석 실행이 아닙니다.','CASE_VERSION_CONFLICT');
  if(!Number.isFinite(body.mediaTimeMs)||body.mediaTimeMs<0||body.mediaTimeMs>m.durationMs+5000||typeof body.playing!=='boolean')throw new HttpError(400,'재생 시각 보고 형식 오류','VALIDATION_ERROR');
  if(m.clockSource!=='PLAYER')throw new HttpError(409,'서버 시계 모드에서는 재생 시각을 받지 않습니다.','POLICY_DENIED');
  m.player.reports++;
  if(!['CONNECTING','STREAMING','RECONNECTING','FLUSHING'].includes(m.status))return {status:m.status};
  // The stream may not jump forward: seeking ahead would skip audio that ASR never heard.
  const mediaMs=Math.min(body.mediaTimeMs,m.player.mediaMs+(m.player.playing?now()-m.player.at:0)+2000);
  const was=m.player.playing;
  m.player={...m.player,mediaMs,playing:body.playing,at:now()};
  if(body.playing&&!m.player.started){m.player.started=true;pushEvent(ctx,'PLAYER_STARTED',PROVENANCE.SYSTEM,{mediaTimeMs:Math.round(mediaMs)});}
  else if(was!==body.playing)pushEvent(ctx,body.playing?'MEDIA_RESUMED':'MEDIA_PAUSED',PROVENANCE.SYSTEM,{mediaTimeMs:Math.round(mediaMs)});
  if(m.replay)tick(ctx,m); // authoritative player clock; no duplicate turns between clock and interval ticks
  return {status:m.status,acceptedMediaMs:Math.round(mediaMs)};
 }

 function control(ctx,body){
  assertBody(body,['runId','action']);
  const m=ctx.media;
  if(!m||body.runId!==m.runId||ctx.run?.id!==m.runId||!['PAUSE','RESUME','STOP'].includes(body.action))throw new HttpError(400,'현재 사건의 분석 제어 요청을 확인하세요.','VALIDATION_ERROR');
  if(body.action==='STOP'){stop(ctx,'USER_STOPPED');return;}
  if(!['CONNECTING','STREAMING','RECONNECTING'].includes(m.status))throw new HttpError(409,'진행 중인 분석이 아닙니다.','POLICY_DENIED');
  const playing=body.action==='RESUME';
  if(m.clockSource==='PLAYER'){if(m.player.playing!==playing){m.player={...m.player,mediaMs:playerState(m).mediaMs,playing,at:now()};pushEvent(ctx,playing?'MEDIA_RESUMED':'MEDIA_PAUSED',PROVENANCE.SYSTEM);}}
  else throw new HttpError(409,'서버 시계 모드는 일시정지를 지원하지 않습니다.','POLICY_DENIED');
 }

 function stop(ctx,reason){
  const m=ctx.media;if(!m)return;
  if(['CONNECTING','STREAMING','RECONNECTING','FLUSHING'].includes(m.status)){
   m.stopReason=reason;m.status='STOPPED';m.errorCode=reason;m.partial=null;m.endedAt=clock();
   m.controller.abort();
   pushEvent(ctx,'MEDIA_STOPPED',PROVENANCE.SYSTEM,{reason});
  }else m.controller.abort();
 }
 function dispose(ctx){if(ctx.media){ctx.media.controller.abort();ctx.media=null;}}

 function project(ctx){
  const m=ctx.media;if(!m)return null;
  const latency=Object.fromEntries(Object.entries(m.latency).map(([k,v])=>[k,stats(v)]));
  return {mediaId:m.mediaId,durationMs:m.durationMs,status:m.status,errorCode:m.errorCode,closeCode:m.closeCode??null,provider:m.provider,modelProvider:m.modelProvider,
   provenance:{asr:m.replay?PROVENANCE.SCRIPTED_MOCK:asrProvenance,model:m.replay?PROVENANCE.SCRIPTED_MOCK:modelProvenance,location:PROVENANCE.SIMULATED_GPS,bank:PROVENANCE.SIMULATED_BANK_HOLD},
   asrModel:m.asrModel,mode:m.mode,clockSource:m.clockSource,replay:!!m.replay,turnLimit:MAX_DIALOGUE_TURNS,scenarioSeed:m.scenarioSeed??null,consentReceipt:m.consentReceipt,
   player:{mediaMs:Math.round(playerPosition(m)),playing:m.clockSource==='PLAYER'?playerState(m).playing:m.status==='STREAMING',reports:m.player.reports,started:m.player.started},
   partial:m.partial,speaking:m.speaking,finals:m.finals,usableFinals:m.usableFinals,quarantined:m.quarantined.slice(-MAX_QUARANTINE),
   latency,cost:{...m.cost,caps:{...m.cost.caps}},backlogMs:m.backlogMs??0,sessions:m.sessions,reconnects:m.reconnects,unknownEventTypes:m.unknownEventTypes,
   gps:{nextStep:m.gpsNext,scheduleMs:m.gpsScheduleMs,source:'SIMULATED_GPS'},gateBlocked:m.gateBlocked,
   actualStt:!m.replay&&config.provider==='META'&&m.finals>0,events:m.events.slice(-100),startedAt:m.startedAt,endedAt:m.endedAt};
 }
 function noteReviewStarted(ctx){const m=ctx.media;if(m)m.reviewed={finals:m.usableFinals,zone:m.zone};}
 function recordModel(ctx,{elapsedMs,usage:u,newestTurnId}){
  const m=ctx.media;if(!m)return;
  m.cost.sparkCalls++;
  if(Number.isSafeInteger(u?.inputTokens))m.cost.sparkInputTokens+=u.inputTokens;
  if(Number.isSafeInteger(u?.outputTokens))m.cost.sparkOutputTokens+=u.outputTokens;
  sample(m,'modelElapsedMs',elapsedMs);
  const t=m.finalTimes.get(newestTurnId);if(t!==undefined)sample(m,'finalToModelMs',now()-t);
 }
 function readiness(){return {provider:config.provider,modelProvider:config.modelProvider,mode:config.mode,languageBias:config.languageBias,
  caps:{runsPerProcess:config.maxRunsPerProcess,audioSecondsPerRun:config.maxAudioSecondsPerRun,audioSecondsPerProcess:config.maxAudioSecondsPerProcess,maxPauseSeconds:config.maxPauseSeconds,reconnects:config.maxReconnects},
  usage:{runs:usage.runs,audioSeconds:Math.round(usage.audioMs/1000),activeStreams:usage.activeStreams,estimatedAsrUsd:estimateAsrUsd(usage.audioMs)}};}
 return {config,start,startReplay,clockReport,control,stop,dispose,project,pushEvent,recordModel,noteReviewStarted,transferBasis,checkGate:(ctx)=>ctx.media&&checkGate(ctx,ctx.media),readiness,asrProvenance,modelProvenance};
}
