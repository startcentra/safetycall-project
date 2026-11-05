/**
 * SafeCall v1.47.2 verification harness: two curated 20-turn offline recordings, plus an
 * explicitly opt-in REAL Meta ASR+Muse Spark run on synthetic TTS only.
 *
 * Usage:
 *   npm run verify:cursor                   # offline both + live configuration preflight
 *   npm run verify:cursor:live              # real, paid Meta API; requires external env
 *   npm run verify:cursor:all               # offline both then paid real Meta run
 *
 * The live API check streams the WAV at real-time PLAYER-clock rate via FFmpeg; it is an
 * automated server-side transport test, not audible local browser playback or device proof.
 * It NEVER fabricates ASR finals or model outputs, and it does not print credentials/transcripts.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {readReplayFixture} from '../demo/safety-challenge/replay-fixture.mjs';
import {mediaById} from '../demo/safety-challenge/media-realtime.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MEDIA=path.join(ROOT,'demo/safety-challenge/media');
const CASES=['training-bank-20-en','training-delivery-20-en'];
const mode=(process.argv.find(s=>s.startsWith('--mode='))||'--mode=preflight').split('=')[1];
if(!['preflight','live','all'].includes(mode))throw new Error('Use --mode=preflight|live|all');
const createdAt=new Date().toISOString();
const report={name:'SAFECALL_CURSOR_VERIFICATION',version:'1.47.2',createdAt,inputs:'SYNTHETIC_TTS_ONLY',mode,offline:[],live:{status:'NOT_RUN'},checks:[],limitations:['Browser physical playback not proved by API tests','Real Meta glasses and real bank transfers not tested','Scripted replay never calls Meta or performs STT']};
const ok=(name,detail)=>{report.checks.push({name,status:'PASS',detail});console.log(`PASS ${name}${detail?' — '+detail:''}`)};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(base,pathname,auth=null,body){
 const result=await fetch(base+pathname,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.parentToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(9000)});
 let data;try{data=await result.json();}catch{data={};}
 return {status:result.status,data};
}
function expect(result,status,name){assert.equal(result.status,status,`${name}: expected HTTP ${status}; got ${result.status} (${result.data?.code||'unknown'})`);return result.data;}
function configStatus(){
 const active=process.env.META_LIVE_ENABLED==='true'&&process.env.META_SPEND_APPROVED==='true'&&process.env.META_BUDGET_KILL_SWITCH==='false'&&process.env.SAFECALL_MEDIA_ASR_ENABLED==='true';
 const hasKey=typeof process.env.MODEL_API_KEY==='string'&&process.env.MODEL_API_KEY.length>12;
 const consent=process.env.SAFECALL_LIVE_VERIFY_CONSENT==='YES';
 const ffmpeg=process.env.SAFECALL_FFMPEG_PATH||'ffmpeg';
 const bin=spawnSync(ffmpeg,['-version'],{stdio:'ignore',timeout:7000});
 return {configured:active&&hasKey,explicitConsent:consent,ffmpegAvailable:bin.status===0,
   requiredFlags:['META_LIVE_ENABLED=true','META_SPEND_APPROVED=true','META_BUDGET_KILL_SWITCH=false','SAFECALL_MEDIA_ASR_ENABLED=true','MODEL_API_KEY=<private>','SAFECALL_LIVE_VERIFY_CONSENT=YES'],
   warnings:[...(!active?['SERVER_FLAGS_NOT_ENABLED']:[]),...(!hasKey?['MODEL_API_KEY_MISSING']:[]),...(!consent?['LIVE_VERIFY_CONSENT_MISSING']:[]),...(bin.status!==0?['FFMPEG_NOT_AVAILABLE']:[])]};
}
async function offlineOne(id){
 let time=0;
 const app=createDemoServer({port:0,mediaClockNow:()=>time,mediaAsrEnabled:false,metaConfig:{enabled:false,approved:false,killSwitch:true}});
 const address=await app.listen(),base=`http://127.0.0.1:${address.port}`;
 try{
  const item=mediaById(id);assert.ok(item?.replayAvailable,`replay fixture missing: ${id}`);
  const fixture=readReplayFixture(item,MEDIA);assert.equal(fixture.turns.length,20);
  const cat=expect(await request(base,'/api/media/catalog'),200,'catalog');assert.equal(cat.actualSttAvailable,false);
  const s=expect(await request(base,'/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'}),201,'create');
  const auth=s.sessionCredentials,runId=s.runId;
  const replay=expect(await request(base,'/api/media/replay',auth,{runId,expectedVersion:s.version,mediaId:id}),202,'start replay');
  assert.equal(replay.media?.provider,'SCRIPTED_TTS_REPLAY');
  let previous=0,firstHighTurn=null;
  const clock=async (target,playing)=>{
    time+=Math.max(0,target-previous);previous=target;
    return expect(await request(base,'/api/media/clock',auth,{runId,mediaTimeMs:target,playing}),200,'player clock');
  };
  await clock(0,true);
  for(const [i,turn] of fixture.turns.entries()){
    await clock(turn.endMs+12,true);
    const state=expect(await request(base,'/api/state',auth),200,'turn state');
    assert.equal(state.media.usableFinals,i+1,`replay ${id}: turn ${i+1}`);
    if(state.risk.band==='HIGH'&&firstHighTurn===null)firstHighTurn=i+1;
  }
  const end=Math.round(item.durationSeconds*1000);await clock(end,false);
  const final=expect(await request(base,'/api/state',auth),200,'final state');
  const glasses=expect(await request(base,'/api/glasses/state',auth),200,'glasses');
  assert.equal(final.media.usableFinals,20);assert.equal(final.media.status,'COMPLETE');
  assert.equal(final.media.actualStt,false);assert.equal(final.metaReview.status,'DISABLED');
  assert.equal(final.location.zone,'AT_BANK');assert.equal(final.risk.band,'HIGH');
  assert.equal(final.protectionGate.blocked,true);assert.equal(glasses.severity,'HIGH');
  assert.equal(final.media.cost.sparkCalls,0);
  assert.equal(final.media.events.filter(e=>e.type==='SCRIPT_TURN_FINAL').length,20);
  assert.equal(final.media.events.some(e=>e.type==='AI_ANALYSIS_COMPLETED'),false);
  const transfer=await request(base,'/api/action',auth,{runId,expectedVersion:final.version,action:'SIMULATED_TRANSFER'});
  assert.equal(transfer.status,409);assert.equal(transfer.data?.code,'POLICY_DENIED');
  const row={scenario:id,status:'PASS',turns:20,firstHighTurn,risk:final.risk.band,gps:final.location.zone,hud:glasses.severity,transferHttp:409,transferCode:'POLICY_DENIED',analysis:'RULE_ENGINE_ONLY',metaCalls:0,realAsr:false};
  report.offline.push(row);
  ok(id,`20/20 turns; first HIGH turn=${firstHighTurn}; GPS=AT_BANK; HUD=HIGH; transfer=409`);
 }finally{await app.close()}
}
async function liveOne(){
 const pre=configStatus();
 report.live={status:'SKIPPED_NOT_CONFIGURED',...pre,syntheticCase:CASES[0]};
 if(!pre.configured||!pre.explicitConsent||!pre.ffmpegAvailable){
  console.log('NOT VERIFIED: REAL META ASR + SPARK — missing explicit prerequisites, no external call made.');
  return false;
 }
 const app=createDemoServer({port:0,mediaAsrEnabled:true,mediaAsrConfig:{provider:'META',modelProvider:'META',ffmpegBin:process.env.SAFECALL_FFMPEG_PATH||'ffmpeg',languageBias:['English'],maxRunsPerProcess:1,maxAudioSecondsPerRun:130,maxAudioSecondsPerProcess:135,maxPauseSeconds:10,maxReconnects:1},
  metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:process.env.MODEL_API_KEY,maxCallsPerRun:4,maxCallsPerProcess:4,timeoutMs:12000}});
 const {port}=await app.listen(),base=`http://127.0.0.1:${port}`;
 const id=CASES[0];
 try{
  const ready=expect(await request(base,'/api/readiness'),200,'readiness');
  assert.equal(ready.mediaAsrReady,true);assert.equal(ready.mediaAsrMode,'META_REALTIME_STT_OPT_IN');
  const cat=expect(await request(base,'/api/media/catalog'),200,'catalog');
  const item=cat.cases.find(c=>c.id===id);
  assert.ok(item?.kind==='SYNTHETIC_TTS'&&item.externalTransfer==='SYNTHETIC_OWNED','only owned synthetic TTS is permitted');
  report.live.status='STARTED';
  console.log('LIVE: sending only synthetic TTS audio to Meta. This may incur API charges.');
  const s=expect(await request(base,'/api/session/create',null,{scenarioId:'kidnap',mode:'guidance'}),201,'create');
  const auth=s.sessionCredentials,runId=s.runId;
  const started=expect(await request(base,'/api/media/start',auth,{runId,expectedVersion:s.version,mediaId:id,consented:true,rightsConfirmed:true,clockSource:'PLAYER'}),202,'media start');
  assert.equal(started.media.provider,'META');
  const duration=Math.round(item.durationSeconds*1000),startedAt=performance.now();
  let lastStatus='CONNECTING',lastReport=0;
  const cutoff=duration+45000;
  while(performance.now()-startedAt<cutoff){
    const elapsed=Math.round(performance.now()-startedAt);
    if(elapsed<duration&&elapsed-lastReport>=400){
      lastReport=elapsed;
      await request(base,'/api/media/clock',auth,{runId,mediaTimeMs:Math.min(elapsed,duration),playing:true});
    }else if(elapsed>=duration&&lastReport<duration){
      lastReport=duration;
      await request(base,'/api/media/clock',auth,{runId,mediaTimeMs:duration,playing:false});
    }
    const state=expect(await request(base,'/api/state',auth),200,'state');
    const m=state.media;
    if(m?.status!==lastStatus){lastStatus=m?.status??'NONE';console.log(`LIVE status=${lastStatus}, finalCount=${m?.usableFinals??0}`)}
    if(m?.status==='ERROR'||m?.status==='STOPPED'){report.live.status='FAILED';report.live.reason=m.errorCode||m.status;break}
    if(m?.status==='COMPLETE'){
      // Allow the last bounded model review to finish; do not claim success from ASR alone.
      if(state.metaReview.status!=='PENDING'&&state.metaReview.status!=='WAITING_LATEST')break;
    }
    await wait(425);
  }
  const final=expect(await request(base,'/api/state',auth),200,'final live state');
  const events=final.media?.events??[];
  const actualAsr=final.media?.actualStt===true&&final.media?.provider==='META'&&final.media.usableFinals>0&&events.some(e=>e.type==='ASR_FINAL'&&e.provenance==='ACTUAL_STREAMED_ASR');
  const actualSpark=events.some(e=>e.type==='AI_ANALYSIS_COMPLETED'&&e.provenance==='MODEL_VERIFIED')&&final.metaReview?.review?.analysisMode==='LIVE'&&final.metaReview?.status==='LIVE_VERIFIED';
  const glasses=expect(await request(base,'/api/glasses/state',auth),200,'live hud');
  report.live={status:actualAsr&&actualSpark?'PASS':'FAILED',asrVerified:actualAsr,sparkVerified:actualSpark,
    mediaStatus:final.media?.status??null,mediaErrorCode:final.media?.errorCode??null,metaStatus:final.metaReview?.status??null,
    metaErrorCode:final.metaReview?.errorCode??null,finalCount:final.media?.usableFinals??0,
    modelCalls:final.media?.cost?.sparkCalls??0,gps:final.location?.zone??null,hud:glasses.severity,
    noted:'One timed synthetic WAV streamed via real provider; no real phone, GPS, glasses, or bank access.'};
  if(report.live.status==='PASS')ok('META_REAL_LIVE','ASR_FINAL + verified Muse Spark event observed');
  else console.error('FAIL META_REAL_LIVE: provider output was not verified. Check report and Cursor logs (redact secrets).');
  return report.live.status==='PASS';
 }finally{await app.close()}
}
try{
 if(mode!=='live')for(const id of CASES)await offlineOne(id);
 if(mode==='live'||mode==='all'){
  const pass=await liveOne();if(!pass)process.exitCode=2;
 }else{
  const pre=configStatus();report.live={status:'SKIPPED_NOT_EXECUTED',configured:pre.configured,explicitConsent:pre.explicitConsent,ffmpegAvailable:pre.ffmpegAvailable,warnings:pre.warnings};
  console.log('PREFLIGHT Meta LIVE: '+(pre.configured?'server credentials/flags present':'not configured')+'; real provider not contacted.');
 }
}catch(error){
 report.failure={type:error.name||'Error',detail:String(error.message||error).slice(0,350).replace(/Bearer\s+\S+/gi,'[redacted]')};
 console.error('FAIL: '+report.failure.detail);process.exitCode=1;
}finally{
 const output=path.join(ROOT,'artifacts','cursor-verification','results.json');
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(`Verification report: ${path.relative(ROOT,output)}`);
}
