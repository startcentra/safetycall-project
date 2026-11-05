/** Explicitly opt-in, local-only MP4 -> 5s WAV segments for authorized test media.
 * Does not download YouTube, upload audio, call Meta, or invoke any financial action.
 * Run outside repository: node scripts/prepare-v131-audio.mjs <mp4> <output-dir> --rights-confirmed
 * Output may contain personal speech; treat as sensitive, do not commit.
 */
import {spawn} from 'node:child_process';
import {mkdir,rm,readFile,stat,writeFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
const [inputArg,outArg,flag]=process.argv.slice(2);
if(!inputArg||!outArg||flag!=='--rights-confirmed'){
 console.error('Usage: node scripts/prepare-v131-audio.mjs <local-authorized.mp4> <private-output-dir> --rights-confirmed');process.exit(2);
}
const input=resolve(inputArg), output=resolve(outArg);
if(input===output||output.startsWith(input+'/')||!input.toLowerCase().endsWith('.mp4'))throw Error('INVALID_PATH');
const file=await stat(input);if(!file.isFile()||file.size>150_000_000)throw Error('INVALID_INPUT_SIZE');
let created=false;
async function run(command,args){return await new Promise((ok,fail)=>{
 const child=spawn(command,args,{shell:false,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');fail(Error('TIMEOUT'));},100_000);
 for(const [stream,set] of [[child.stdout,'out'],[child.stderr,'err']])stream.on('data',b=>{
  if(set==='out')stdout=(stdout+b).slice(0,1_000_000);else stderr=(stderr+b).slice(-8000);
 });
 child.on('error',e=>{clearTimeout(timer);fail(Error('TOOL_UNAVAILABLE'));});
 child.on('close',c=>{clearTimeout(timer);if(c===0)ok(stdout);else fail(Error(`TRANSCODE_FAILED: ${c}`));});
});}
try{
 await mkdir(output,{recursive:false,mode:0o700});created=true;
 const duration=Number((await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',input])).trim());
 if(!Number.isFinite(duration)||duration<=0||duration>3600)throw Error('INVALID_DURATION');
 const items=[];
 for(let start=0;start<duration;start+=5){
  const index=items.length,seconds=Math.min(5,duration-start),name=`part-${String(index).padStart(4,'0')}.wav`,dest=join(output,name);
  await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-ss',String(start),'-i',input,'-t',String(seconds),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',dest]);
  const data=await readFile(dest);
  const digest=createHash('sha256').update(data).digest('hex');
  items.push({segmentId:index,startMs:Math.round(start*1000),endMs:Math.round(Math.min(duration,start+5)*1000),relativeWav:name,sizeBytes:data.length,sha256:digest});
 }
 await writeFile(join(output,'local-audio-segments.json'),JSON.stringify({schemaVersion:1,actualStt:false,rightsConfirmedByOperator:true,inputFile:basename(input),segmentDurationSeconds:5,sampleRateHz:16000,channels:1,format:'PCM16_WAV',segments:items},null,2),{mode:0o600});
 console.log(JSON.stringify({status:'LOCAL_AUDIO_SEGMENTS_READY_NOT_STT',segments:items.length,durationMs:Math.round(duration*1000),output}));
}catch(e){if(created)await rm(output,{recursive:true,force:true});console.error(JSON.stringify({status:'BLOCKED',reason:e.message}));process.exitCode=1;}
