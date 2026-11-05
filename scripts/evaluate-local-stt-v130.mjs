/** Optional, explicitly invoked evaluation on independently labeled, user-authorized local WAVs.
 * No transcript/sample is printed or written; only aggregate WER/CER. No external APIs.
 * This script refuses to run without an operator-configured LOCAL whisper.cpp binary/model.
 */
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {digestAudio} from '../src/modules/audio/stt-port.ts';
import {LocalWhisperCliAdapter} from '../src/modules/audio/local-whisper-stt.ts';
import {evaluateTranscripts} from '../src/modules/audio/stt-evaluation.ts';
const manifestPath=process.argv[2];
if(!manifestPath){console.error('Usage: SAFECALL_LOCAL_STT_ENABLED=1 SAFECALL_WHISPER_CLI=<absolute-path> SAFECALL_WHISPER_MODEL=<absolute-path> npm run eval:stt:v130 -- /absolute/path/to/private-manifest.json');process.exit(2);}
const root=path.dirname(path.resolve(manifestPath));
let status='NOT_VERIFIED';
try{
 if(process.env.SAFECALL_LOCAL_STT_ENABLED!=='1')throw Error('operator opt-in missing');
 const cli=process.env.SAFECALL_WHISPER_CLI,model=process.env.SAFECALL_WHISPER_MODEL;
 if(!cli||!model)throw Error('local CLI/model paths missing');
 const adapter=new LocalWhisperCliAdapter({executablePath:cli,modelPath:model,timeoutMs:30_000});
 if(!await adapter.isReady())throw Error('local CLI/model not ready');
 const dataset=JSON.parse(await readFile(manifestPath,'utf8'));
 if(!Array.isArray(dataset)||dataset.length<1||dataset.length>100)throw Error('expected 1..100 local evaluation samples');
 const pairs=[];
 for(const row of dataset){
  if(!row||!/^[-_a-zA-Z0-9]{1,80}$/.test(row.id)||!['ko-KR','en-US'].includes(row.language)||
     row.consentGranted!==true||row.rightsConfirmed!==true||row.independentlyLabeled!==true||
     typeof row.relativeWav!=='string'||!/^[-_/a-zA-Z0-9.]{1,200}\.wav$/i.test(row.relativeWav)||
     typeof row.reference!=='string'||!row.reference.trim()||row.reference.length>800)throw Error('invalid consent / label / WAV entry');
  const candidate=path.resolve(root,row.relativeWav),actual=await realpath(candidate);
  if(!actual.startsWith(await realpath(root)+path.sep))throw Error('sample outside dataset directory');
  const bytes=await readFile(actual);
  const digest=digestAudio(bytes);const now=Date.now();
  const input={caseId:'local_eval_'+row.id,sourceType:'CONSENTED_TEST_AUDIO',provenance:'USER_AUTHORIZED_TEST',
   consentReceipt:{granted:true,purpose:'LOCAL_DEMO_ANALYSIS',externalTransfer:false,issuedAtMs:now,expiresAtMs:now+60_000},
   audioBytes:bytes,inputDigest:digest,codec:'WAV_PCM16_MONO_16000',durationMs:(bytes.length-44)/32,
   sizeBytes:bytes.length,languageHint:row.language,retentionPolicy:'DISCARD_IMMEDIATELY'};
  let hypothesis;
  try{hypothesis=(await adapter.recognize(input)).text;}finally{bytes.fill(0);}
  pairs.push({id:row.id,language:row.language,reference:row.reference,hypothesis,independentlyLabeled:true});
 }
 const r=evaluateTranscripts(pairs);
 status='MEASURED_LOCAL_MODEL';
 console.log(JSON.stringify({status,localStt:true,externalCalls:0,independentLabels:true,...r}));
}catch(error){console.error(JSON.stringify({status:'NOT_VERIFIED',reason:error?.code||'INPUT_OR_MODEL_NOT_READY'}));process.exitCode=1;}
