/** Optional OFFLINE whisper.cpp adapter. It is DISABLED unless the host supplies
 * an executable and a model path. No browser audio capture, network, Meta or bank actions.
 * Temporary audio and text files are deleted in finally. Never log raw bytes/text.
 * The one-speaker CLI transcript is UNATTRIBUTED and cannot be case evidence by itself.
 */
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateAudioInput,AudioBoundaryError,type AudioInput} from './stt-port.ts';

export type LocalSttCandidate=Readonly<{
 mode:'LOCAL_WHISPER_CPP';actualStt:true;externalCalls:0;inputDigest:string;
 text:string;language:'ko'|'en';speaker:'unknown';quality:'UNCERTAIN';
 requiresUserReview:true;persisted:false;verifiedIdentity:false;
}>;
export type LocalSttConfig=Readonly<{
 executablePath:string;modelPath:string;timeoutMs?:number;temporaryRoot?:string;
}>;
export class LocalSttError extends Error{
 readonly code:'STT_NOT_CONFIGURED'|'STT_TIMEOUT'|'STT_CANCELLED'|'STT_FAILED'|'STT_OUTPUT_INVALID';
 constructor(code:LocalSttError['code'],message:string){super(message);this.code=code;this.name='LocalSttError';}
}
const fail=(code:LocalSttError['code'],message:string):never=>{throw new LocalSttError(code,message);};
const MAX_OUTPUT_CHARS=800;
const isLocalFile=async(p:string)=>{if(!path.isAbsolute(p))return false;try{const full=await realpath(p);const s=await stat(full);return s.isFile();}catch{return false;}};
/** This class is constructed only from trusted server configuration, never a user request. */
export class LocalWhisperCliAdapter {
 readonly mode='LOCAL_WHISPER_CPP' as const;
 private readonly config:LocalSttConfig;
 constructor(config:LocalSttConfig){this.config=config;}
 async isReady():Promise<boolean>{return !!this.config.executablePath&&!!this.config.modelPath&&
   await isLocalFile(this.config.executablePath)&&await isLocalFile(this.config.modelPath);}
 async recognize(input:AudioInput):Promise<LocalSttCandidate>{
   validateAudioInput(input);
   if(input.sourceType!=='CONSENTED_TEST_AUDIO'||input.provenance!=='USER_AUTHORIZED_TEST')
     throw new AudioBoundaryError('INVALID_AUDIO','실제 로컬 STT는 동의받은 테스트 음성만 처리합니다.');
   if(!await this.isReady())return fail('STT_NOT_CONFIGURED','로컬 STT 실행 파일과 모델이 준비되지 않았습니다.');
   const timeoutMs=this.config.timeoutMs??20_000;
   if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>60_000)
     return fail('STT_NOT_CONFIGURED','허용되지 않은 로컬 STT 제한시간입니다.');
   const dir=await mkdtemp(path.join(this.config.temporaryRoot??tmpdir(),'safecall-stt-'));
   const wav=path.join(dir,'input.wav'),outbase=path.join(dir,'result');
   try{
     await writeFile(wav,input.audioBytes,{mode:0o600,flag:'wx'});
     if(input.abortSignal?.aborted)return fail('STT_CANCELLED','로컬 STT가 취소됐습니다.');
     await new Promise<void>((resolve,reject)=>{
       const args=['-m',this.config.modelPath,'-f',wav,'-l',input.languageHint==='ko-KR'?'ko':'en',
         '-nt','-otxt','-of',outbase];
       const child=spawn(this.config.executablePath,args,{shell:false,stdio:['ignore','ignore','ignore'],windowsHide:true,
         env:{PATH:process.env.PATH??'',HOME:process.env.HOME??''} as unknown as NodeJS.ProcessEnv});
       let settled=false;
       const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);
         input.abortSignal?.removeEventListener('abort',onAbort);
         if(error)reject(error);else resolve();};
       const kill=(code:'STT_TIMEOUT'|'STT_CANCELLED')=>{child.kill('SIGKILL');finish(new LocalSttError(code,code==='STT_TIMEOUT'?'로컬 STT 시간이 초과되었습니다.':'로컬 STT가 취소됐습니다.'));};
       const onAbort=()=>kill('STT_CANCELLED');
       const timer=setTimeout(()=>kill('STT_TIMEOUT'),timeoutMs);
       input.abortSignal?.addEventListener('abort',onAbort,{once:true});
       child.on('error',()=>finish(new LocalSttError('STT_FAILED','STT 프로세스를 시작하지 못했습니다.')));
       child.on('close',(code,signal)=>{
         if(code!==0||signal)return finish(new LocalSttError('STT_FAILED','로컬 STT 실행 실패'));
         finish();
       });
     });
     let content:string;
     try{content=await readFile(outbase+'.txt',{encoding:'utf8'});}catch{return fail('STT_OUTPUT_INVALID','로컬 STT 출력 파일을 읽을 수 없습니다.');}
     const cleaned=content.replace(/\r/g,'').trim();
     if(!cleaned||cleaned.length>MAX_OUTPUT_CHARS||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(cleaned))
       return fail('STT_OUTPUT_INVALID','로컬 STT 출력은 비어 있거나 허용 길이를 넘었습니다.');
     if(input.abortSignal?.aborted)return fail('STT_CANCELLED','로컬 STT가 취소됐습니다.');
     return {mode:this.mode,actualStt:true,externalCalls:0,inputDigest:input.inputDigest,text:cleaned,
       language:input.languageHint==='ko-KR'?'ko':'en',speaker:'unknown',quality:'UNCERTAIN',
       requiresUserReview:true,persisted:false,verifiedIdentity:false};
   }finally{await rm(dir,{recursive:true,force:true});}
 }
}
