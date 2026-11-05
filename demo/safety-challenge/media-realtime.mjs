/** Consent-gated, bounded Meta Muse Voice Transcribe realtime adapter.
 * Streams ACTUAL PCM decoded from a locally generated TTS WAV; no MP4 or third-party recordings.
 * The model sees only finalized ASR turns and verified simulated location events.
 */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';

/**
 * `externalAiTransfer` is the rights basis for sending a recording's audio (or text derived from it) to a third-party AI API.
 * The public-awareness originals are cleared for local playback/testing only until their licence terms are verified;
 * an operator must list them in SAFECALL_MEDIA_EXTERNAL_AUTHORIZED before any external transfer.
 */
// Original third-party recordings are NOT included or selectable.
// Keep the forbidden identifier list only to reject accidental re-enabling of legacy authorization.
export const ORIGINAL_MEDIA_IDS=Object.freeze(['prosecutor','delivery']);
export const SYNTHETIC_MEDIA_RIGHTS=Object.freeze({source:'LOCALLY_GENERATED_SYNTHETIC_TTS',localPlayback:true,externalAiTransfer:'SYNTHETIC_OWNED'});
const TTS_CASES=[
 {id:'synthetic-prosecutor-en',title:'Prosecutor impersonation · TTS',titleKo:'검찰 사칭 · 영어 합성 음성'},
 {id:'synthetic-delivery-en',title:'Registered mail impersonation · TTS',titleKo:'등기배송 사칭 · 영어 합성 음성'},
 {id:'training-bank-20-en',title:'20-turn bank impersonation · stable replay',titleKo:'20턴 은행/검찰 사칭 · 재현'},
 {id:'training-delivery-20-en',title:'20-turn delivery impersonation · stable replay',titleKo:'20턴 등기 사칭 · 재현'},
];
export const SYNTHETIC_MEDIA_IDS=Object.freeze(TTS_CASES.map(s=>s.id));
function loadSynthetic({id,title,titleKo}){
 const manifest=new URL(`./media/${id}.manifest.json`,import.meta.url),asset=new URL(`./media/${id}.wav`,import.meta.url);
 if(!existsSync(manifest)||!existsSync(asset))return null;
 try{
  const m=JSON.parse(readFileSync(manifest,'utf8'));
  if(m.id!==id||m.language!=='en-US'||!Number.isFinite(m.durationSeconds)||m.durationSeconds<5||m.durationSeconds>300)return null;
  const gps=m.gpsScheduleMs,maxMs=m.durationSeconds*1000;
  const gpsOk=Array.isArray(gps)&&gps.length===9&&gps.every((v,i)=>Number.isSafeInteger(v)&&v>=0&&v<=maxMs&&(i===0||v>gps[i-1]));
  return Object.freeze({id,title,titleKo,filename:`${id}.wav`,mimeType:'audio/wav',languageHint:'English',language:'en-US',
   durationSeconds:Math.round(m.durationSeconds*1000)/1000,kind:'SYNTHETIC_TTS',replayAvailable:m.turnLimit===20&&Array.isArray(m.turns)&&m.turns.length===20,scenarioSource:m.scenarioSource??'CURATED_FIXTURE',seed:m.scenarioSeed??null,turnLimit:20,rights:SYNTHETIC_MEDIA_RIGHTS,...(gpsOk?{gpsScheduleMs:Object.freeze([...gps])}:{})});
 }catch{return null;}
}
export const MEDIA_CATALOG=Object.freeze(TTS_CASES.map(loadSynthetic).filter(Boolean));
export function mediaById(id){return MEDIA_CATALOG.find(item=>item.id===id)||null;}

export const ASR_URL='wss://api.meta.ai/v1/asr/realtime';
export const ASR_MODEL='muse-voice-transcribe-1.0';
export const ASR_MODES=Object.freeze(['ENDPOINTING','DIARIZATION']);
export const ASR_USD_PER_AUDIO_HOUR=0.18;
export const PCM_SAMPLE_RATE=24_000;
export const FRAME_MS=80;
export const PCM_BYTES_PER_MS=PCM_SAMPLE_RATE*2/1000;
export const PCM_FRAME_BYTES=PCM_BYTES_PER_MS*FRAME_MS;
const SILENCE_FRAME=Buffer.alloc(PCM_FRAME_BYTES);
const SILENT_DBFS=-50;

