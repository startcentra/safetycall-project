/** Evidence-grounded, deterministic guidance; does NOT execute calls, banking or emergency actions. */
import type {CaseState} from '../case/index.ts';
import {getCaseView} from '../case/index.ts';
import type {ModelAssessment} from '../analysis/meta-contract.ts';
import type {TriageSignal} from '../risk-triage/index.ts';
import {ACTION_CARDS, REPLY_TEMPLATES} from './cards.ts';
import {sourceById} from './sources.ts';
import type {ActionCard,EvidenceCode,GuidanceAction,Jurisdiction,LiveGuidanceDecision,ReplyTemplateId} from './types.ts';

export interface GuidanceContext {
  caseState:CaseState;
  jurisdiction?:Jurisdiction;
  /** Models are never an authority. They can only corroborate evidence at the exact case revision. */
  model?:ModelAssessment|null;
  modelStateVersion?:number;
  /** Explicit user choice after a safety assessment; never inferred by AI. */
  safeToSpeak?:boolean;
  requestDelayPhrase?:boolean;
  familyContactStatus?:'NOT_REQUESTED'|'NO_RESPONSE'|'SELF_REPORTED_SAFE';
  /** Test-only override for verifying draft/source rejection. */
  registry?:readonly ActionCard[];
}

const FALLBACK_ID='UNCERTAIN_NO_HARD_WARNING';
function checked(card:ActionCard,jurisdiction:Jurisdiction):boolean {
  return card.status==='DEMO_REVIEWED'&&
   (jurisdiction==='UNKNOWN'||card.jurisdictions.includes(jurisdiction))&&
   card.sourceIds.length>0&&card.sourceIds.every(id=>{
     const src=sourceById(id);return !!src&&src.status==='PUBLIC_SOURCE_CHECKED';
   });
}
function makeAction(card:ActionCard,ids:readonly string[]):GuidanceAction {
  return {id:card.id,priority:card.priority,userAction:card.userAction,sourceIds:[...card.sourceIds],evidenceUtteranceIds:[...ids]};
}
function evidenceIds(turns:CaseState['checkpoint']['turns'],signal:EvidenceCode):string[] {
  return turns.filter(t=>t.status==='ACTIVE'&&(
    signal==='FAMILY_EMERGENCY_CLAIM'?t.contextTags.includes('FAMILY_EMERGENCY_CLAIM'):
    signal==='FAMILY_KIDNAP_CLAIM'?t.contextTags.includes('FAMILY_KIDNAP_CLAIM'):
    t.signals.some(s=>s.code===signal)
  )).map(t=>t.turnId);
}
function resolveSentence(template:ReplyTemplateId,emergency:boolean,safeToSpeak:boolean):string|null {
  if(emergency||!safeToSpeak)return null;
  return REPLY_TEMPLATES[template]??null;
}
/** A model suggestion without locally corroborated, active, correctly-versioned evidence cannot authorize a card. */
function validModelSuggestion(ctx:GuidanceContext,validIds:Set<string>):boolean {
  const model=ctx.model;
  if(!model||ctx.modelStateVersion!==ctx.caseState.version||!model.evidenceUtteranceIds.length)return false;
  return model.evidenceUtteranceIds.every(id=>validIds.has(id));
}
export function selectLiveGuidance(ctx:GuidanceContext):LiveGuidanceDecision {
  const state=ctx.caseState;
  const view=getCaseView(state);
  const jurisdiction=ctx.jurisdiction??'UNKNOWN';
  const cards=ctx.registry??ACTION_CARDS;
  const active=state.checkpoint.turns.filter(t=>t.status==='ACTIVE');
  const callerEvidence=active.filter(t=>t.speaker==='caller'&&!t.instructionalContext);
  const callerIds=new Set(callerEvidence.map(t=>t.turnId));
  // Never accept a threat/user identity from UNKNOWN speakers, model prose or disputed evidence.
  const codes=new Set<EvidenceCode>();
  const byCode=new Map<EvidenceCode,string[]>();
  const localSignals:ReadonlyArray<TriageSignal>=callerEvidence.flatMap(t=>t.signals);
  for(const signal of localSignals){
    if(signal.code==='DIRECT_THREAT'||signal.code==='MONEY_REQUEST'||signal.code==='CREDENTIAL_REQUEST'||signal.code==='SECRECY')codes.add(signal.code);
  }
  if(callerEvidence.some(t=>t.contextTags.includes('FAMILY_EMERGENCY_CLAIM')))codes.add('FAMILY_EMERGENCY_CLAIM');
  if(callerEvidence.some(t=>t.contextTags.includes('FAMILY_KIDNAP_CLAIM')))codes.add('FAMILY_KIDNAP_CLAIM');
  if(active.some(t=>t.speaker==='user'&&t.signals.some(s=>s.code==='POST_TRANSFER')))codes.add('POST_TRANSFER');
  // User action (mock transfer prepared) may add money risk, but is not a verified caller demand.
  if(state.actionEvent==='TRANSFER_PREPARED')codes.add('MONEY_REQUEST');
  if(state.actionEvent==='OTP_SHARE_ATTEMPT')codes.add('CREDENTIAL_REQUEST');
  for(const code of codes) {
    byCode.set(code,code==='POST_TRANSFER'?active.filter(t=>t.speaker==='user'&&t.signals.some(s=>s.code==='POST_TRANSFER')).map(t=>t.turnId):
      evidenceIds(callerEvidence,code));
  }
  const emergency=codes.has('DIRECT_THREAT')||codes.has('FAMILY_KIDNAP_CLAIM');
  const include=(card:ActionCard)=> {
    if(card.id===FALLBACK_ID)return false;
    if(!checked(card,jurisdiction))return false;
    if(!card.triggerSignals.some(sig=>codes.has(sig)))return false;
    if(card.id==='SAFE_SLOW_DOWN_OPTION'&&(!ctx.safeToSpeak||!ctx.requestDelayPhrase||emergency))return false;
    if(card.id==='SEEK_SECOND_CONTACT'&&ctx.familyContactStatus!=='NO_RESPONSE')return false;
    return true;
  };
  let selected=cards.filter(include).sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  // A model can only reinforce cards already triggered by local, active facts; no new danger/policy from AI.
  const modelTrusted=validModelSuggestion(ctx,callerIds);
  const suggested=modelTrusted?new Set(ctx.model!.recommendedActionCodes):new Set<string>();
  const matchedModel=selected.filter(c=>
    (c.id==='EMERGENCY_CONTACT_GUIDANCE'&&suggested.has('CONTACT_112'))||
    (c.id==='POST_PAYMENT_RECOVERY'&&suggested.has('CONTACT_BANK_AND_112'))||
    (c.id==='DO_NOT_TRANSFER'&&suggested.has('DO_NOT_TRANSFER'))||
    (c.id==='DO_NOT_DISCLOSE_PERSONAL_DATA'&&suggested.has('DO_NOT_SHARE_OTP'))||
    (c.id==='FAMILY_INDEPENDENT_VERIFY'&&suggested.has('SEEK_INDEPENDENT_HELP'))
  );
  // Keep model preference only as an explanation; deterministic local safety priority is immutable.
  if(!selected.length) {
    const fallback=cards.find(c=>c.id===FALLBACK_ID&&checked(c,jurisdiction))??ACTION_CARDS.find(c=>c.id===FALLBACK_ID)!;
    selected=[fallback];
  }
  if(state.status==='CLOSED')selected=[ACTION_CARDS.find(c=>c.id===FALLBACK_ID)!];
  const primary=selected[0];
  const secondary=state.status==='OPEN'?selected.find(c=>c.id!==primary.id && (
    emergency?c.id==='DO_NOT_TRANSFER'||c.id==='POST_PAYMENT_RECOVERY':
    c.id==='FAMILY_INDEPENDENT_VERIFY'||c.id==='SEEK_SECOND_CONTACT'||c.id==='DO_NOT_DISCLOSE_PERSONAL_DATA'
  ))??null:null;
  const ids=(card:ActionCard)=>[...new Set(card.triggerSignals.flatMap(code=>byCode.get(code)??[]))];
  const safetyCritical=emergency||state.status==='CLOSED';
  // No dialogue script in an emergency. Otherwise require explicit permission to speak safely.
  const replyTemplateId:ReplyTemplateId=safetyCritical||!ctx.safeToSpeak?'NO_SCRIPT':
    ctx.requestDelayPhrase&&selected.some(c=>c.id==='SAFE_SLOW_DOWN_OPTION')?'REQUEST_TIME':primary.replyTemplateId;
  const replyText=resolveSentence(replyTemplateId,safetyCritical,!!ctx.safeToSpeak);
  const resultStatus=state.status==='CLOSED'?'CLOSED':primary.id===FALLBACK_ID?'FALLBACK':'ACTIVE';
  return {
    caseId:state.caseId,stateVersion:state.version,lastUtteranceId:view.lastUtteranceId,status:resultStatus,
    primary:makeAction(primary,ids(primary)),secondary:secondary?makeAction(secondary,ids(secondary)):null,
    replyTemplateId,replyText,
    reason:primary.id===FALLBACK_ID?'충분한 확정 근거 없음':
      `활성 근거 ${ids(primary).join(', ')||'사용자 행동 이벤트'} 기반·팀 검토 데모 카드${matchedModel.some(c=>c.id===primary.id)?' / 모델 제안은 참고만 함':''}`,
    limitations:[
      '범죄·실제 납치·가족 안전을 확정하지 않습니다.',
      '출처는 공개 대응 자료이며 코칭 카드는 팀 내부 데모 검토 결과이지 기관의 승인이 아닙니다.',
      ...(jurisdiction==='UNKNOWN'?['국가 미확인: 긴급 번호를 추정하지 않습니다.']:[]),
      ...(!modelTrusted&&ctx.model?['Meta 결과는 사건 버전 또는 근거가 불일치해 카드 결정에 반영하지 않았습니다.']:[]),
      ...(state.status==='CLOSED'?['종료된 사건에는 새로운 코칭을 적용하지 않습니다.']:[]),
    ],
    executionAuthorized:false,
  };
}
/** UI may accept a recommendation only if it belongs to the exact current case revision. */
export function isCurrentGuidance(decision:LiveGuidanceDecision,caseState:CaseState):boolean {
  return decision.caseId===caseState.caseId&&decision.stateVersion===caseState.version&&caseState.status==='OPEN';
}
