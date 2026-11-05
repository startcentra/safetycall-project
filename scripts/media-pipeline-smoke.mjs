/**
 * Offline smoke of the full media path: real MP4 -> FFmpeg 24 kHz PCM -> realtime adapter -> LOCAL contract simulator
 * -> orchestrator -> rules / SIMULATED_GPS / SafeBank gate. No network, no key, no Meta. Transcript text is placeholder.
 * Usage: node --experimental-strip-types scripts/media-pipeline-smoke.mjs [synthetic-prosecutor-en|synthetic-delivery-en] [frameIntervalMs]
 */
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {streamMediaToMuse} from '../demo/safety-challenge/media-realtime.mjs';
import {createSimulatedWebSocketFactory} from '../demo/safety-challenge/asr-contract-simulator.mjs';
import {resolveFfmpeg} from './resolve-ffmpeg.mjs';

const mediaId=process.argv[2]||'synthetic-prosecutor-en';
const frameIntervalMs=Number(process.argv[3]||1);
const ffmpegBin=resolveFfmpeg();
if(!ffmpegBin){console.error('UNVERIFIED: ffmpeg not found (set SAFECALL_FFMPEG_PATH)');process.exit(2);}
const factory=createSimulatedWebSocketFactory({expectKey:'local-simulator-not-a-key'});
const app=createDemoServer({mediaAsrEnabled:true,mediaAsrRunner:o=>streamMediaToMuse({...o,websocketFactory:factory}),
  mediaAsrConfig:{provider:'LOCAL_CONTRACT_SIMULATOR',url:'ws://127.0.0.1:65535/v1/asr/realtime',modelProvider:'LOCAL_CONTRACT_SIMULATOR',frameIntervalMs,ffmpegBin},
  metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:'local-simulator-not-a-key'},
  metaProvider:{analyze:async()=>{throw Object.assign(new Error('simulator has no model'),{kind:'UNAVAILABLE'});}}});
const {port}=await app.listen();const base=`http://127.0.0.1:${port}`;
const call=async(p,auth,body)=>{const r=await fetch(base+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.parentToken}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
try{
  const created=await call('/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'});const auth=created.body.sessionCredentials;
  const started=Date.now();
  const start=await call('/api/media/start',auth,{runId:created.body.runId,expectedVersion:created.body.version,mediaId,consented:true,rightsConfirmed:true,clockSource:'SERVER'});
  if(start.status!==202)throw new Error(`start ${start.status} ${start.body.code}`);
  let state;
  for(let i=0;i<6000;i++){state=(await call('/api/state',auth)).body;if(!['CONNECTING','STREAMING','FLUSHING','RECONNECTING'].includes(state.media.status))break;await new Promise(r=>setTimeout(r,100));}
  const m=state.media;
  console.log(JSON.stringify({mediaId,wallMs:Date.now()-started,status:m.status,errorCode:m.errorCode,finals:m.finals,usableFinals:m.usableFinals,
    quarantined:m.quarantined.length,quarantineReasons:[...new Set(m.quarantined.map(q=>q.reason))],
    sentMediaMs:m.cost.mediaMs,silenceMs:m.cost.silenceMs,estimatedAsrUsdIfMeta:m.cost.estimatedAsrUsd,gpsNextStep:m.gps.nextStep,zone:state.location.zone,
    eventTypes:[...new Set(m.events.map(e=>e.type))],firstTurns:state.transcript.slice(0,3).map(t=>({text:t.text,startMediaMs:t.startMediaMs,endMediaMs:t.endMediaMs})),
    audioSentToFinalMs:m.latency.audioSentToFinalMs,finalToRiskMs:m.latency.finalToRiskMs},null,1));
}finally{await app.close();}
