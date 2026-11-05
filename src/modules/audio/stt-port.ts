/** v1.29 STT port: strict, server-side-only audio boundary.
 * NO model, microphone, OS call capture, external transmission or real speech recognition.
 * The digest-mapped fixture adapter exists ONLY for deterministic QA.
 */
import {createHash} from 'node:crypto';

export type AudioOrigin='SYNTHETIC_DEMO_AUDIO'|'CONSENTED_TEST_AUDIO';
export type AudioCodec='WAV_PCM16_MONO_16000';
export type SttEventKind='PARTIAL'|'FINAL'|'CORRECTION'|'RETRACTION';
export type SpeakerLabel='caller'|'user'|'unknown';
export type SttQuality='OK'|'UNCERTAIN'|'LOW_QUALITY';
export interface ConsentReceipt {
  granted:true;
  purpose:'LOCAL_DEMO_ANALYSIS';
  externalTransfer:false;
  issuedAtMs:number;
  expiresAtMs:number;
}
export interface AudioInput {
  caseId:string;
  sourceType:AudioOrigin;
  consentReceipt:ConsentReceipt;
  audioBytes:Uint8Array;
  inputDigest:string;
  codec:AudioCodec;
  durationMs:number;
  sizeBytes:number;
  languageHint:'ko-KR'|'en-US';
  provenance:'GENERATED_TEST_FIXTURE'|'USER_AUTHORIZED_TEST';
  retentionPolicy:'DISCARD_IMMEDIATELY';
  abortSignal?:AbortSignal;
}
export interface SttSegment {
  kind:SttEventKind;
  turnId:string;
  revision:number;
  speaker:SpeakerLabel;
  quality:SttQuality;
  text?:string;
}
export interface SttResult {
  mode:'DIGEST_MAPPED_FIXTURE'|'LIVE_STT';
  actualStt:boolean;
  externalCalls:number;
  inputDigest:string;
  segments:readonly SttSegment[];
}
export interface SpeechRecognitionAdapter {
  readonly mode:SttResult['mode'];
  recognize(input:AudioInput):Promise<SttResult>;
}
export class AudioBoundaryError extends Error {
  readonly code:'CONSENT_REQUIRED'|'EXPIRED_CONSENT'|'INVALID_AUDIO'|'DIGEST_MISMATCH'|'AUDIO_TOO_LARGE'|'UNRECOGNIZED_FIXTURE'|'ABORTED';
  constructor(code:'CONSENT_REQUIRED'|'EXPIRED_CONSENT'|'INVALID_AUDIO'|'DIGEST_MISMATCH'|'AUDIO_TOO_LARGE'|'UNRECOGNIZED_FIXTURE'|'ABORTED', message:string){super(message);this.code=code;this.name='AudioBoundaryError';}
}
const fail=(code:AudioBoundaryError['code'],message:string):never=>{throw new AudioBoundaryError(code,message);};
const CASE_ID=/^[a-zA-Z0-9_-]{1,64}$/;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
const MAX_AUDIO_BYTES=320044; // 10s at 16 kHz mono PCM16 + header
export function digestAudio(bytes:Uint8Array):string{return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}
/** Validate before any adapter call; no copies, persistence or logging of raw audio. */
export function validateAudioInput(input:AudioInput,now=Date.now()):Readonly<{digest:string;durationMs:number}> {
  if(!input||typeof input!=='object')return fail('INVALID_AUDIO','음성 입력 객체 오류');
  if(input.abortSignal?.aborted)return fail('ABORTED','음성 처리가 취소됐습니다.');
  const c=input.consentReceipt;
  if(!c||c.granted!==true||c.purpose!=='LOCAL_DEMO_ANALYSIS'||c.externalTransfer!==false)return fail('CONSENT_REQUIRED','외부 전송 없는 로컬 음성 테스트 동의가 필요합니다.');
  if(!Number.isSafeInteger(c.issuedAtMs)||!Number.isSafeInteger(c.expiresAtMs)||c.issuedAtMs>now||c.expiresAtMs<=now||c.expiresAtMs-c.issuedAtMs>5*60_000)return fail('EXPIRED_CONSENT','음성 테스트 동의가 만료되었거나 유효하지 않습니다.');
  if(typeof input.caseId!=='string'||!CASE_ID.test(input.caseId)||
    !['SYNTHETIC_DEMO_AUDIO','CONSENTED_TEST_AUDIO'].includes(input.sourceType)||
    !['ko-KR','en-US'].includes(input.languageHint)||
    input.codec!=='WAV_PCM16_MONO_16000'||input.retentionPolicy!=='DISCARD_IMMEDIATELY'||
    !['GENERATED_TEST_FIXTURE','USER_AUTHORIZED_TEST'].includes(input.provenance)||
    (input.sourceType==='SYNTHETIC_DEMO_AUDIO'&&input.provenance!=='GENERATED_TEST_FIXTURE')||
    (input.sourceType==='CONSENTED_TEST_AUDIO'&&input.provenance!=='USER_AUTHORIZED_TEST'))return fail('INVALID_AUDIO','음성 출처·보존·형식 계약 오류');
  const bytes=input.audioBytes;
  if(!(bytes instanceof Uint8Array))return fail('INVALID_AUDIO','음성 바이트가 필요합니다.');
  if(bytes.byteLength>MAX_AUDIO_BYTES)return fail('AUDIO_TOO_LARGE','로컬 음성 테스트의 최대 길이는 10초입니다.');
  if(bytes.byteLength<46||bytes.byteLength!==input.sizeBytes)return fail('INVALID_AUDIO','오디오 크기가 잘못되었습니다.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const tag=(at:number)=>String.fromCharCode(...bytes.subarray(at,at+4));
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||tag(12)!=='fmt '||tag(36)!=='data'||
      view.getUint32(4,true)!==bytes.length-8||view.getUint32(16,true)!==16||
      view.getUint16(20,true)!==1||view.getUint16(22,true)!==1||
      view.getUint32(24,true)!==16000||view.getUint32(28,true)!==32000||
      view.getUint16(32,true)!==2||view.getUint16(34,true)!==16||
      view.getUint32(40,true)!==bytes.length-44||((bytes.length-44)%2)!==0)
    return fail('INVALID_AUDIO','지원하지 않는 WAV PCM16 모노 16kHz 형식입니다.');
  const actualMs=(bytes.length-44)/32;
  if(!Number.isSafeInteger(input.durationMs)||input.durationMs<0||Math.abs(input.durationMs-actualMs)>1)return fail('INVALID_AUDIO','길이 메타데이터가 파일과 다릅니다.');
  if(typeof input.inputDigest!=='string'||!DIGEST.test(input.inputDigest)||digestAudio(bytes)!==input.inputDigest)return fail('DIGEST_MISMATCH','입력 음성 해시가 일치하지 않습니다.');
  return {digest:input.inputDigest,durationMs:actualMs};
}

