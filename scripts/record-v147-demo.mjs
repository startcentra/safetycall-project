/**
 * Local-only filming. Playwright records the browser on this machine; FFmpeg muxes the
 * local TTS WAV because Playwright does not capture speaker audio.
 *
 * This run forces Meta API, live ASR, and spend approval OFF. The picture is an offline
 * scripted replay judged by the local rules engine. It is not a Meta model analysis.
 * Nothing is uploaded.
 *
 * Usage: npm run record:v147
 * Output: artifacts/recordings/
 */
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {resolveFfmpeg} from './resolve-ffmpeg.mjs';

const ROOT=process.cwd(),PORT=process.env.SAFECALL_RECORD_PORT??'4281';
const BASE=`http://127.0.0.1:${PORT}`;
const OUT=path.join(ROOT,'artifacts','recordings');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const run=(cmd,args,capture=false)=>new Promise((resolve,reject)=>{
 let output='';
 const proc=spawn(cmd,args,{cwd:ROOT,stdio:capture?['ignore','pipe','pipe']:['ignore','inherit','inherit'],windowsHide:true});
 if(capture){
  proc.stdout.on('data',chunk=>{output+=chunk.toString();});
  proc.stderr.on('data',chunk=>{output+=chunk.toString();});
 }
 proc.once('error',reject);
 proc.once('exit',code=>code===0?resolve(output):reject(new Error(`${path.basename(cmd)} exited ${code}`)));
});
function srtStamp(ms){
 const t=Math.max(0,Math.round(ms));
 const h=Math.floor(t/3_600_000),m=Math.floor(t%3_600_000/60_000),s=Math.floor(t%60_000/1_000),f=t%1_000;
 const pad=(n,w=2)=>String(n).padStart(w,'0');
 return `${pad(h)}:${pad(m)}:${pad(s)},${pad(f,3)}`;
}
function vttStamp(ms){return srtStamp(ms).replace(',', '.');}
async function waitForServer(){
 for(let tries=0;tries<45;tries++){
  try{const r=await fetch(BASE+'/api/media/catalog',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}
  await sleep(300);
 }
 throw new Error('LOCAL_SERVER_START_FAILED');
}
async function secretNeedles(){
 const needles=[];
 const envPath=process.env.USERPROFILE?path.join(process.env.USERPROFILE,'.safecall','meta.env'):'';
 if(envPath){
  try{
   const raw=await readFile(envPath,'utf8');
   for(const line of raw.split(/\r?\n/)){
    const trimmed=line.trim();
    if(!trimmed||trimmed.startsWith('#'))continue;
    const eq=trimmed.indexOf('=');
    if(eq<1)continue;
    const value=trimmed.slice(eq+1).trim();
    if(value.length>=8)needles.push(value);
   }
  }catch{/* no private env file */}
 }
 return needles;
}
async function assertNoSecrets(files,needles){
 const hits=[];
 for(const file of files){
  const buf=await readFile(file);
  for(const needle of needles){
   if(buf.includes(Buffer.from(needle,'utf8')))hits.push(path.basename(file));
  }
 }
 if(hits.length)throw new Error(`SECRET_IN_RECORDING files=${[...new Set(hits)].join(',')}`);
}

await mkdir(OUT,{recursive:true});
const ffmpeg=resolveFfmpeg('ffmpeg'),ffprobe=resolveFfmpeg('ffprobe');
if(!ffmpeg||!ffprobe)throw new Error('FFMPEG_NOT_FOUND');
const server=spawn(process.execPath,['--experimental-strip-types','demo/safety-challenge/server.mjs'],{
 cwd:ROOT,windowsHide:true,stdio:['ignore','inherit','inherit'],env:{...process.env,SAFECALL_DEMO_PORT:PORT,
 META_LIVE_ENABLED:'false',META_VOICE_LIVE_ENABLED:'false',SAFECALL_MEDIA_ASR_ENABLED:'false',
 META_SPEND_APPROVED:'false',META_BUDGET_KILL_SWITCH:'true',MODEL_API_KEY:''}});
let browser,context,videoPath=null,videoOffsetMs=null;
const externalHosts=new Set();
try{
 await waitForServer();
 browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1,recordVideo:{dir:OUT,size:{width:1600,height:900}},permissions:[]});
 const t0=performance.now(),page=await context.newPage();
 page.on('request',request=>{
  try{const host=new URL(request.url()).hostname;if(host!=='127.0.0.1'&&host!=='localhost')externalHosts.add(host);}catch{}
 });
 const jsErrors=[];page.on('pageerror',error=>jsErrors.push(error.message));
 await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
 await page.locator('[data-set-lang="en"]').click();
 await page.waitForTimeout(800);
 await page.locator('a.primary[href="/live"]').first().click();
 await page.locator('#answer').waitFor({state:'visible',timeout:10000});
 await page.locator('[data-set-lang="en"]').click();
 await page.waitForFunction(()=>document.querySelector('#media-select')?.value==='training-bank-20-en',null,{timeout:12000});
 await page.evaluate(()=>{
  document.body.style.zoom='.85';
  const bar=document.createElement('div');
  bar.id='recording-mode-banner';
  bar.textContent='RECORDING: OFFLINE SCRIPT REPLAY + RULE ENGINE. Meta API was not called.';
  bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;background:#10243a;color:#d6ecff;font:600 16px/1.4 sans-serif;padding:8px 14px;text-align:center;pointer-events:none';
  document.body.prepend(bar);
 });
 await page.waitForTimeout(700);
 if(await page.locator('#mode-replay').getAttribute('aria-pressed')!=='true')throw new Error('REPLAY_MODE_NOT_SELECTED');
 await page.waitForFunction(()=>/NO META\/STT/.test(document.querySelector('#mode-disclosure')?.textContent??''),null,{timeout:8000});
 const disclosure=await page.locator('#mode-disclosure').textContent();
 await page.locator('#answer').click();
 await page.waitForFunction(()=>document.querySelector('#video')?.currentTime>0.20,null,{timeout:15000});
 const head=await page.locator('#video').evaluate(element=>element.currentTime);
 videoOffsetMs=Math.round(performance.now()-t0-head*1000);
 await page.waitForFunction(()=>document.querySelector('#turn-counter')?.textContent?.trim()==='20/20',null,{timeout:140000});
 await page.waitForTimeout(1200);
 const actualBand=await page.locator('#risk-band').getAttribute('data-band');
 if(actualBand!=='HIGH')throw new Error('RISK_BAND_NOT_HIGH');
 const hudBand=await page.locator('#hud-sev').getAttribute('data-band');
 const status=(await page.locator('#gate-status').textContent())??'';
 const metaStatus=(await page.locator('#meta-status').textContent())??'';
 if(/LIVE_VERIFIED|MODEL_VERIFIED/i.test(metaStatus))throw new Error('META_ANALYSIS_LABEL_PRESENT');
 if(await page.locator('#safety-modal').isVisible())await page.locator('#modal-dismiss').click();
 await page.locator('#transfer').click();
 await page.waitForTimeout(1100);
 const denied=(await page.locator('#bank-result').textContent())??'';
 if(!(await page.locator('#bank-flag').textContent())?.includes('HOLD'))throw new Error('SIMULATED_BANK_HOLD_NOT_ACTIVE');
 const events=await page.locator('#events li').evaluateAll(nodes=>nodes.map(node=>({
  provenance:node.dataset.prov??'',
  type:node.querySelector('.event-type')?.textContent?.trim()??'',
  time:node.querySelector('time')?.textContent?.trim()??'',
  detail:node.querySelector('.event-detail')?.textContent?.trim()??''
 })));
 const provenances=new Set(events.map(event=>event.provenance));
 if(provenances.has('ACTUAL_STREAMED_ASR')||provenances.has('MODEL_VERIFIED'))throw new Error('META_PROVENANCE_IN_RULE_REPLAY');
 if(!provenances.has('RULE_ENGINE')||!provenances.has('SCRIPTED_MOCK'))throw new Error('RULE_REPLAY_EVENTS_MISSING');
 const screenText=await page.locator('body').innerText();
 const needles=await secretNeedles();
 for(const needle of needles)if(screenText.includes(needle))throw new Error('SECRET_ON_SCREEN');
 await page.screenshot({path:path.join(OUT,'20-turn-end.png'),fullPage:true});
 await page.waitForTimeout(1200);
 if(jsErrors.length)throw new Error(`JS_ERRORS:${jsErrors.slice(0,5).join(';')}`);
 if(externalHosts.size)throw new Error(`EXTERNAL_REQUEST:${[...externalHosts].join(',')}`);
 videoPath=path.join(OUT,'SafeCall-v147-BrowserOnly.webm');
 const recorded=page.video();await page.close();await recorded.saveAs(videoPath);
 const eventLog=events.map(event=>[event.time,event.provenance||'-',event.type,event.detail].filter(Boolean).join(' | ')).join('\n')+'\n';
 await writeFile(path.join(OUT,'events.log'),eventLog);
 await writeFile(path.join(OUT,'events.json'),JSON.stringify({mode:'OFFLINE_SCRIPT_REPLAY',metaApiCalled:false,events},null,2));
 const manifest=JSON.parse(await readFile(path.join(ROOT,'demo','safety-challenge','media','training-bank-20-en.manifest.json'),'utf8'));
 const cues=[{start:400,end:Math.max(2400,videoOffsetMs-200),text:'OFFLINE SCRIPT REPLAY + RULE ENGINE. This is not a Meta API analysis.'}];
 for(const turn of manifest.turns)cues.push({start:videoOffsetMs+turn.startMs,end:videoOffsetMs+turn.endMs,text:`${turn.role}: ${turn.text}`});
 const srt=cues.map((cue,index)=>`${index+1}\n${srtStamp(cue.start)} --> ${srtStamp(cue.end)}\n${cue.text}\n`).join('\n');
 const vtt='WEBVTT\n\n'+cues.map(cue=>`${vttStamp(cue.start)} --> ${vttStamp(cue.end)}\n${cue.text}\n`).join('\n');
 await writeFile(path.join(OUT,'subtitles.srt'),srt);
 await writeFile(path.join(OUT,'subtitles.vtt'),vtt);
 await writeFile(path.join(OUT,'recording-metadata.json'),JSON.stringify({
  mode:'OFFLINE_SCRIPT_REPLAY',ruleEngine:true,metaApiCalled:false,actualSTT:false,modelCalled:false,
  distinction:'Rule-based scripted replay. Real Meta API analysis was not run and is not shown.',
  recordingFile:path.basename(videoPath),audioSource:'training-bank-20-en.wav',audioOffsetApproxMs:videoOffsetMs,
  completedTurnCount:20,riskBand:actualBand,hudBand,bankGate:status,virtualBankResult:denied,metaStatus,
  disclosure,scriptSource:'CURATED_SEEDED_FIXTURE',externalRequests:[...externalHosts],
  note:'Browser video is a local UI capture. The voice track is the local TTS WAV mixed by local FFmpeg.'
 },null,2));
}finally{
 await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
 server.kill('SIGTERM');
}
if(!videoPath||videoOffsetMs===null)throw new Error('NO_BROWSER_RECORDING');
const audio=path.join(ROOT,'demo','safety-challenge','media','training-bank-20-en.wav');
const mp4=path.join(OUT,'SafeCall-v147-20Turn-Product-Demo.mp4');
await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',videoPath,'-i',audio,
 '-filter_complex',`[1:a]adelay=${Math.max(0,videoOffsetMs)}:all=1,volume=0.85[a]`,'-map','0:v:0','-map','[a]',
 '-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','-shortest',mp4]);
