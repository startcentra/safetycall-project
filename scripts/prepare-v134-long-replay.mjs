/** Consent-gated, local-only conversion of an operator-supplied MP4 to ONE 120s-or-shorter
 * PCM16 mono 16kHz WAV for the v1.34 browser player. No network/YouTube download/STT.
 * Never store output in the repository; output contains human speech.
 */
import {spawn} from 'node:child_process';
import {realpath,stat,access,readFile,mkdtemp,rm,open,unlink} from 'node:fs/promises';
import {resolve,dirname,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {inspectReplayWav} from '../demo/safety-challenge/public/replay-wav.js';

const [inArg,outArg,consent]=process.argv.slice(2);
if(!inArg||!outArg||consent!=='--rights-confirmed'){
 console.error('Usage: node scripts/prepare-v134-long-replay.mjs <authorized-local.mp4> <private-output.wav> --rights-confirmed');
 process.exit(2);
}
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const from=resolve(inArg),to=resolve(outArg);
const inRepo=to===repo||to.startsWith(repo+sep);
if(!['.mp4','.m4v','.mov'].includes(extname(from).toLowerCase())||extname(to).toLowerCase()!=='.wav'||
 inRepo||from===to||/^https?:\/\//i.test(inArg))throw new Error('INVALID_LOCAL_MEDIA_PATH');
const file=await stat(from);if(!file.isFile()||file.size<100||file.size>150_000_000)throw new Error('INVALID_MEDIA_SIZE');
await realpath(dirname(to));
try{await access(to);throw new Error('OUTPUT_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
const scratch=await mkdtemp(join(tmpdir(),'safecall-v134-media-'));
const scratchWav=join(scratch,'converted.wav');
try{
 await new Promise((ok,fail)=>{
  const child=spawn('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-n','-i',from,
   '-t','120','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',scratchWav],{shell:false,stdio:'ignore',windowsHide:true});
  let settled=false;
  const finish=e=>{if(settled)return;settled=true;clearTimeout(timer);e?fail(e):ok();};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('TRANSCODE_TIMEOUT'));},120000);
  child.on('error',()=>finish(new Error('FFMPEG_NOT_INSTALLED')));
  child.on('close',code=>finish(code===0?null:new Error('TRANSCODE_FAILED')));
 });
 const result=await stat(scratchWav);if(result.size>4_000_000)throw new Error('AUDIO_LIMIT_EXCEEDED');
 const bytes=await readFile(scratchWav);
 const info=inspectReplayWav(new Uint8Array(bytes),{maxSegments:24});
 // The destination is exclusively created, never replaced; private speech stays mode 0600.
 const out=await open(to,'wx',0o600);
 try{await out.writeFile(bytes);}catch(e){await out.close();await unlink(to);throw e;}
 await out.close();
 console.log(JSON.stringify({status:'LOCAL_REPLAY_READY_NOT_STT',durationMs:info.durationMs,segments:info.totalSegments,
  sampleRateHz:16000,channels:1,actualStt:false,modelCalled:false,source:'USER_AUTHORIZED_LOCAL_FILE'}));
}catch(e){console.error(e.message);process.exitCode=1;}finally{await rm(scratch,{recursive:true,force:true});}
