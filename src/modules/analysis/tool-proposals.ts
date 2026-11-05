/** Untrusted model/tool suggestions. Proposal validation is not command authorization. */
import type {CaseState} from '../case/index.ts';
const KINDS=['SHOW_GUIDANCE','OFFER_MOCK_CARD_LOCK','OFFER_MOCK_TRANSFER_HOLD','PROMPT_LOCATION_PERMISSION'] as const;
const GUIDANCE=['VERIFY_OFFICIAL_CHANNEL','DO_NOT_SHARE_OTP','DO_NOT_TRANSFER','EMERGENCY_HELP'] as const;
const MAX_IDS=12;
export type ToolProposal=Readonly<{
  kind:typeof KINDS[number];caseId:string;stateVersion:number;evidenceIds:readonly string[];
  actionCode?:typeof GUIDANCE[number];cardRef?:'DEMO_CARD_1';transferRef?:'DEMO_TRANSFER_1';
  reasonCode?:'USER_REQUESTED_MAP'|'USER_OPTED_IN_BANK_HELP';
}>;
export type ProposalDecision=Readonly<{accepted:boolean;reason:'ACCEPTED'|'INVALID_SCHEMA'|'CASE_CHANGED'|'CLOSED'|'EVIDENCE_INVALID'|'EMERGENCY_PRIORITY'|'CONTEXT_MISMATCH'}>;
const keys={SHOW_GUIDANCE:['kind','caseId','stateVersion','evidenceIds','actionCode'],
  OFFER_MOCK_CARD_LOCK:['kind','caseId','stateVersion','evidenceIds','cardRef'],
  OFFER_MOCK_TRANSFER_HOLD:['kind','caseId','stateVersion','evidenceIds','transferRef'],
  PROMPT_LOCATION_PERMISSION:['kind','caseId','stateVersion','evidenceIds','reasonCode']} as const;
const same=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every(v=>b.includes(v));
export function evaluateToolProposal(input:unknown,caseState:CaseState,runVersion:number, context:{cardExposureReported?:boolean}={}):ProposalDecision {
  const reject=(reason:ProposalDecision['reason']):ProposalDecision=>({accepted:false,reason});
  if(!input||typeof input!=='object'||Array.isArray(input))return reject('INVALID_SCHEMA');
  const p=input as Record<string,unknown>;
  if(!KINDS.includes(p.kind as ToolProposal['kind'])||typeof p.caseId!=='string'||
    !Number.isSafeInteger(p.stateVersion)||!Array.isArray(p.evidenceIds)||p.evidenceIds.length>MAX_IDS||
    !p.evidenceIds.every(v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(v))||
    new Set(p.evidenceIds).size!==p.evidenceIds.length)return reject('INVALID_SCHEMA');
  const permitted=keys[p.kind as ToolProposal['kind']];
  if(!same(Object.keys(p),permitted))return reject('INVALID_SCHEMA');
  if((p.kind==='SHOW_GUIDANCE'&&(typeof p.actionCode!=='string'||!GUIDANCE.includes(p.actionCode as typeof GUIDANCE[number])))||
    (p.kind==='OFFER_MOCK_CARD_LOCK'&&p.cardRef!=='DEMO_CARD_1')||
    (p.kind==='OFFER_MOCK_TRANSFER_HOLD'&&p.transferRef!=='DEMO_TRANSFER_1')||
    (p.kind==='PROMPT_LOCATION_PERMISSION'&&!['USER_REQUESTED_MAP','USER_OPTED_IN_BANK_HELP'].includes(p.reasonCode as string)))return reject('INVALID_SCHEMA');
  if(p.caseId!==caseState.caseId||p.stateVersion!==runVersion)return reject('CASE_CHANGED');
  if(caseState.status!=='OPEN')return reject('CLOSED');
  const active=caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&t.signals.length>0).map(t=>t.turnId);
  if((p.evidenceIds as string[]).length===0&&p.kind!=='PROMPT_LOCATION_PERMISSION')return reject('EVIDENCE_INVALID');
  if(!(p.evidenceIds as string[]).every(id=>active.includes(id)))return reject('EVIDENCE_INVALID');
  const emergency=caseState.history.at(-1)?.emergencyFlag===true;
  if(emergency&&p.kind!=='SHOW_GUIDANCE')return reject('EMERGENCY_PRIORITY');
  if(p.kind==='SHOW_GUIDANCE'&&emergency&&p.actionCode!=='EMERGENCY_HELP')return reject('EMERGENCY_PRIORITY');
  // Consent to use location must be initiated by the user, not inferred from model language.
  if(p.kind==='PROMPT_LOCATION_PERMISSION')return reject('CONTEXT_MISMATCH');
  if(p.kind==='OFFER_MOCK_CARD_LOCK'&&!context.cardExposureReported)return reject('CONTEXT_MISMATCH');
  if(p.kind==='OFFER_MOCK_TRANSFER_HOLD'&&!caseState.checkpoint.turns.some(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&t.signals.some(sig=>sig.code==='MONEY_REQUEST')))return reject('CONTEXT_MISMATCH');
  return {accepted:true,reason:'ACCEPTED'};
}
