/**
 * SAFETYED v1.46: generate two FICTIONAL TTS calls as audio-only WAV (no MP4 or third-party recording).
 * Uses OS speech synthesis, never sends script or audio to an external service.
 * Linux: espeak (offline), macOS: say, Windows: System.Speech via PowerShell.
 * Requires FFmpeg for normalization to PCM16 24 kHz mono.
 * The manifest's known script/timings are for offline ASR evaluation only, NOT model input.
 * Run: node scripts/generate-tts-audio.mjs [--only=synthetic-prosecutor-en|synthetic-delivery-en]
 */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'demo','safety-challenge','media');
const RATE=24000,LEAD=650,TAIL=1200;
const SCENARIOS=[
  {id:'synthetic-prosecutor-en',title:'Prosecutor impersonation · synthetic TTS',script:[
    ['narrator','Synthetic security training call. This conversation is fictional.'],
    ['receiver','Hello? Who is this?'],
    ['caller','I am calling from the federal investigation office. We are reviewing a financial crime linked to your bank account.'],
    ['receiver','A financial crime? I do not understand.'],
    ['caller','Do not tell anyone, not even your family or your bank. The investigation is confidential.'],
    ['receiver','What should I do?'],
    ['caller','You must transfer the money to the secure holding account immediately. You need to go to your bank right now.'],
    ['receiver','I am on my way to the bank.'],
    ['caller','Do not hang up. If the bank staff ask, tell them it is for personal expenses.'],
    ['receiver','I am standing outside the bank now.'],
    ['caller','Send the money now. You have to act immediately.'],
  ],gaps:[850,900,1000,950,980,1100,1000,850,980,800]},
  {id:'synthetic-delivery-en',title:'Registered mail impersonation · synthetic TTS',script:[
    ['narrator','Synthetic security training call. This conversation is fictional.'],
    ['receiver','Hello?'],
    ['caller','This is the registered mail delivery desk. A court letter addressed to you could not be delivered.'],
    ['receiver','I did not expect any letter from a court.'],
    ['caller','To confirm your identity, open the link we sent and enter your ID number and your verification code.'],
    ['receiver','The page is asking me to install a security application.'],
    ['caller','Please install the support app now. I will connect you with our investigator.'],
    ['investigator','I am calling from the bank investigation team. Your account may be compromised. Do not tell your family.'],
    ['receiver','What should I do with my savings?'],
    ['investigator','You must transfer the money to a protected account immediately. Go to your bank now.'],
    ['receiver','I am standing outside the bank now.'],
    ['investigator','Keep the call open. Do not tell the teller about this investigation.'],
  ],gaps:[800,850,850,1000,1050,900,980,950,900,900,800]},
];


