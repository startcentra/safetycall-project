/** Local developer opt-in authorization: NEVER a replacement for production user login.
 * Independent local access passphrase and server signing key are both required.
 */
import { createHmac,randomUUID,timingSafeEqual,createHash } from 'node:crypto';
export type LiveScope='VOICE'|'SPARK';
type Ticket={scope:LiveScope;sid:string;nonce:string;exp:number};
export class LiveAuthError extends Error {constructor(){super('LIVE 로컬 사용자 인증이 필요합니다.');this.name='LiveAuthError';}}
const strong=(value:unknown):value is string=>typeof value==='string'&&value.length>=24;
export function checkLocalAccess(input:unknown,secret:unknown):boolean{
 if(!strong(secret)||typeof input!=='string')return false;
 return timingSafeEqual(createHash('sha256').update(input).digest(),createHash('sha256').update(secret).digest());
}
const sign=(value:string,key:string)=>createHmac('sha256',key).update(value).digest('base64url');
export function issueLiveTicket(scope:LiveScope,accessInput:unknown,accessSecret:unknown,signingKey:unknown,now=Date.now()):string{
 if(!checkLocalAccess(accessInput,accessSecret)||!strong(signingKey)||!['VOICE','SPARK'].includes(scope))throw new LiveAuthError();
 const ticket:Ticket={scope,sid:randomUUID(),nonce:randomUUID(),exp:now+60_000};
 const body=Buffer.from(JSON.stringify(ticket)).toString('base64url');
 return body+'.'+sign(body,signingKey);
}
export function verifyLiveTicket(token:unknown,scope:LiveScope,signingKey:unknown,now=Date.now()):Ticket{
 if(!strong(signingKey)||typeof token!=='string'||token.length>2000)throw new LiveAuthError();
 const parts=token.split('.');if(parts.length!==2||!parts.every(s=>/^[A-Za-z0-9_-]+$/.test(s)))throw new LiveAuthError();
 const expected=sign(parts[0],signingKey);const actual=Buffer.from(parts[1]);const valid=Buffer.from(expected);
 if(actual.length!==valid.length||!timingSafeEqual(actual,valid))throw new LiveAuthError();
 let parsed:unknown;try{parsed=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{throw new LiveAuthError();}
 const t=parsed as Ticket;
 if(!t||t.scope!==scope||!Number.isSafeInteger(t.exp)||t.exp<now||t.exp>now+60_000||
    typeof t.sid!=='string'||!/^[0-9a-f-]{36}$/.test(t.sid)||typeof t.nonce!=='string'||!/^[0-9a-f-]{36}$/.test(t.nonce))throw new LiveAuthError();
 return t;
}
export function originMatchesHost(origin:string|null,host:string|null):boolean{
 if(!origin||!host)return false;
 try{const url=new URL(origin);return url.protocol==='http:'&&url.host===host&&['localhost','127.0.0.1'].includes(url.hostname);}catch{return false;}
}

/** Longer-lived, locally approved Spark call session. Reuse ONE signed ticket across
 * requests from the same call, never accept an untrusted browser-supplied budget ID.
 * This is a developer-only authorization, not a production identity system.
 */
type SparkSession={scope:'SPARK_CALL';sid:string;nonce:string;exp:number};
export function issueSparkSessionTicket(accessInput:unknown,accessSecret:unknown,signingKey:unknown,now=Date.now()):string {
 if(!checkLocalAccess(accessInput,accessSecret)||!strong(signingKey))throw new LiveAuthError();
 const t:SparkSession={scope:'SPARK_CALL',sid:randomUUID(),nonce:randomUUID(),exp:now+10*60_000};
 const body=Buffer.from(JSON.stringify(t)).toString('base64url');
 return body+'.'+sign(body,signingKey);
}
export function verifySparkSessionTicket(token:unknown,signingKey:unknown,now=Date.now()):SparkSession {
 if(!strong(signingKey)||typeof token!=='string'||token.length>2000)throw new LiveAuthError();
 const parts=token.split('.');if(parts.length!==2||!parts.every(x=>/^[A-Za-z0-9_-]+$/.test(x)))throw new LiveAuthError();
 const expected=Buffer.from(sign(parts[0],signingKey));const actual=Buffer.from(parts[1]);
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new LiveAuthError();
 let v:unknown;try{v=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{throw new LiveAuthError();}
 if(!v||typeof v!=='object')throw new LiveAuthError();
 const t=v as SparkSession;
 if(t.scope!=='SPARK_CALL'||!Number.isSafeInteger(t.exp)||t.exp<now||t.exp>now+10*60_000||
    typeof t.sid!=='string'||!/^[0-9a-f-]{36}$/.test(t.sid)||typeof t.nonce!=='string'||!/^[0-9a-f-]{36}$/.test(t.nonce))throw new LiveAuthError();
 return t;
}
