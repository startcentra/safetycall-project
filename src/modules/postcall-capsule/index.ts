/** Explicit, user-carried encrypted MOCK post-call self-report capsule.
 * No server persistence, no SMS bodies, transcript, contact, token or banking state.
 * This does NOT restore a live case after restart: a new case must be created.
 */
import {randomBytes,pbkdf2Sync,createCipheriv,createDecipheriv} from 'node:crypto';
import {EXPOSURE_QUESTIONS,derivePostCallPlan,type ExposureAnswer,type ExposureKey,type FollowupTaskId} from '../message-safety/index.ts';

const MAX_CAPSULE=4096;
const TTL_MS=7*24*3600_000;
const VALID_STATES=new Set(['TODO','DONE','NOT_APPLICABLE']);
const validPassphrase=(p:unknown):p is string=>typeof p==='string'&&p.length>=12&&p.length<=128;
export type SafeRecoveryRecord={answers:Partial<Record<ExposureKey,ExposureAnswer>>;taskStates:Partial<Record<FollowupTaskId,string>>};
function validateRecord(data:unknown):SafeRecoveryRecord{
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_RECORD');
 const r=data as Record<string,unknown>;
 if(Object.keys(r).some(k=>!['answers','taskStates'].includes(k))||!r.answers||!r.taskStates||
 typeof r.answers!=='object'||Array.isArray(r.answers)||typeof r.taskStates!=='object'||Array.isArray(r.taskStates))throw Error('INVALID_RECORD');
 const answers=r.answers as Record<string,unknown>,tasks=r.taskStates as Record<string,unknown>;
 if(Object.keys(answers).some(k=>!Object.hasOwn(EXPOSURE_QUESTIONS,k)||!['YES','NO','UNSURE'].includes(String(answers[k]))))throw Error('INVALID_RECORD');
 const ids=new Set(derivePostCallPlan({callEndedAt:'local',endedAt:null,riskBand:'HIGH',emergency:true,
   answers:{linkOpened:'YES',codeShared:'YES',remoteInstalled:'YES',moneySent:'YES',identityShared:'YES'},cardExposureReported:true}).steps.map(x=>x.id));
 if(Object.keys(tasks).some(k=>!ids.has(k as FollowupTaskId)||!VALID_STATES.has(String(tasks[k]))))throw Error('INVALID_RECORD');
 return {answers:answers as SafeRecoveryRecord['answers'],taskStates:tasks as SafeRecoveryRecord['taskStates']};
}
export function createRecoveryCapsule(data:SafeRecoveryRecord,passphrase:unknown,now=Date.now()):string{
 if(!validPassphrase(passphrase))throw Error('INVALID_PASSPHRASE');
 const record=validateRecord(data);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('INVALID_TIME');
 const salt=randomBytes(16),iv=randomBytes(12);
 const key=pbkdf2Sync(passphrase,salt,210_000,32,'sha256');
 const cipher=createCipheriv('aes-256-gcm',key,iv);
 const plain=Buffer.from(JSON.stringify({version:1,issuedAt:now,expiresAt:now+TTL_MS,record}),'utf8');
 const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
 const tag=cipher.getAuthTag();key.fill(0);plain.fill(0);
 const envelope=JSON.stringify({v:1,kdf:'PBKDF2-SHA256-210K',salt:salt.toString('base64url'),iv:iv.toString('base64url'),
   tag:tag.toString('base64url'),data:encrypted.toString('base64url')});
 if(envelope.length>MAX_CAPSULE)throw Error('CAPSULE_TOO_LARGE');
 return Buffer.from(envelope).toString('base64url');
}
export function openRecoveryCapsule(capsule:unknown,passphrase:unknown,now=Date.now()):SafeRecoveryRecord{
 if(!validPassphrase(passphrase)||typeof capsule!=='string'||capsule.length<60||capsule.length>MAX_CAPSULE||
  !/^[A-Za-z0-9_-]+$/.test(capsule))throw Error('INVALID_CAPSULE');
 let env;
 try{env=JSON.parse(Buffer.from(capsule,'base64url').toString('utf8'));}catch{throw Error('INVALID_CAPSULE');}
 if(!env||env.v!==1||env.kdf!=='PBKDF2-SHA256-210K'||Object.keys(env).sort().join(',')!=='data,iv,kdf,salt,tag,v')throw Error('INVALID_CAPSULE');
 for(const [key,n] of [['salt',16],['iv',12],['tag',16]] as const){
   if(typeof env[key]!=='string'||Buffer.from(env[key],'base64url').length!==n)throw Error('INVALID_CAPSULE');
 }
 if(typeof env.data!=='string'||env.data.length>MAX_CAPSULE)throw Error('INVALID_CAPSULE');
 let key:Buffer|undefined,plaintext:Buffer|undefined;
 try{
   key=pbkdf2Sync(passphrase,Buffer.from(env.salt,'base64url'),210_000,32,'sha256');
   const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(env.iv,'base64url'));
   decipher.setAuthTag(Buffer.from(env.tag,'base64url'));
   plaintext=Buffer.concat([decipher.update(Buffer.from(env.data,'base64url')),decipher.final()]);
   const value=JSON.parse(plaintext.toString('utf8'));
   if(value.version!==1||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||
     value.expiresAt-value.issuedAt!==TTL_MS||value.issuedAt>now||value.expiresAt<=now)throw Error('EXPIRED_CAPSULE');
   return validateRecord(value.record);
 }catch{throw Error('INVALID_CAPSULE');}
 finally{key?.fill(0);plaintext?.fill(0);}
}