// v1.47: bounded, seed-reproducible training cases. Exactly 20 audible dialogue turns per recording.
// Variants are curated, NOT attributed to a live generative model.
const TRAINING_CASES=[
 {id:'training-bank-20-en',title:'20-turn financial impersonation (seed 1042)',seed:1042,
 script:[
 ['caller','Hello, this is the fraud investigation desk. May I speak with the account holder?'],
 ['receiver','Hello. Yes, I am the account holder. What happened?'],
 ['caller','We noticed a suspicious transaction associated with your account earlier today.'],
 ['receiver','That sounds concerning. I did not authorize a new transaction.'],
 ['caller','I am an investigator assigned to the case. This is a confidential review.'],
 ['receiver','Can I call my bank using the number on my card to confirm?'],
 ['caller','No. Do not tell your family or anyone at the bank. Keep this call confidential.'],
 ['receiver','I need to know how to protect my money.'],
 ['caller','The investigation office has instructed you to transfer your savings to a secure holding account.'],
 ['receiver','Are you asking me to transfer all of my money to another account?'],
 ['caller','Yes, immediately. The deadline is today and there is no time to verify separately.'],
 ['receiver','I am not comfortable doing that without confirmation.'],
 ['caller','Go to your bank right now. Stay on the line while you travel.'],
 ['receiver','I am walking toward the bank and I can see the entrance.'],
 ['caller','Do not discuss this investigation with the teller. Say it is a personal transfer.'],
 ['receiver','I am near the bank. What if I speak with a bank employee?'],
 ['caller','You must follow my instructions or your account could be frozen.'],
 ['receiver','I am at the bank entrance and I have opened my banking application.'],
 ['caller','Send the money now. Make the transfer to the safe account immediately.'],
 ['receiver','I will stop and independently verify through my bank official phone number.'],
 ]},
 {id:'training-delivery-20-en',title:'20-turn delivery-to-bank impersonation (seed 2084)',seed:2084,
 script:[
 ['caller','Hello, I am calling about a registered delivery that could not be completed.'],
 ['receiver','I am expecting a package. Which delivery company is this?'],
 ['caller','The package contains a legal notice and requires identity confirmation today.'],
 ['receiver','I did not know I had any legal notice coming.'],
 ['caller','A verification link was sent to your phone to prevent a delivery penalty.'],
 ['receiver','The link asks for personal information. Is that necessary?'],
 ['caller','You must enter your identity number and verification code immediately.'],
 ['receiver','I would rather check through the official delivery website.'],
 ['caller','Do not use other channels. An investigator will continue the process on this call.'],
 ['receiver','I am worried this may not be legitimate.'],
 ['caller','Your bank account could be involved in a fraud investigation. Do not tell your family.'],
 ['receiver','What exactly are you asking me to do?'],
 ['caller','Transfer your savings to a protected account. It is the only way to keep them safe.'],
 ['receiver','You want me to send money? That sounds unusual.'],
 ['caller','The deadline is in minutes. Go to your bank while we stay on this call.'],
 ['receiver','I am walking to the bank now, but I still have doubts.'],
 ['caller','Do not explain the investigation to bank employees. They are not authorized.'],
 ['receiver','I am near the bank and I can see the cash machines.'],
 ['caller','Make the transfer immediately and keep the transaction secret.'],
 ['receiver','I will stop the transfer and contact the official bank fraud team instead.'],
 ]},
];
for(const s of TRAINING_CASES){if(s.script.length!==20)throw new Error('training case must be exactly 20 turns');
 SCENARIOS.push({...s,gaps:Array.from({length:20},(_,i)=>i===19?900:550)});
}

