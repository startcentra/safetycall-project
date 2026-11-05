import {test} from 'node:test';
import assert from 'node:assert/strict';
import {streamMediaToMuse,buildHandshake,parseServerMessage,classifyClose,createAsrTimeline,assessTranscriptQuality,estimateAsrUsd,
  ASR_URL,ASR_MODEL,PCM_FRAME_BYTES,PCM_BYTES_PER_MS} from '../demo/safety-challenge/media-realtime.mjs';
import {createSimulatedWebSocketFactory} from '../demo/safety-challenge/asr-contract-simulator.mjs';

const KEY='unit-test-key-0000';
const tone=(sec,amp=8000)=>{const n=Math.round(sec*24000),b=Buffer.alloc(n*2);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(amp*Math.sin(i*2*Math.PI*440/24000)),i*2);return b;};
const quiet=sec=>Buffer.alloc(Math.round(sec*24000)*2);
async function* pcm(...parts){for(const p of parts)yield p;}
const speechPattern=()=>pcm(quiet(0.5),tone(1.5),quiet(1),tone(1.2),quiet(1));
async function run(opts={}){
  const events=[],statuses=[];
  const factory=opts.factory??createSimulatedWebSocketFactory({expectKey:KEY,...opts.sim});
  try{
    const result=await streamMediaToMuse({apiKey:KEY,pcmSource:opts.pcm??speechPattern(),websocketFactory:factory,frameIntervalMs:1,
      onEvent:e=>events.push(e),onStatus:(s,x)=>statuses.push([s,x]),...opts.args});
    return {result,events,statuses,factory};
  }catch(error){return {error,events,statuses,factory};}
}

test('handshake follows the documented realtime contract and never biases keywords', ()=>{
  const h=buildHandshake({apiKey:KEY,languageBias:['Korean']});
  assert.deepEqual(h,{authorization:{accessToken:`Bearer ${KEY}`},audioEncoding:'PCM_24KHZ',model:ASR_MODEL,mode:'ENDPOINTING',partialMode:'CUMULATIVE',emitAudioProgress:true,languageBias:['Korean']});
  assert.equal('keywords' in h,false);
  assert.throws(()=>buildHandshake({apiKey:''}),/ASR_API_KEY_MISSING/);
  assert.throws(()=>buildHandshake({apiKey:KEY,mode:'PUSH_TO_TALK'}),/ASR_MODE_UNSUPPORTED/);
  assert.equal(ASR_URL,'wss://api.meta.ai/v1/asr/realtime');
  assert.equal(PCM_FRAME_BYTES,80*PCM_BYTES_PER_MS);
});

test('server message schema: partial vs completed turn, progress, speaker, error, unknown, invalid', ()=>{
  const p=o=>parseServerMessage(JSON.stringify(o));
  assert.deepEqual(p({sessionId:'abc'}),{kind:'ACK',sessionId:'abc'});
  assert.equal(p({type:'transcript',transcript:'안녕',final:false,audioProcessedMs:500}).kind,'TRANSCRIPT');
  assert.equal(p({type:'speechStart',turnId:1,audioProcessedMs:100}).kind,'SPEECH_START');
  assert.equal(p({type:'speechEnd',turnId:1,audioProcessedMs:900}).kind,'SPEECH_END');
  const done=p({type:'speechComplete',turnId:1,transcript:'안녕하세요',audioProcessedMs:950});
  assert.equal(done.kind,'SPEECH_COMPLETE');assert.equal(done.text,'안녕하세요');assert.equal(done.turnId,1);
  assert.equal(p({type:'speaker',label:'A',audioProcessedMs:120}).kind,'SPEAKER');
  assert.equal(p({type:'audioProgress',audioProcessedMs:960}).audioMs,960);
  const err=p({type:'error',message:'secret upstream text '+KEY,sessionId:'s',errorType:'invalid_request_error',errorCode:'bad_audio'});
  assert.equal(err.kind,'ERROR');assert.equal(JSON.stringify(err).includes(KEY),false,'error message bodies are not propagated');
  assert.equal(p({type:'someFutureEvent',x:1}).kind,'UNKNOWN');
  assert.equal(parseServerMessage('{not json').kind,'INVALID');
});

test('close codes: 1000 normal, 1008 never retried, 1011/1013/1006 retried with backoff', ()=>{
  assert.equal(classifyClose(1000).retry,false);
  assert.equal(classifyClose(1008).retry,false);assert.equal(classifyClose(1008).error,'ASR_POLICY_1008');
  assert.equal(classifyClose(1011).retry,true);assert.ok(classifyClose(1013).backoffMs>=classifyClose(1011).backoffMs);
  assert.equal(classifyClose(1006).retry,true);
  assert.equal(classifyClose(4000).retry,false);
});

