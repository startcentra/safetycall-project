/** SafeCall v0.6.5 — in-memory, pure case coordinator for OFFLINE/MOCK use.
 * Does not send messages, place calls, authorize money, run LLMs, or infer identities.
 * It composes the existing risk-checkpoint and the ONE assessTriage() engine.
 */
import {
  emptyRiskCheckpoint,upsertFinalEvidence,retractFinalEvidence,
  type RiskEvidenceCheckpoint,type RiskEvidenceStatus,
} from '../conversation/risk-checkpoint.ts';
import {assessTriage,type ActionEvent,type Speaker,type TriageResult} from '../risk-triage/index.ts';
import {deriveLiveSignals,type LiveSignalSnapshot} from './live-signals.ts';

export type CaseStatus='OPEN'|'CLOSED';
export interface CaseHistoryEntry {
  version:number; eventId:string; eventType:CaseEvent['type'];
  lastUtteranceId:string|null; situationRiskIndex:number;
  urgency:number; coercivePressure:number; actionProximity:number; livePressureIndex:number;
  urgencyDelta:number; emergencyFlag:boolean;
}
export interface CaseState {
  caseId:string; status:CaseStatus; version:number;
  checkpoint:RiskEvidenceCheckpoint;
  actionEvent:ActionEvent;
  appliedEvents:ReadonlyArray<{id:string;digest:string}>;
  history:ReadonlyArray<CaseHistoryEntry>;
}
interface EventBase {caseId:string; eventId:string; expectedVersion?:number;}
export type CaseEvent =
  | (EventBase & {type:'UTTERANCE_FINAL';turnId:string;revision:number;absoluteIndex:number;speaker:Speaker;text:string})
  | (EventBase & {type:'UTTERANCE_RETRACT';turnId:string;revision:number})
  | (EventBase & {type:'EVIDENCE_STATUS';turnId:string;revision:number;status:Exclude<RiskEvidenceStatus,'ACTIVE'>;reason:string})
  | (EventBase & {type:'USER_ACTION';action:ActionEvent})
  | (EventBase & {type:'CASE_CLOSED'});

const ID=/^[a-zA-Z0-9_-]{1,64}$/;
export function createCase(caseId:string):CaseState {
  if(!ID.test(caseId))throw new Error('사건 식별자 형식 오류');
  return {caseId,status:'OPEN',version:0,checkpoint:emptyRiskCheckpoint(caseId),actionEvent:'NONE',appliedEvents:[],history:[]};
}
function activeTurns(state:CaseState) {
  return state.checkpoint.turns.filter(t=>t.status==='ACTIVE');
}
function latestTurn(state:CaseState) {
  // A user utterance or UNKNOWN is a valid observation; do not reuse old caller pressure as current.
  return activeTurns(state).reduce<(typeof state.checkpoint.turns)[number]|null>((last,t)=>
    !last||t.absoluteIndex>last.absoluteIndex?t:last,null);
}
function currentLive(state:CaseState):LiveSignalSnapshot {
  const current=latestTurn(state);
  const historyBeforeCurrent = state.history.at(-1)?.version===state.version ? state.history.at(-2) : state.history.at(-1);
  const previous=historyBeforeCurrent?.urgency??0;
  return deriveLiveSignals(state.status==='CLOSED'?[]:(current?.signals??[]),previous,state.status==='CLOSED'?'NONE':state.actionEvent);
}
/** Snapshot risk reuses existing scorer. No model-generated score overwrites it. */
export function getCaseView(state:CaseState):{
  caseId:string;status:CaseStatus;stateVersion:number;assessment:TriageResult;
  live:LiveSignalSnapshot;activeEvidenceCount:number;disputedEvidenceCount:number;
  resolvedEvidenceCount:number;retractedEvidenceCount:number;lastUtteranceId:string|null;
} {
  const assessment=assessTriage({turns:[],priorSignals:activeTurns(state).flatMap(t=>t.signals),actionEvent:state.actionEvent});
  const live=currentLive(state);
  return {caseId:state.caseId,status:state.status,stateVersion:state.version,assessment,live,
    activeEvidenceCount:activeTurns(state).flatMap(t=>t.signals).length,
    disputedEvidenceCount:state.checkpoint.turns.filter(t=>t.status==='DISPUTED').length,
    resolvedEvidenceCount:state.checkpoint.turns.filter(t=>t.status==='RESOLVED').length,
    retractedEvidenceCount:state.checkpoint.turns.filter(t=>t.status==='RETRACTED').length,
    lastUtteranceId:latestTurn(state)?.turnId??null};
}
/** Bounded non-cryptographic duplicate fingerprint (not an authorization credential).
 * Avoid storing the full utterance a second time in the idempotency ledger.
 */