function run(bin,args,opts={}) {return new Promise((resolve,reject)=>{
 const p=spawn(bin,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...opts});let err='';const output=[];
 p.stdout?.on('data',c=>output.push(c));p.stderr?.on('data',c=>{err+=c.toString();});
 p.once('error',reject);p.once('close',c=>c===0?resolve(Buffer.concat(output)):reject(new Error(`${bin} exit ${c}: ${err.slice(0,400)}`)));
});}
function parseWav(buf){
 if(buf.toString('ascii',0,4)!=='RIFF'||buf.toString('ascii',8,12)!=='WAVE')throw new Error('Invalid WAV header');
 let pos=12,fmt;
 while(pos+8<=buf.length){const code=buf.toString('ascii',pos,pos+4),len=buf.readUInt32LE(pos+4),start=pos+8;
  if(code==='fmt ')fmt={format:buf.readUInt16LE(start),channels:buf.readUInt16LE(start+2),sampleRate:buf.readUInt32LE(start+4),bits:buf.readUInt16LE(start+14)};
  if(code==='data'){if(fmt?.format!==1||fmt.channels!==1||fmt.sampleRate!==RATE||fmt.bits!==16)throw new Error('Expected PCM16 mono 24k WAV');return buf.subarray(start,start+len);}
  pos=start+len+(len&1);
 }
 throw new Error('WAV data chunk missing');
}
function encodeWav(pcm){const h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(RATE,24);h.writeUInt32LE(RATE*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
const silence=ms=>Buffer.alloc(Math.round(ms*RATE/1000)*2);
const durationMs=bytes=>Math.round(bytes/RATE/2*1000);
function osVoice(role){return role==='receiver'?'en-us+f3':role==='investigator'?'en-us+m3':role==='narrator'?'en-us+f2':'en-us+m2';}
async function synthLine(text,role,out){
 const file=out+'.source';
 if(process.platform==='win32'){
  const escape=text.replaceAll("'","''");
  const command=`Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=${role==='receiver'?1:-1}; $s.SetOutputToWaveFile('${file.replaceAll("'","''")}'); $s.Speak('${escape}'); $s.Dispose()`;
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command]);
 } else if(process.platform==='darwin'){
  await run('say',['-v',role==='receiver'?'Samantha':'Alex','-o',file,text]);
 } else {
  await run('espeak',['-v',osVoice(role),'-s',role==='receiver'?'158':'146','-p',role==='receiver'?'63':'43','-w',file+'.wav',text]);
 }
 const source=process.platform==='linux'?file+'.wav':file;
 const pcm=await run(process.env.SAFECALL_FFMPEG_PATH||'ffmpeg',['-nostdin','-v','error','-i',source,'-ar',String(RATE),'-ac','1','-c:a','pcm_s16le','-f','s16le','pipe:1']);
 if(pcm.length<1000)throw new Error('No generated audio');
 return pcm;
}
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
if(only&&!SCENARIOS.some(s=>s.id===only))throw new Error('Unknown --only scenario');
await mkdir(OUT,{recursive:true});
for(const scenario of SCENARIOS.filter(s=>!only||s.id===only)){
 const dir=await mkdtemp(path.join(os.tmpdir(),'safecall-tts-'));
 try{
  const parts=[silence(LEAD)],turns=[];let cursor=LEAD;
  for(let i=0;i<scenario.script.length;i++){
   const [role,line]=scenario.script[i],pcm=await synthLine(line,role,path.join(dir,`turn-${i}`)),end=cursor+durationMs(pcm.length);
   turns.push({index:i,role,startMs:cursor,endMs:end,text:line});
   parts.push(pcm);cursor=end;
   const gap=scenario.gaps[i]??TAIL;parts.push(silence(gap));cursor+=gap;
  }
  const pcm=Buffer.concat(parts),wav=encodeWav(pcm),file=path.join(OUT,`${scenario.id}.wav`);
  await writeFile(file,wav);
  const arrival=(turns.find(t=>/outside the bank|near the bank|bank entrance/i.test(t.text))??turns.at(-3)).startMs;
  const first=Math.round(arrival*0.22);
  const gpsScheduleMs=Array.from({length:9},(_,i)=>Math.round(first+(arrival-first)*i/8));
  const manifest={id:scenario.id,scenarioSeed:scenario.seed??null,turnLimit:scenario.seed?20:scenario.script.length,scenarioSource:scenario.seed?'CURATED_SEEDED_FIXTURE':'CURATED_FIXTURE',kind:'SYNTHETIC_TTS',language:'en-US',durationSeconds:durationMs(pcm.length)/1000,
   sha256:createHash('sha256').update(wav).digest('hex'),createdAt:new Date().toISOString(),generator:'scripts/generate-tts-audio.mjs',
   voice:process.platform==='linux'?'eSpeak offline en-US':process.platform==='darwin'?'Apple system voices':'Windows System.Speech',
   rights:'Fictional original script, generated locally using operating-system TTS. Verify voice engine redistribution terms if distributing.',
   gpsScheduleMs,groundTruthNote:'Turn text and times are evaluation fixtures only; server never reads them for risk inference.',turns};
  await writeFile(path.join(OUT,`${scenario.id}.manifest.json`),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Created ${scenario.id}.wav (${manifest.durationSeconds}s, ${turns.length} lines)`);
 }finally{await rm(dir,{recursive:true,force:true});}
}
