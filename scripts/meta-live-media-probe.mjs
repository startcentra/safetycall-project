/**
 * PAID, opt-in probe: streams one consented recording to Meta realtime ASR and runs Muse Spark reviews on its finals,
 * through the same server path as /live (clockSource SERVER, real-time pacing). Writes a REDACTED summary only:
 * statuses, close codes, counts, latencies and cost. No transcript text, no key, no upstream message bodies.
 *
 *   node --env-file=%USERPROFILE%\.safecall\meta.env --experimental-strip-types scripts/meta-live-media-probe.mjs \
 *        --media=synthetic-prosecutor-en --i-confirm-rights --i-approve-spend
 *
 * The env file must live OUTSIDE this repository and set MODEL_API_KEY, SAFECALL_MEDIA_ASR_ENABLED=true,
 * META_LIVE_ENABLED=true, META_SPEND_APPROVED=true, META_BUDGET_KILL_SWITCH=false.
 * The public-awareness originals (prosecutor, delivery) are refused unless SAFECALL_MEDIA_EXTERNAL_AUTHORIZED lists them,
 * which an operator may set only after confirming their licence permits third-party AI processing.
 */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {mediaById,MEDIA_CATALOG} from '../demo/safety-challenge/media-realtime.mjs';
import {resolveFfmpeg} from './resolve-ffmpeg.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=new Set(process.argv.slice(2));
const arg=name=>process.argv.slice(2).find(a=>a.startsWith(`--${name}=`))?.split('=')[1];
const fail=(msg,code=2)=>{console.error(`REFUSED: ${msg}`);process.exit(code);};

const envFile=process.execArgv.map((a,i,all)=>a.startsWith('--env-file=')?a.slice(11):a==='--env-file'?all[i+1]:null).find(Boolean);
if(envFile&&!path.relative(ROOT,path.resolve(envFile)).startsWith('..'))fail('the env file is inside the repository; move it outside (e.g. %USERPROFILE%\\.safecall\\meta.env)');
const mediaIds=(arg('media')??'').split(',').filter(Boolean);
if(!mediaIds.length||mediaIds.some(id=>!mediaById(id)))fail(`--media=${MEDIA_CATALOG.map(m=>m.id).join('|')} (comma-separated); run scripts/generate-synthetic-recording.mjs for the synthetic recordings`);
const externalAuthorized=(process.env.SAFECALL_MEDIA_EXTERNAL_AUTHORIZED||'').split(',').map(s=>s.trim()).filter(Boolean);
for(const id of mediaIds){
  const item=mediaById(id);
  if(item.rights.externalAiTransfer!=='SYNTHETIC_OWNED'&&!externalAuthorized.includes(id))
    fail(`${id} is a public-awareness original whose licence for third-party AI processing is not verified; it is never sent unless SAFECALL_MEDIA_EXTERNAL_AUTHORIZED lists it`);
}
if(!args.has('--i-confirm-rights'))fail('--i-confirm-rights is required: you hold the rights to use and transmit these recordings to Meta');
if(!args.has('--i-approve-spend'))fail('--i-approve-spend is required: this makes paid Meta ASR and Muse Spark calls');
const env=process.env;
if(env.SAFECALL_MEDIA_ASR_ENABLED!=='true'||env.META_LIVE_ENABLED!=='true'||env.META_SPEND_APPROVED!=='true'||env.META_BUDGET_KILL_SWITCH!=='false')
  fail('flags are OFF (SAFECALL_MEDIA_ASR_ENABLED, META_LIVE_ENABLED, META_SPEND_APPROVED must be true; META_BUDGET_KILL_SWITCH=false)');
const KEY=env.MODEL_API_KEY||'';
if(KEY.length<8)fail('MODEL_API_KEY is not set in the server environment');
const ffmpegBin=resolveFfmpeg();if(!ffmpegBin)fail('ffmpeg not found (set SAFECALL_FFMPEG_PATH)');

const maxCallsPerRun=Math.min(5,Math.max(1,Number(env.META_MAX_REQUESTS_PER_RUN||4)||4));
const app=createDemoServer({mediaAsrEnabled:true,mediaAsrConfig:{ffmpegBin,externalAuthorizedMediaIds:externalAuthorized,maxRunsPerProcess:Math.max(1,mediaIds.length),maxAudioSecondsPerRun:260,maxAudioSecondsPerProcess:Math.min(1800,260*mediaIds.length)},
  metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:KEY,maxCallsPerRun,maxCallsPerProcess:Math.min(50,maxCallsPerRun*mediaIds.length)}});
const {port}=await app.listen();const base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(p,auth,body){
  const r=await fetch(base+p,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.parentToken}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json().catch(()=>({}))};
}
const sha=buf=>createHash('sha256').update(buf).digest('hex');
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,o[k]]));

