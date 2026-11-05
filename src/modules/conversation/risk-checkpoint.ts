/** Bounded per-call risk evidence checkpoint for later Situation Memory integration.
 * No independent detector: signals are sourced ONLY from assessTriage().
 * Ephemeral demo state; never persisted as a verified criminal finding.
 */
import {assessTriage,type Speaker,type TriageSignal,type TriageResult} from '../risk-triage/index.ts';
export type RiskEvidenceStatus='ACTIVE'|'DISPUTED'|'RESOLVED'|'RETRACTED';
export interface EvidenceTurn {turnId:string;revision:number;absoluteIndex:number;speaker:Speaker;status:RiskEvidenceStatus;statusReason?:string;signals:TriageSignal[];contextTags:('FAMILY_EMERGENCY_CLAIM'|'FAMILY_KIDNAP_CLAIM')[];instructionalContext:boolean;}
export interface RiskEvidenceCheckpoint {callId:string;version:number;turns:EvidenceTurn[];}
export function emptyRiskCheckpoint(callId:string):RiskEvidenceCheckpoint {
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(callId))throw new Error('통화 식별자 형식 오류');
 return {callId,version:0,turns:[]};
}
/** Final-only, monotonically increasing revisions. An explicit correction replaces the old facts. */
export function upsertFinalEvidence(state:RiskEvidenceCheckpoint,change:{callId:string;turnId:string;revision:number;absoluteIndex:number;speaker:Speaker;text:string}):RiskEvidenceCheckpoint {
 if(change.callId!==state.callId)throw new Error('다른 통화의 위험 근거입니다.');
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(change.turnId)||!Number.isSafeInteger(change.revision)||change.revision<0||
    !Number.isSafeInteger(change.absoluteIndex)||change.absoluteIndex<0||!['caller','user','unknown','multiple'].includes(change.speaker)||
    (!change.text.trim()||change.text.length>100_000))throw new Error('완료 발화 또는 정정 데이터 오류');
 const old=state.turns.find(t=>t.turnId===change.turnId);
 if(old&&change.revision<=old.revision)return state; // duplicate and out-of-order correction
 const assessment=assessTriage({turns:[{speaker:change.speaker,text:change.text}]});
 // Observational claim only, NOT a second risk score or a verified kidnapping.
 // Deliberately conservative: educational or quoted examples must not trigger family guidance.
 const educational=/(?:보이스피싱.{0,18}예방.{0,12}교육|(?:범인|사기범).{0,90}(?:라고\s?했(?:다|다는)|말했(?:다|다는)).{0,18}사례|보이스피싱\s?예방\s?교육|사기\s?예방\s?교육|교육에서\s?예를\s?들어|훈련\s?대본|드라마\s?대사|뉴스에\s?따르면|뉴스에서\s?보았|기사에서\s?읽었|예방\s?강의|\b(?:news report|training script|fraud awareness training|example of a scam)\b)/i.test(change.text);
 const familyClaim=change.speaker==='caller'&&!educational&&
  (/(?:가족|아들|딸|아이|자녀|엄마|아빠|어머니|아버지|손녀|손자|아드님|따님).{0,35}(?:납치|데리고\s?있|붙잡|사고|다쳤|위험|살려|해칠|죽일|급하)/.test(change.text)||
   /(?:납치|데리고\s?있|붙잡|사고|다쳤|위험|살려|해칠|죽일).{0,35}(?:가족|아들|딸|아이|자녀|엄마|아빠|어머니|아버지|손녀|손자|아드님|따님)/.test(change.text)||
   /\b(?:your\s+(?:son|daughter|grandson|granddaughter|child|mother|father|relative)).{0,65}(?:injured|hospital|accident|kidnapped|taken|held|hurt|danger|arrested)/i.test(change.text)||
   /\b(?:kidnapped|taken|held|hurt).{0,35}your\s+(?:son|daughter|grandson|granddaughter|child)/i.test(change.text));
 const kidnappingClaim=familyClaim&&(
  /(?:아들|딸|아이|자녀|가족).{0,35}(?:납치|붙잡|데리고\s?있)/.test(change.text)||
  /(?:납치|붙잡|데리고\s?있).{0,35}(?:아들|딸|아이|자녀|가족)/.test(change.text)||
  /\b(?:your\s+(?:son|daughter|child|grandson|granddaughter)).{0,45}(?:kidnapped|held\s+hostage)/i.test(change.text)||
  /\b(?:kidnapped|held\s+hostage).{0,35}your\s+(?:son|daughter|child|grandson|granddaughter)/i.test(change.text));
 const current:EvidenceTurn={turnId:change.turnId,revision:change.revision,absoluteIndex:change.absoluteIndex,
  speaker:change.speaker,status:'ACTIVE',instructionalContext:educational,contextTags:familyClaim?(kidnappingClaim?['FAMILY_EMERGENCY_CLAIM','FAMILY_KIDNAP_CLAIM']:['FAMILY_EMERGENCY_CLAIM']):[],signals:(educational?[]:assessment.signals.filter(s=>s.turn>=0||s.code==='POST_TRANSFER')).map(s=>({...s,turn:change.absoluteIndex}))};
 const turns=state.turns.filter(t=>t.turnId!==change.turnId);
 turns.push(current);
 if(turns.length>1000)throw new Error('근거 보관 한도 초과: 새 LIVE 진행 차단');
 return {callId:state.callId,version:state.version+1,turns:turns.sort((a,b)=>a.absoluteIndex-b.absoluteIndex)};
}
export function retractFinalEvidence(state:RiskEvidenceCheckpoint,change:{callId:string;turnId:string;revision:number}):RiskEvidenceCheckpoint {
 if(change.callId!==state.callId)throw new Error('다른 통화의 정정 요청');
 const old=state.turns.find(t=>t.turnId===change.turnId);
 if(!old)throw new Error('존재하지 않는 발화 정정');
 if(!Number.isSafeInteger(change.revision)||change.revision<=old.revision)return state;
 return {...state,version:state.version+1,turns:state.turns.map(t=>t.turnId===change.turnId?{...t,status:'RETRACTED',revision:change.revision}:t)};
}
/** Merge checkpoint facts with current window by calling THE ONE scoring function. */
export function assessWithCheckpoint(state:RiskEvidenceCheckpoint,recent:{speaker:Speaker;text:string}[]=[]):TriageResult {
 const priorSignals=state.turns.filter(t=>t.status==='ACTIVE').flatMap(t=>t.signals);
 return assessTriage({turns:recent,priorSignals});
}