export const DEFAULT_STREAM_LIMITS=Object.freeze({
 maxAudioMs:10*60*1000,      // documented transcribe cap; also bounds billing
 maxPauseMs:90_000,          // silence the user may insert by pausing
 startupMs:15_000,           // silence allowed before the player reports playback
 noProgressMs:20_000,        // no audioProgress while audio is flowing → abort
 stallWarnMs:8_000,
 handshakeMs:10_000,
 connectMs:15_000,
 flushMs:20_000,
 maxBacklogMs:3_000,         // service rejects > 5 s ahead of processing
 leadMs:160,
});

export function estimateAsrUsd(audioMs){return Math.round(Math.max(0,Math.floor(audioMs/1000))/3600*ASR_USD_PER_AUDIO_HOUR*1e6)/1e6;}

export function buildHandshake({apiKey,mode='ENDPOINTING',languageBias}){
 if(typeof apiKey!=='string'||!apiKey)throw new Error('ASR_API_KEY_MISSING');
 if(!ASR_MODES.includes(mode))throw new Error('ASR_MODE_UNSUPPORTED');
 const frame={authorization:{accessToken:`Bearer ${apiKey}`},audioEncoding:'PCM_24KHZ',model:ASR_MODEL,mode,partialMode:'CUMULATIVE',emitAudioProgress:true};
 if(Array.isArray(languageBias)&&languageBias.length)frame.languageBias=languageBias.filter(x=>typeof x==='string'&&/^[A-Za-z ]{2,24}$/.test(x)).slice(0,4);
 return frame;
}

const safeCode=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,64}$/.test(v)?v:null;
const ms=v=>Number.isSafeInteger(v)&&v>=0?v:null;
/** Maps one server JSON frame onto the documented ServerMessage union. Unknown types are ignored, not errors. */
export function parseServerMessage(raw){
 let msg;try{msg=typeof raw==='string'?JSON.parse(raw):raw;}catch{return {kind:'INVALID'};}
 if(!msg||typeof msg!=='object'||Array.isArray(msg))return {kind:'INVALID'};
 if(!('type' in msg))return typeof msg.sessionId==='string'&&msg.sessionId?{kind:'ACK',sessionId:msg.sessionId.slice(0,128)}:{kind:'INVALID'};
 const audioMs=ms(msg.audioProcessedMs);
 switch(msg.type){
  case 'transcript':return typeof msg.transcript==='string'&&typeof msg.final==='boolean'?{kind:'TRANSCRIPT',text:msg.transcript.slice(0,1500),final:msg.final,audioMs}:{kind:'INVALID'};
  case 'speechStart':case 'speechEnd':return Number.isSafeInteger(msg.turnId)?{kind:msg.type==='speechStart'?'SPEECH_START':'SPEECH_END',turnId:msg.turnId,audioMs}:{kind:'INVALID'};
  case 'speechComplete':return Number.isSafeInteger(msg.turnId)&&typeof msg.transcript==='string'?{kind:'SPEECH_COMPLETE',turnId:msg.turnId,text:msg.transcript.slice(0,1500),audioMs}:{kind:'INVALID'};
  case 'speaker':return typeof msg.label==='string'?{kind:'SPEAKER',label:msg.label.replace(/[^A-Za-z0-9_-]/g,'').slice(0,8)||'?',audioMs}:{kind:'INVALID'};
  case 'audioProgress':return audioMs===null?{kind:'INVALID'}:{kind:'PROGRESS',audioMs};
  // The upstream message is not stored or forwarded: only taxonomy codes.
  case 'error':return {kind:'ERROR',errorType:safeCode(msg.errorType),errorCode:safeCode(msg.errorCode)};
  default:return {kind:'UNKNOWN',type:String(msg.type).slice(0,40)};
 }
}