function eventDigest(event:CaseEvent) {
 const content=JSON.stringify(event);
 let hash1=2166136261,hash2=2166136261^0x9e3779b9;
 for(let i=0;i<content.length;i++){
  const c=content.charCodeAt(i);
  hash1=Math.imul(hash1^c,16777619);
  hash2=Math.imul(hash2^(c+i%251),16777619);
 }
 return `${content.length}:${(hash1>>>0).toString(16)}:${(hash2>>>0).toString(16)}`;
}
export function applyCaseEvent(state:CaseState,event:CaseEvent):CaseState {
  if(event.caseId!==state.caseId||!ID.test(event.eventId))throw new Error('사건 또는 이벤트 식별자 오류');
  const digest=eventDigest(event);
  const already=state.appliedEvents.find(e=>e.id===event.eventId);
  if(already) {
    if(already.digest!==digest)throw new Error('동일한 이벤트 ID에 서로 다른 내용이 있습니다.');
    return state; // idempotence even after case closed
  }
  if(state.status==='CLOSED')throw new Error('종료된 사건에 새로운 이벤트를 적용할 수 없습니다.');
  if(event.expectedVersion!==undefined && event.expectedVersion!==state.version)throw new Error('사건 상태 버전 충돌');
  let checkpoint=state.checkpoint;
  let actionEvent=state.actionEvent;
  let status:CaseStatus=state.status;
  if(event.type==='UTTERANCE_FINAL') {
    const previous=checkpoint.turns.find(t=>t.turnId===event.turnId);
    if(!previous && checkpoint.turns.some(t=>t.absoluteIndex===event.absoluteIndex))throw new Error('발화 순서 충돌');
    if(previous && previous.absoluteIndex!==event.absoluteIndex)throw new Error('기존 발화의 순서가 변경됐습니다.');
    checkpoint=upsertFinalEvidence(checkpoint,{callId:event.caseId,turnId:event.turnId,revision:event.revision,absoluteIndex:event.absoluteIndex,speaker:event.speaker,text:event.text});
  } else if(event.type==='UTTERANCE_RETRACT') {
    checkpoint=retractFinalEvidence(checkpoint,{callId:event.caseId,turnId:event.turnId,revision:event.revision});
  } else if(event.type==='EVIDENCE_STATUS') {
    if(!event.reason.trim()||event.reason.length>300)throw new Error('근거 변경에는 명시적인 이유가 필요합니다.');
    const existing=checkpoint.turns.find(t=>t.turnId===event.turnId);
    if(!existing)throw new Error('존재하지 않는 위험 근거');
    if(event.revision<=existing.revision)return state; // stale state event
    checkpoint={...checkpoint,version:checkpoint.version+1,turns:checkpoint.turns.map(t=>t.turnId===event.turnId?
      {...t,revision:event.revision,status:event.status,statusReason:event.reason}:t)};
  } else if(event.type==='USER_ACTION') {
    if(!['NONE','TRANSFER_PREPARED','OTP_SHARE_ATTEMPT'].includes(event.action))throw new Error('알 수 없는 행동 이벤트');
    actionEvent=event.action;
  } else if(event.type==='CASE_CLOSED') {
    status='CLOSED';
  }
  // If no state changed, do not claim an update or append repeated events.
  if(checkpoint===state.checkpoint&&actionEvent===state.actionEvent&&status===state.status)return state;
  const next:CaseState={...state,checkpoint,actionEvent,status,version:state.version+1,
    appliedEvents:[...state.appliedEvents,{id:event.eventId,digest}],history:state.history};
  const view=getCaseView(next);
  const row:CaseHistoryEntry={version:next.version,eventId:event.eventId,eventType:event.type,
    lastUtteranceId:view.lastUtteranceId,situationRiskIndex:view.assessment.riskIndex,
    urgency:view.live.urgency,coercivePressure:view.live.coercivePressure,actionProximity:view.live.actionProximity,
    livePressureIndex:view.live.livePressureIndex,urgencyDelta:view.live.urgencyDelta,
    emergencyFlag:view.assessment.emergencyFlag};
  if(next.appliedEvents.length>2000)throw new Error('사건 이벤트 한도 초과: 새 작업을 시작하지 않습니다.');
  return {...next,history:[...state.history,row]};
}

/** Finalized-only replay. Caller supplies no labels, no future turns and no model outputs. */
export function buildCaseTimeline(caseId:string,turns:ReadonlyArray<{turnId:string;speaker:Speaker;text:string}>):CaseState[] {
  let state=createCase(caseId);const output:CaseState[]=[];
  for(const [i,turn] of turns.entries()) {
    state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId,eventId:`final_${i}`,turnId:turn.turnId,
      revision:0,absoluteIndex:i,speaker:turn.speaker,text:turn.text});
    output.push(state);
  }
  return output;
}