/** Known audio SHA → pre-authored text association. Not ASR; only a QA fixture. */
export class DigestMappedFixtureAdapter implements SpeechRecognitionAdapter {
  readonly mode='DIGEST_MAPPED_FIXTURE' as const;
  private readonly references:ReadonlyMap<string,readonly SttSegment[]>;
  constructor(references:ReadonlyMap<string,readonly SttSegment[]>){this.references=references;}
  async recognize(input:AudioInput):Promise<SttResult>{
    validateAudioInput(input);
    if(input.abortSignal?.aborted)return fail('ABORTED','음성 처리가 취소됐습니다.');
    if(input.sourceType!=='SYNTHETIC_DEMO_AUDIO')return fail('UNRECOGNIZED_FIXTURE','실제 오디오는 모의 매칭으로 전사할 수 없습니다.');
    const segments=this.references.get(input.inputDigest);
    if(!segments)return fail('UNRECOGNIZED_FIXTURE','등록되지 않은 테스트 음성입니다.');
    // A provider must not be able to smuggle commands/URLs. Match only known validated fixture labels.
    const valid=segments.length>0&&segments.length<=8&&segments.every(s=>
      ['PARTIAL','FINAL','CORRECTION','RETRACTION'].includes(s.kind)&&
      /^voice_[a-zA-Z0-9_-]{1,48}$/.test(s.turnId)&&Number.isSafeInteger(s.revision)&&s.revision>=0&&
      ['caller','user','unknown'].includes(s.speaker)&&['OK','UNCERTAIN','LOW_QUALITY'].includes(s.quality)&&
      (s.kind==='RETRACTION'?s.text===undefined:typeof s.text==='string'&&s.text.length>0&&s.text.length<=800));
    if(!valid)return fail('INVALID_AUDIO','등록된 테스트 전사 형식이 잘못되었습니다.');
    if(input.abortSignal?.aborted)return fail('ABORTED','음성 처리가 취소됐습니다.');
    return {mode:this.mode,actualStt:false,externalCalls:0,inputDigest:input.inputDigest,
      segments:segments.map(s=>({...s}))};
  }
}
/** Synthetic 16kHz mono WAV containing a tone — DOES NOT CONTAIN SPEECH. */
export function makeSyntheticTone(hz:number,ms=100):Uint8Array {
  if(!Number.isSafeInteger(hz)||hz<100||hz>2000||!Number.isSafeInteger(ms)||ms<1||ms>1000)throw new Error('invalid synthetic tone');
  const count=ms*16, bytes=new Uint8Array(44+count*2),v=new DataView(bytes.buffer);
  const write=(at:number,s:string)=>{for(let i=0;i<s.length;i++)bytes[at+i]=s.charCodeAt(i);};
  write(0,'RIFF');v.setUint32(4,bytes.length-8,true);write(8,'WAVE');write(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);
  v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
  write(36,'data');v.setUint32(40,count*2,true);
  for(let i=0;i<count;i++)v.setInt16(44+i*2,Math.round(Math.sin(2*Math.PI*hz*i/16000)*2000),true);
  return bytes;
}