test('stream: handshake first, audio only after ack, 80 ms frames, finals only from speechComplete, endStream then 1000', async()=>{
  const {result,events,factory,error}=await run();
  assert.equal(error,undefined,error?.message);
  const sent=factory.sockets[0].sent;
  assert.equal(typeof sent[0],'string');assert.equal(JSON.parse(sent[0]).authorization.accessToken,`Bearer ${KEY}`);
  assert.equal(factory.sockets[0].url.includes(KEY),false,'the key never travels in the URL');
  const binary=sent.filter(x=>typeof x!=='string');
  assert.ok(binary.slice(0,-1).every(b=>b.length===PCM_FRAME_BYTES));
  assert.deepEqual(JSON.parse(sent.at(-1)),{type:'endStream'});
  assert.equal(result.closeCode,1000);
  const finals=events.filter(e=>e.type==='ASR_FINAL');
  assert.equal(finals.length,2);
  assert.ok(events.some(e=>e.type==='ASR_PARTIAL'));
  // turn boundaries map back to media time: first tone 0.5–2.0 s, second 3.0–4.2 s
  assert.ok(Math.abs(finals[0].startMediaMs-500)<=240&&Math.abs(finals[0].endMediaMs-2000)<=240,JSON.stringify(finals[0]));
  assert.ok(Math.abs(finals[1].startMediaMs-3000)<=240&&Math.abs(finals[1].endMediaMs-4200)<=240,JSON.stringify(finals[1]));
  assert.ok(finals.every(f=>f.quality&&typeof f.latency.audioSentToFinalMs==='number'));
  assert.equal(result.mediaMs,5200);
});

test('player clock: silence before start and during pause, media time excludes inserted silence, paused tail still flushes', async()=>{
  let calls=0;
  // not started for 30 frames, play 0–2.6 s, pause for 25 frames, then play to the end, then report paused at the end
  const clock=()=>{calls++;
    if(calls<=30)return {playing:false,mediaMs:0};
    if(calls<=63)return {playing:true,mediaMs:(calls-30)*80};
    if(calls<=88)return {playing:false,mediaMs:2640};
    return {playing:calls<=120,mediaMs:Math.min(5200,2640+(calls-88)*80)};
  };
  const {result,events,error}=await run({args:{playerClock:clock}});
  assert.equal(error,undefined,error?.message);
  assert.ok(result.startupMs>=30*80-160,`startup silence ${result.startupMs}`);
  assert.ok(result.pauseMs>=20*80,`pause silence ${result.pauseMs}`);
  assert.equal(result.mediaMs,5200,'every media frame is sent exactly once, including the tail after the final pause');
  const finals=events.filter(e=>e.type==='ASR_FINAL');
  assert.equal(finals.length,2);
  assert.ok(Math.abs(finals[1].startMediaMs-3000)<=320,`second turn mapped to media time, got ${finals[1].startMediaMs}`);
});

test('reconnect: 1011 mid-stream reconnects once and completes; 1008 fails without retry; retries are bounded', async()=>{
  const flaky=createSimulatedWebSocketFactory({plan:i=>i===0?{expectKey:KEY,failAt:{audioMs:1200,closeCode:1011,errorType:'server_error'}}:{expectKey:KEY}});
  const ok=await run({factory:flaky});
  assert.equal(ok.error,undefined,ok.error?.message);
  assert.equal(ok.result.sessions,2);assert.equal(ok.result.reconnects,1);
  assert.ok(ok.statuses.some(([s])=>s==='ASR_RECONNECTING'));
  assert.equal(ok.result.sessionLog[0].closeCode,1011);

  const policy=await run({factory:createSimulatedWebSocketFactory({expectKey:KEY,failAt:{audioMs:800,closeCode:1008,errorType:'invalid_request_error'}})});
  assert.equal(policy.error?.message,'ASR_POLICY_1008');assert.equal(policy.factory.sockets.length,1);

  const always=await run({factory:createSimulatedWebSocketFactory({expectKey:KEY,failAt:{audioMs:400,closeCode:1011}}),args:{maxReconnects:1}});
  assert.ok(always.error);assert.equal(always.factory.sockets.length,2);
});

test('wrong key is rejected at handshake; nothing echoes the key', async()=>{
  const bad=await run({sim:{expectKey:'someone-else'}});
  assert.ok(bad.error);
  assert.equal(bad.factory.sockets[0].sent.filter(x=>typeof x!=='string').length,0,'no audio before ack');
  assert.equal(JSON.stringify({m:bad.error.message,e:bad.events,s:bad.statuses,l:bad.error.sessionLog}).includes(KEY),false);
});