const probe=await run(ffprobe,['-hide_banner','-loglevel','error','-show_entries','format=duration:stream=codec_type,codec_name','-of','json',mp4],true);
const volume=await run(ffmpeg,['-hide_banner','-i',mp4,'-af','volumedetect','-f','null','-'],true);
const max=volume.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
const mean=volume.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
if(!max||Number(max[1])<=-50)throw new Error('MUXED_AUDIO_SILENT');
const produced=[videoPath,mp4,path.join(OUT,'events.log'),path.join(OUT,'events.json'),path.join(OUT,'subtitles.srt'),path.join(OUT,'subtitles.vtt'),path.join(OUT,'recording-metadata.json'),path.join(OUT,'20-turn-end.png')];
await assertNoSecrets(produced,await secretNeedles());
await writeFile(path.join(OUT,'verification.json'),JSON.stringify({
  verifiedAt:new Date().toISOString(),localOnly:true,uploaded:false,
  mode:'OFFLINE_SCRIPT_REPLAY',metaApiCalled:false,
  audioMaxDb:Number(max[1]),audioMeanDb:mean?Number(mean[1]):null,
  ffprobe:JSON.parse(probe),secretScan:'PASS',externalRequests:[...externalHosts]
},null,2));
console.log('Recorded offline RULES replay:',mp4);