async function probe(mediaId){
  const item=mediaById(mediaId);
  const fileHash=sha(await readFile(path.join(ROOT,'demo','safety-challenge','media',item.filename)));
  const created=await call('/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'});
  const auth=created.body.sessionCredentials;
  const startedAt=new Date().toISOString();
  const start=await call('/api/media/start',auth,{runId:created.body.runId,expectedVersion:created.body.version,mediaId,consented:true,rightsConfirmed:true,clockSource:'SERVER'});
  const events=new Map();let st=null;
  if(start.status===202){
    const deadline=Date.now()+(item.durationSeconds+120)*1000;
    for(;;){
      st=(await call('/api/state',auth)).body;
      for(const e of st.media?.events??[])if(!events.has(e.eventId))events.set(e.eventId,e);
      const done=!['CONNECTING','STREAMING','RECONNECTING','FLUSHING'].includes(st.media?.status);
      if(done&&!['PENDING','WAITING_LATEST'].includes(st.metaReview?.status))break;
      if(Date.now()>deadline){await call('/api/media/control',auth,{runId:st.runId,action:'STOP'});st=(await call('/api/state',auth)).body;break;}
      process.stdout.write(`\r${mediaId}: ${st.media?.status} ${Math.round((st.media?.cost?.mediaMs??0)/1000)}s / ${Math.round(item.durationSeconds)}s finals=${st.media?.usableFinals??0}   `);
      await sleep(1000);
    }
    process.stdout.write('\n');
  }
  const m=st?.media??{},all=[...events.values()];
  const count=type=>all.filter(e=>e.type===type).length;
  const finals=all.filter(e=>e.type==='ASR_FINAL');
  const quarantine={};for(const e of all.filter(x=>x.type==='ASR_FINAL_QUARANTINED'))quarantine[e.reason]=(quarantine[e.reason]??0)+1;
  const model=all.filter(e=>e.type.startsWith('AI_ANALYSIS_')).map(e=>({type:e.type,trigger:e.reason,
    ...pick(e,['errorCode','cause','riskLevel','accepted','elapsedMs','emergencyFlag','call','budget']),evidenceCount:e.evidenceTurnIds?.length,inputCount:e.inputTurnIds?.length}));
  const review=st?.metaReview?.review;
  const asrOk=start.status===202&&m.status==='COMPLETE'&&m.provider==='META'&&m.usableFinals>0;
  const modelOk=model.some(e=>e.type==='AI_ANALYSIS_COMPLETED')&&review?.provenance==='MODEL_VERIFIED';
  return {
    mediaId,fileSha256:fileHash,durationSeconds:item.durationSeconds,startedAt,endedAt:new Date().toISOString(),
    verdict:{actualStreamedAsr:asrOk?'SUCCEEDED':'NOT_SUCCEEDED',modelVerifiedAnalysis:modelOk?'SUCCEEDED':'NOT_SUCCEEDED'},
    start:{httpStatus:start.status,code:start.body?.code??null},
    asr:{status:m.status??null,errorCode:m.errorCode??null,closeCode:m.closeCode??null,provider:m.provider??null,model:m.asrModel??null,mode:m.mode??null,
      sessions:m.sessions??null,reconnects:m.reconnects??null,unknownEventTypes:m.unknownEventTypes??[],
      finals:m.finals??0,usableFinals:m.usableFinals??0,quarantinedByReason:quarantine,partialEventsSeen:count('ASR_PARTIAL'),
      finalCharsTotal:finals.reduce((n,e)=>n+(e.text?.length??0),0),
      upstreamErrorTypes:[...new Set(all.filter(e=>e.type==='ASR_ERROR'||e.type==='ASR_UPSTREAM_ERROR').map(e=>e.upstreamErrorType??e.errorType).filter(Boolean))],
      stalls:count('ASR_STALLED'),reconnectEvents:count('ASR_RECONNECTING')},
    latency:m.latency??null,
    cost:m.cost?pick(m.cost,['mediaMs','silenceMs','sentMs','estimatedAsrUsd','sparkCalls','sparkInputTokens','sparkOutputTokens']):null,
    model:{status:st?.metaReview?.status??null,errorCode:st?.metaReview?.errorCode??null,events:model,
      finalReview:review?{trigger:review.trigger,riskLevel:review.riskLevel,accepted:review.accepted,evidenceCount:review.evidenceTurnIds?.length??0,
        inputCount:review.inputTurnIds?.length??0,finalsSince:review.finalsSince,usage:review.usage,provenance:review.provenance}:null},
    rules:{riskBand:st?.risk?.band??null,signalCodes:[...new Set((st?.ruleSignals??[]).map(s=>s.code))]},
    simulated:{gpsStepsApplied:m.gps?.nextStep??0,finalZone:st?.location?.zone??null,bankHold:!!st?.protectionGate?.blocked,source:'SIMULATED_GPS / SIMULATED_BANK_HOLD'},
  };
}

const outDir=path.join(ROOT,'artifacts','v145','meta-live');await mkdir(outDir,{recursive:true});
const results=[];
try{for(const id of mediaIds)results.push(await probe(id));}
finally{await app.close();}
const text=JSON.stringify({generatedAt:new Date().toISOString(),redaction:'no transcript text, no credentials, no upstream bodies, no session identifiers',results},null,2);
if(text.includes(KEY))fail('redaction check failed: summary would contain the credential; nothing written',3);
const file=path.join(outDir,`summary-${mediaIds.join('-')}-${Date.now()}.json`);
await writeFile(file,text);
for(const r of results)console.log(`${r.mediaId}: actual streamed ASR ${r.verdict.actualStreamedAsr} (status ${r.asr.status}, close ${r.asr.closeCode}, error ${r.asr.errorCode}); model-verified analysis ${r.verdict.modelVerifiedAnalysis} (${r.model.status}${r.model.errorCode?' '+r.model.errorCode:''})`);
console.log(`redacted summary: ${path.relative(ROOT,file)}`);