export function classifyClose(code){
 if(code===1000)return {code,class:'NORMAL',retry:false,error:null};
 if(code===1008)return {code,class:'POLICY',retry:false,error:'ASR_POLICY_1008'};
 if(code===1011)return {code,class:'BACKEND',retry:true,backoffMs:1500,error:'ASR_BACKEND_1011'};
 if(code===1013)return {code,class:'RATE_LIMITED',retry:true,backoffMs:4000,error:'ASR_RATE_LIMITED_1013'};
 if(code===1006)return {code,class:'NETWORK',retry:true,backoffMs:1500,error:'ASR_NETWORK_1006'};
 return {code,class:'OTHER',retry:false,error:`ASR_CLOSED_${Number.isSafeInteger(code)?code:'UNKNOWN'}`};
}

/** Per-session map from ASR audio time to media time. A pause inserts SILENCE segments that never map to the recording. */
export function createAsrTimeline(){
 const segments=[];let asrEndMs=0;
 return {
  segments,
  get asrEndMs(){return asrEndMs;},
  append(kind,mediaStartMs,durationMs){
   const last=segments.at(-1);
   if(last&&last.kind===kind&&(kind==='SILENCE'||last.mediaStartMs+last.durationMs===mediaStartMs))last.durationMs+=durationMs;
   else segments.push({kind,asrStartMs:asrEndMs,mediaStartMs,durationMs});
   asrEndMs+=durationMs;
  },
  /** Returns {mediaMs, inSilence}. Inside an inserted silence the media position is the frame where playback stopped. */
  toMedia(asrMs){
   if(!Number.isFinite(asrMs)||!segments.length)return {mediaMs:null,inSilence:false};
   const t=Math.max(0,Math.min(asrMs,asrEndMs));
   let seg=segments[0];
   for(const s of segments){if(s.asrStartMs<=t)seg=s;else break;}
   if(seg.kind==='SILENCE')return {mediaMs:seg.mediaStartMs,inSilence:true};
   return {mediaMs:seg.mediaStartMs+Math.min(seg.durationMs,t-seg.asrStartMs),inSilence:false};
  },
  silenceBetween(aMs,bMs){
   let total=0;for(const s of segments){if(s.kind!=='SILENCE')continue;const lo=Math.max(aMs,s.asrStartMs),hi=Math.min(bMs,s.asrStartMs+s.durationMs);if(hi>lo)total+=hi-lo;}return total;
  },
 };
}

export function frameDbfs(frame){
 let sum=0;const n=Math.floor(frame.length/2);if(!n)return -120;
 for(let i=0;i<n;i++){const v=frame.readInt16LE(i*2);sum+=v*v;}
 const rms=Math.sqrt(sum/n)/32768;return rms>0?Math.max(-120,20*Math.log10(rms)):-120;
}

const KNOWN_ARTIFACTS=[/시청\s?해\s?주셔서\s?감사합니다/,/구독(?:과|하고)?\s?좋아요/,/자막\s?(?:제공|제작)/,/thanks?\s+for\s+watching/i,/please\s+subscribe/i];
/** Conservative hallucination guard. A quarantined final is shown but never becomes risk evidence or model input. */
export function assessTranscriptQuality({text,startMediaMs,endMediaMs,silentRatio=null,insertedSilenceRatio=0}){
 const clean=String(text??'').normalize('NFKC').replace(/\s+/g,' ').trim();
 if(!clean)return {ok:false,reason:'EMPTY'};
 if(insertedSilenceRatio>=0.9)return {ok:false,reason:'DURING_PAUSE_SILENCE'};
 if(silentRatio!==null&&silentRatio>=0.95)return {ok:false,reason:'SILENT_SOURCE_AUDIO'};
 if(KNOWN_ARTIFACTS.some(re=>re.test(clean)))return {ok:false,reason:'KNOWN_ASR_ARTIFACT'};
 const words=clean.split(' ');
 if(words.length>=8){const counts=new Map();for(const w of words)counts.set(w,(counts.get(w)||0)+1);if(Math.max(...counts.values())/words.length>0.6)return {ok:false,reason:'REPETITION_LOOP'};}
 if(/(.{2,12}?)\1{5,}/.test(clean.replace(/ /g,'')))return {ok:false,reason:'REPETITION_LOOP'};
 const spanSec=Number.isFinite(startMediaMs)&&Number.isFinite(endMediaMs)?(endMediaMs-startMediaMs)/1000:null;
 if(spanSec!==null&&spanSec>=1&&clean.replace(/ /g,'').length/spanSec>25)return {ok:false,reason:'IMPLAUSIBLE_SPEECH_RATE'};
 return {ok:true,reason:null};
}

