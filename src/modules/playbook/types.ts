/** Internal DEMO review is not endorsement by the originating public agency. */
export type Jurisdiction = 'KR'|'US'|'UNKNOWN';
export type SourceStatus = 'PUBLIC_SOURCE_CHECKED'|'UNVERIFIED';
export interface PlaybookSource {
  id:string; organization:string; title:string; url:string; jurisdiction:Jurisdiction;
  publishedAt:string|null; lastVerifiedAt:string; status:SourceStatus;
  note:string;
}
export type ActionCardId =
  |'EMERGENCY_CONTACT_GUIDANCE'|'FAMILY_INDEPENDENT_VERIFY'|'DO_NOT_TRANSFER'
  |'DO_NOT_DISCLOSE_PERSONAL_DATA'|'SAFE_SLOW_DOWN_OPTION'|'SEEK_SECOND_CONTACT'
  |'POST_PAYMENT_RECOVERY'|'UNCERTAIN_NO_HARD_WARNING';
export type ReplyTemplateId = 'NO_SCRIPT'|'VERIFY_SAFETY'|'DECLINE_PAYMENT'|'CHECK_OFFICIAL'|'REQUEST_TIME';
export type PlaybookStatus = 'DRAFT'|'DEMO_REVIEWED'|'DISABLED';
export type EvidenceCode = 'DIRECT_THREAT'|'MONEY_REQUEST'|'CREDENTIAL_REQUEST'|'FAMILY_EMERGENCY_CLAIM'|'FAMILY_KIDNAP_CLAIM'|'POST_TRANSFER'|'SECRECY';
export interface ActionCard {
  id:ActionCardId;version:1;status:PlaybookStatus;jurisdictions:readonly ('KR'|'US')[];
  triggerSignals:readonly EvidenceCode[];priority:number;
  userAction:string;replyTemplateId:ReplyTemplateId;
  sourceIds:readonly string[];allowedTools:readonly string[];forbiddenActions:readonly string[];
  contraindications:readonly string[];
}
export interface GuidanceAction {
  id:ActionCardId;priority:number;userAction:string;sourceIds:string[];evidenceUtteranceIds:string[];
}
export interface LiveGuidanceDecision {
  caseId:string;stateVersion:number;lastUtteranceId:string|null;status:'ACTIVE'|'CLOSED'|'FALLBACK';
  primary:GuidanceAction;secondary:GuidanceAction|null;
  replyTemplateId:ReplyTemplateId;replyText:string|null;
  reason:string;limitations:string[];
  /** Display-only. No tool actions, external calls or persistent side effects. */
  executionAuthorized:false;
}
