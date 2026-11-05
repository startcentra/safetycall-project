/** Replaceable message observation port. The browser MOCK adapter never reads SMS.
 * Native adapters intentionally cannot be instantiated in this web-only build.
 */
import {createHash} from 'node:crypto';

export type MessageObservation=Readonly<{
 messageId:string;sourceKind:'BROWSER_MOCK_FIXTURE';provenance:'CONSENTED_CATALOG_FIXTURE';
 observedAt:string;contentDigest:string;senderVerificationState:'NOT_VERIFIED';
 consent:'USER_APPROVED_FIXTURE';retention:'SESSION_MEMORY';revision:1;
 caseVersion:number;linkedEvidenceIds:ReadonlyArray<string>;
 correlation:'CASE_RISK_CONTEXT_ONLY_NOT_MESSAGE_IDENTITY_PROOF';
}>;
export function observeBrowserMockFixture({messageId,body,link,receivedAt,caseVersion,evidenceIds=[]}:{
 messageId:string;body:string;link:string|null;receivedAt:string;caseVersion:number;evidenceIds?:ReadonlyArray<string>
}):MessageObservation{
 if(!/^msg_[a-z0-9]{10,32}$/.test(messageId)||typeof body!=='string'||body.length>1600||
   !(typeof link==='string'||link===null)||!Number.isSafeInteger(caseVersion)||caseVersion<0||
   !Number.isFinite(Date.parse(receivedAt)))throw Error('INVALID_BROWSER_MOCK_OBSERVATION');
 return {messageId,sourceKind:'BROWSER_MOCK_FIXTURE',provenance:'CONSENTED_CATALOG_FIXTURE',
  senderVerificationState:'NOT_VERIFIED',observedAt:receivedAt,
  contentDigest:'sha256:'+createHash('sha256').update(body+'\0'+(link??'')).digest('hex'),
  consent:'USER_APPROVED_FIXTURE',retention:'SESSION_MEMORY',revision:1,caseVersion,
  linkedEvidenceIds:[...evidenceIds].slice(0,16),correlation:'CASE_RISK_CONTEXT_ONLY_NOT_MESSAGE_IDENTITY_PROOF'};
}
/** A stub can only report unsupported; never grants OS authority on environment flags. */
export const NATIVE_MESSAGE_ADAPTER=Object.freeze({installed:false,
 readSms:():never=>{throw Error('UNSUPPORTED_NATIVE_MESSAGE_READ');},
 blockThirdPartyLink:():never=>{throw Error('UNSUPPORTED_NATIVE_LINK_BLOCK');}});