export function spawnPcmDecoder(inputPath,ffmpegBin='ffmpeg'){
 return spawn(ffmpegBin,['-nostdin','-hide_banner','-loglevel','error','-i',inputPath,'-vn','-ac','1','-ar',String(PCM_SAMPLE_RATE),'-c:a','pcm_s16le','-f','s16le','pipe:1'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
}

function delay(msValue){let id;const promise=new Promise(resolve=>{id=setTimeout(resolve,msValue);});return {promise,cancel:()=>clearTimeout(id)};}
async function race(promise,msValue,timeoutValue){const d=delay(msValue);try{return await Promise.race([promise,d.promise.then(()=>timeoutValue)]);}finally{d.cancel();}}

/**
 * Streams one recording. With `playerClock` the browser video is the master clock: media frames are released only up to
 * the player's position (+leadMs) and silence is sent while it is paused/buffering, so ASR time maps back to video time.
 * Without `playerClock` the file is streamed at real time (headless probe).
 */
export async function streamMediaToMuse({inputPath,apiKey,signal,onEvent=()=>{},onStatus=()=>{},onProgress=()=>{},playerClock=null,
 websocketFactory,url=ASR_URL,ffmpegBin='ffmpeg',pcmSource=null,mode='ENDPOINTING',languageBias=['Korean'],maxReconnects=1,limits={},frameIntervalMs=FRAME_MS}){
 const timer={now:()=>performance.now(),sleep:(t)=>sleep(Math.max(0,t))};
 const L={...DEFAULT_STREAM_LIMITS,...limits};
 const handshake=buildHandshake({apiKey,mode,languageBias});
 if(signal?.aborted)throw new Error('ASR_CANCELLED');
 const makeSocket=websocketFactory||((u)=>new WebSocket(u));
 const pcm={chunks:[],length:0,done:false,error:null,waiters:[]}; // length = bytes decoded but not yet framed
 const wake=()=>{for(const w of pcm.waiters.splice(0))w();};
 let decoder=null;
 const energy=[];
 const counters={mediaMs:0,silenceMs:0,pauseMs:0,startupMs:0,frames:0,finals:0,sessions:0,reconnects:0};
 const sessionLog=[];
 let playbackStarted=!playerClock;
 let current=null;
 const status=(code,extra)=>onStatus(code,extra);

 function startDecoder(){
  if(pcmSource){(async()=>{try{for await(const c of pcmSource){pcm.chunks.push(Buffer.from(c));pcm.length+=c.length;wake();}}catch{pcm.error='AUDIO_DECODE_FAILED';}pcm.done=true;wake();})();return;}
  decoder=spawnPcmDecoder(inputPath,ffmpegBin);
  decoder.on('error',()=>{pcm.error='AUDIO_DECODER_UNAVAILABLE';pcm.done=true;wake();});
  decoder.stdout.on('data',c=>{pcm.chunks.push(c);pcm.length+=c.length;wake();});
  decoder.once('close',code=>{if(code!==0&&!pcm.error&&!signal?.aborted)pcm.error='AUDIO_DECODE_FAILED';pcm.done=true;wake();});
 }
 function takeFrame(){
  if(pcm.length<PCM_FRAME_BYTES&&!pcm.done)return null;
  if(pcm.length<=0)return 'EOF';
  const want=Math.min(PCM_FRAME_BYTES,pcm.length-(pcm.length%2));
  if(want<=0){pcm.length=0;pcm.chunks.length=0;return 'EOF';}
  const out=Buffer.alloc(want);let copied=0;
  while(copied<want){const head=pcm.chunks[0];const room=Math.min(head.length,want-copied);head.copy(out,copied,0,room);copied+=room;
   if(room===head.length)pcm.chunks.shift();else pcm.chunks[0]=head.subarray(room);}
  pcm.length-=want;
  return out;
 }
 async function nextFrame(){
  for(;;){
   if(signal?.aborted)throw new Error('ASR_CANCELLED');
   if(pcm.error)throw new Error(pcm.error);
   const f=takeFrame();if(f)return f;
   await new Promise(r=>{pcm.waiters.push(r);setTimeout(r,200).unref?.();});
  }
 }

 async function openSession(){
  counters.sessions++;
  const correlation=`safecall-${randomUUID()}`;
  const socket=makeSocket(`${url}?sessionId=${encodeURIComponent(correlation)}`);
  const s={socket,index:counters.sessions,timeline:createAsrTimeline(),sentAt:[],turns:new Map(),currentTurn:null,processedMs:0,lastProgressAt:timer.now(),
   upstreamSessionId:null,acked:false,closed:null,error:null,upstream:null,stallWarned:false,feedFinished:false,unknownTypes:new Set()};
  const logEntry={session:s.index,upstreamSessionId:null,closeCode:null,upstreamError:null};sessionLog.push(logEntry);
  const closed=new Promise(resolve=>{socket.addEventListener('close',e=>{s.closed=classifyClose(e?.code);logEntry.closeCode=s.closed.code??null;logEntry.upstreamError=s.upstream;resolve(s.closed);});});
  closed.catch(()=>{});
  s.closedPromise=closed;
  socket.addEventListener('error',()=>{s.error=s.error||'ASR_SOCKET_ERROR';});
  socket.addEventListener('message',e=>{try{handleMessage(s,e.data);}catch{s.error='ASR_RESPONSE_INVALID';try{socket.close(1000);}catch{}}});
  const opened=await race(Promise.race([
   new Promise(r=>socket.addEventListener('open',()=>r('open'),{once:true})),
   closed.then(()=>'closed'),
  ]),L.connectMs,'timeout');
  if(opened!=='open'){try{socket.close(1000);}catch{}
   if(opened==='timeout')throw Object.assign(new Error('ASR_CONNECT_TIMEOUT'),{retryable:false});
   throw closedError(s,'ASR_CONNECT_CLOSED');}
  socket.send(JSON.stringify(handshake));
  const started=timer.now();
  while(!s.acked&&!s.closed&&!s.error&&timer.now()-started<L.handshakeMs){if(signal?.aborted)throw new Error('ASR_CANCELLED');await timer.sleep(20);}
  if(!s.acked){
   if(!s.closed){try{socket.close(1000);}catch{}}
   await race(closed,50,null);
   if(!s.error&&(!s.closed||s.closed.code===1000))throw Object.assign(new Error('ASR_HANDSHAKE_TIMEOUT'),{retryable:false,upstream:s.upstream||null});
   throw closedError(s,'ASR_HANDSHAKE_REJECTED');
  }
  logEntry.upstreamSessionId=s.upstreamSessionId;
  status('STREAM_READY',{session:s.index,reconnect:s.index>1});
  return s;
 }

 function handleMessage(s,data){
  if(typeof data!=='string')return; // the server sends JSON text frames only
  const m=parseServerMessage(data);
  if(m.kind==='INVALID'){s.error='ASR_RESPONSE_INVALID';try{s.socket.close(1000);}catch{}return;}
  if(m.kind==='ACK'){if(!s.acked){s.acked=true;s.upstreamSessionId=m.sessionId;}return;}
  if(!s.acked){s.error='ASR_BAD_HANDSHAKE';try{s.socket.close(1000);}catch{}return;}
  if(m.audioMs!==null&&m.audioMs!==undefined&&m.audioMs>=s.processedMs){s.processedMs=m.audioMs;s.lastProgressAt=timer.now();s.stallWarned=false;}
  const mapped=(a)=>s.timeline.toMedia(a);
  switch(m.kind){
   case 'PROGRESS':return;
   case 'SPEECH_START':s.turns.set(m.turnId,{startAsr:m.audioMs,endAsr:null,speaker:null});s.currentTurn=m.turnId;
    onEvent({type:'ASR_SPEECH_START',asrTurnId:`${s.index}:${m.turnId}`,mediaTimeMs:mapped(m.audioMs).mediaMs});return;
   case 'SPEECH_END':{const t=s.turns.get(m.turnId);if(t)t.endAsr=m.audioMs;return;}
   case 'SPEAKER':{const t=s.turns.get(s.currentTurn);if(t&&!t.speaker)t.speaker=m.label;return;}
   case 'TRANSCRIPT':{
    // ENDPOINTING/DIARIZATION: `final` is stability only; completion is speechComplete. Partials carry no turnId.
    const text=m.text.trim();if(!text)return;
    onEvent({type:'ASR_PARTIAL',text,asrTurnId:s.currentTurn===null?null:`${s.index}:${s.currentTurn}`,mediaTimeMs:mapped(m.audioMs).mediaMs});return;
   }
   case 'SPEECH_COMPLETE':{
    const t=s.turns.get(m.turnId)||{startAsr:null,endAsr:null,speaker:null};s.turns.delete(m.turnId);
    const endAsr=t.endAsr??m.audioMs,startAsr=t.startAsr??Math.max(0,(endAsr??0)-3000);
    const start=mapped(startAsr),end=mapped(endAsr);
    const spanMs=Math.max(1,(endAsr??0)-(startAsr??0));
    const insertedSilenceRatio=s.timeline.silenceBetween(startAsr??0,endAsr??0)/spanMs;
    const silentRatio=silentShare(start.mediaMs,end.mediaMs);
    const text=m.text.trim();
    const sentAt=Number.isFinite(endAsr)?s.sentAt[Math.min(s.sentAt.length-1,Math.floor(endAsr/FRAME_MS))]:undefined;
    const now=timer.now();
    counters.finals++;
    onEvent({type:'ASR_FINAL',text,asrTurnId:`${s.index}:${m.turnId}`,speakerLabel:t.speaker,startMediaMs:start.mediaMs,endMediaMs:end.mediaMs,mediaTimeMs:end.mediaMs,
     quality:assessTranscriptQuality({text,startMediaMs:start.mediaMs,endMediaMs:end.mediaMs,silentRatio,insertedSilenceRatio}),
     latency:{audioSentToFinalMs:Number.isFinite(sentAt)?Math.max(0,Math.round(now-sentAt)):null}});
    return;
   }
   // Retry policy follows the close code that the documented error event precedes.
   case 'ERROR':s.upstream={errorType:m.errorType,errorCode:m.errorCode};status('ASR_UPSTREAM_ERROR',s.upstream);return;
   case 'UNKNOWN':s.unknownTypes.add(m.type);return;
  }
 }
 function silentShare(aMs,bMs){
  if(!Number.isFinite(aMs)||!Number.isFinite(bMs)||bMs<=aMs)return null;
  const a=Math.floor(aMs/FRAME_MS),b=Math.min(energy.length,Math.ceil(bMs/FRAME_MS));if(b<=a)return null;
  let silent=0;for(let i=a;i<b;i++)if(energy[i]<SILENT_DBFS)silent++;return silent/(b-a);
 }

 function closedError(s,fallback){
  const c=s.closed;
  return Object.assign(new Error(s.error||c?.error||fallback),{retryable:!s.error&&!!c?.retry,backoffMs:c?.backoffMs,closeCode:c?.code??null,upstream:s.upstream||null,sessionLog});
 }
 function sendFrame(s,frame,kind){
  if(s.closed)throw closedError(s,'ASR_SOCKET_CLOSED');
  if(s.error)throw closedError(s,s.error);
  s.socket.send(frame);
  const dur=Math.round(frame.length/PCM_BYTES_PER_MS);
  s.sentAt.push(timer.now());
  if(kind==='MEDIA'){s.timeline.append('MEDIA',counters.mediaMs,dur);energy.push(frameDbfs(frame));counters.mediaMs+=dur;}
  else{s.timeline.append('SILENCE',counters.mediaMs,dur);counters.silenceMs+=dur;if(playbackStarted)counters.pauseMs+=dur;else counters.startupMs+=dur;}
  counters.frames++;
 }

 const abortSocket=()=>{try{current?.socket.close(1000);}catch{}if(decoder&&!decoder.killed)decoder.kill('SIGKILL');wake();};
 signal?.addEventListener('abort',abortSocket,{once:true});
 try{
  startDecoder();
  current=await connectWithRetry();
  let pending=null; // media frame taken from the decoder but not yet released by the player clock
  let nextTick=timer.now();let lastProgressReport=0;
  for(;;){
   if(signal?.aborted)throw new Error('ASR_CANCELLED');
   const s=current;
   try{
    if(!pending){pending=await nextFrame();}
    if(pending==='EOF')break;
    const clock=playerClock?playerClock():{playing:true,mediaMs:Infinity};
    if(clock.playing)playbackStarted=true;
    // Paused/ended: release audio up to the paused position (no lead) so the tail is never stranded, then send silence.
    const target=clock.playing?clock.mediaMs+L.leadMs:clock.mediaMs;
    const backlog=s.timeline.asrEndMs-s.processedMs;
    if(counters.mediaMs>=target){sendFrame(s,SILENCE_FRAME,'SILENCE');}
    else{
     sendFrame(s,pending,'MEDIA');pending=null;
     // Catch up once (2x) when the player is ahead and the service backlog is low.
     if(playerClock&&counters.mediaMs<target-400&&backlog<L.maxBacklogMs){const extra=await nextFrame();if(extra!=='EOF'){sendFrame(s,extra,'MEDIA');}else pending='EOF';}
    }
    const sentTotal=counters.mediaMs+counters.silenceMs;
    if(sentTotal>L.maxAudioMs)throw new Error('ASR_AUDIO_LIMIT');
    if(!playbackStarted&&counters.startupMs>L.startupMs)throw new Error('PLAYER_NOT_STARTED');
    if(counters.pauseMs>L.maxPauseMs)throw new Error('MEDIA_PAUSE_LIMIT');
    const quietFor=timer.now()-s.lastProgressAt;
    if(s.timeline.asrEndMs>6000&&quietFor>L.stallWarnMs&&!s.stallWarned){s.stallWarned=true;status('ASR_STALLED',{quietMs:Math.round(quietFor)});}
    if(s.timeline.asrEndMs>6000&&quietFor>L.noProgressMs)throw Object.assign(new Error('ASR_NO_PROGRESS'),{retryable:true,backoffMs:1000});
    if((s.socket.bufferedAmount??0)>PCM_BYTES_PER_MS*10_000)throw Object.assign(new Error('ASR_NETWORK_STALLED'),{retryable:true,backoffMs:1500});
    if(timer.now()-lastProgressReport>=1000){lastProgressReport=timer.now();onProgress({...counters,processedMs:s.processedMs,backlogMs:Math.max(0,backlog),session:s.index});}
   }catch(error){
    if(signal?.aborted)throw new Error('ASR_CANCELLED');
    if(!error.retryable||counters.reconnects>=maxReconnects)throw error;
    counters.reconnects++;
    status('ASR_RECONNECTING',{reason:error.message,attempt:counters.reconnects});
    try{s.socket.close(1000);}catch{}
    await timer.sleep(error.backoffMs??1500);
    current=await connectWithRetry();nextTick=timer.now();continue;
   }
   nextTick+=frameIntervalMs;
   await timer.sleep(nextTick-timer.now());
  }
  const s=current;s.feedFinished=true;
  s.socket.send(JSON.stringify({type:'endStream'}));status('FLUSHING');
  const flushed=await race(s.closedPromise,L.flushMs,null);
  if(!flushed)throw new Error('ASR_FLUSH_TIMEOUT');
  if(s.error||flushed.code!==1000)throw closedError(s,'ASR_CLOSED_ABNORMAL');
  onProgress({...counters,processedMs:s.processedMs,backlogMs:0,session:s.index});
  return {...counters,unknownEventTypes:[...s.unknownTypes],closeCode:flushed.code,sessionLog};
 }finally{
  signal?.removeEventListener('abort',abortSocket);
  if(decoder&&!decoder.killed)decoder.kill('SIGKILL');
  if(current&&!current.closed){try{current.socket.close(1000);}catch{}}
 }

 async function connectWithRetry(){
  for(;;){
   try{return await openSession();}
   catch(error){
    if(signal?.aborted)throw new Error('ASR_CANCELLED');
    if(!error.retryable||counters.reconnects>=maxReconnects)throw error;
    counters.reconnects++;status('ASR_RECONNECTING',{reason:error.message,attempt:counters.reconnects});
    await timer.sleep(error.backoffMs??1500);
   }
  }
 }
}