test('timeouts: handshake without ack, and no audioProgress (stall warning, then bounded retry, then failure)', async()=>{
  const mute=(ack)=>{const f=url=>{const t=new EventTarget();const s={url,sent:[],bufferedAmount:0,readyState:0,addEventListener:(...a)=>t.addEventListener(...a),removeEventListener:(...a)=>t.removeEventListener(...a),
    send(d){s.sent.push(d);if(ack&&typeof d==='string'&&d.includes('authorization'))setImmediate(()=>{const e=new Event('message');e.data=JSON.stringify({sessionId:'x'});t.dispatchEvent(e);});},
    close(code=1000){if(s.readyState>=2)return;s.readyState=3;setImmediate(()=>{const e=new Event('close');e.code=code;t.dispatchEvent(e);});}};
    f.sockets.push(s);setImmediate(()=>{s.readyState=1;t.dispatchEvent(new Event('open'));});return s;};f.sockets=[];return f;};
  const hs=await run({factory:mute(false),args:{limits:{handshakeMs:150}}});
  assert.equal(hs.error?.message,'ASR_HANDSHAKE_TIMEOUT');
  const long=pcm(tone(24));
  const stall=await run({factory:mute(true),pcm:long,args:{frameIntervalMs:4,limits:{stallWarnMs:60,noProgressMs:250,flushMs:500}}});
  assert.equal(stall.error?.message,'ASR_NO_PROGRESS');
  assert.ok(stall.statuses.some(([s])=>s==='ASR_STALLED'));
  assert.equal(stall.factory.sockets.length,2,'one bounded reconnect');
});

test('cancellation and caps: abort closes the socket; audio cap and startup cap stop the stream', async()=>{
  const controller=new AbortController();
  const factory=createSimulatedWebSocketFactory({expectKey:KEY});
  const pending=run({factory,pcm:pcm(tone(30)),args:{signal:controller.signal,frameIntervalMs:2}});
  setTimeout(()=>controller.abort(),120);
  const aborted=await pending;
  assert.equal(aborted.error?.message,'ASR_CANCELLED');assert.ok(factory.sockets[0].readyState>=2);
  const capped=await run({pcm:pcm(tone(5)),args:{limits:{maxAudioMs:1000}}});
  assert.equal(capped.error?.message,'ASR_AUDIO_LIMIT');
  const neverPlays=await run({pcm:pcm(tone(5)),args:{playerClock:()=>({playing:false,mediaMs:0}),limits:{startupMs:400}}});
  assert.equal(neverPlays.error?.message,'PLAYER_NOT_STARTED');
});

test('unknown server event types are ignored and reported', async()=>{
  const base=createSimulatedWebSocketFactory({expectKey:KEY});
  const factory=url=>{const s=base(url);s.addEventListener('open',()=>setTimeout(()=>{const e=new Event('message');e.data=JSON.stringify({type:'futureDiagnostics',value:1});s.dispatchEvent?.(e);},5));return s;};
  factory.sockets=base.sockets;
  const {result,error}=await run({factory});
  assert.equal(error,undefined,error?.message);
  assert.ok(Array.isArray(result.unknownEventTypes));
});

test('timeline maps ASR time to media time and identifies inserted silence', ()=>{
  const tl=createAsrTimeline();
  tl.append('SILENCE',0,800);tl.append('MEDIA',0,2000);tl.append('SILENCE',2000,1000);tl.append('MEDIA',2000,1000);
  assert.deepEqual(tl.toMedia(1800),{mediaMs:1000,inSilence:false});
  assert.equal(tl.toMedia(3000).inSilence,true);
  assert.equal(tl.toMedia(4300).mediaMs,2500);
  assert.equal(tl.silenceBetween(2600,4000),1000);
  assert.equal(tl.asrEndMs,4800);
});

test('hallucination guard quarantines pause/silent/artifact/loop/implausible-rate finals and keeps normal speech', ()=>{
  const ok=assessTranscriptQuality({text:'검찰청 수사관입니다. 확인할 것이 있습니다.',startMediaMs:0,endMediaMs:3000,silentRatio:0.1,insertedSilenceRatio:0});
  assert.equal(ok.ok,true);
  assert.equal(assessTranscriptQuality({text:'네',startMediaMs:0,endMediaMs:2000,insertedSilenceRatio:0.95}).reason,'DURING_PAUSE_SILENCE');
  assert.equal(assessTranscriptQuality({text:'네',startMediaMs:0,endMediaMs:2000,silentRatio:0.99}).reason,'SILENT_SOURCE_AUDIO');
  assert.equal(assessTranscriptQuality({text:'시청해 주셔서 감사합니다',startMediaMs:0,endMediaMs:2000}).reason,'KNOWN_ASR_ARTIFACT');
  assert.equal(assessTranscriptQuality({text:'네 네 네 네 네 네 네 네 네 네',startMediaMs:0,endMediaMs:5000}).reason,'REPETITION_LOOP');
  assert.equal(assessTranscriptQuality({text:'가'.repeat(120),startMediaMs:0,endMediaMs:2000}).reason,'REPETITION_LOOP');
  assert.equal(assessTranscriptQuality({text:'가나다라마바사아자차카타파하'.repeat(5),startMediaMs:0,endMediaMs:2000}).reason,'IMPLAUSIBLE_SPEECH_RATE');
  assert.equal(assessTranscriptQuality({text:'  ',startMediaMs:0,endMediaMs:2000}).reason,'EMPTY');
});

test('ASR cost estimate: $0.18 per audio hour, whole seconds', ()=>{
  assert.equal(estimateAsrUsd(3_600_000),0.18);
  assert.equal(estimateAsrUsd(1999),estimateAsrUsd(1000));
  assert.ok(estimateAsrUsd(182_346)<0.01);
});
