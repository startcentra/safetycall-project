/** v1.29 Evidence-grounded MOCK-only analysis orchestration.
 * No external API / LIVE mode. Canonical risk is always the Case Coordinator's score.
 * A future LIVE path must use a separate explicit authorization & budget gate.
 */
import {getCaseView,type CaseState} from '../case/index.ts';
import {MockMetaProvider} from './meta-provider.ts';
import {validateMetaInput,validateModelOutput} from './meta-validation.ts';
import type {MetaAnalysisProvider,MetaAnalysisResponse,InputTurn,ModelAssessment} from './meta-contract.ts';

export type ReviewOutcome='MOCK_VALIDATED'|'LOCAL_FALLBACK'|'NO_ACTIVE_EVIDENCE';
export interface EvidenceReviewResult {
  status:ReviewOutcome;
  metaCalled:false;
  actualStt:false;
  mode:'MOCK';
  caseId:string;
  caseVersion:number;
  analysis:ModelAssessment|null;
  evidenceIds:readonly string[];
  reasonCode?:'PROVIDER_FAILED'|'PROVIDER_INVALID'|'ABORTED';
}
const callerSignalIds=(state:CaseState)=>state.checkpoint.turns.filter(t=>
  t.status==='ACTIVE'&&t.speaker==='caller'&&t.signals.length>0&&!t.instructionalContext).map(t=>t.turnId);
/** Explicit text is taken from session memory; only active evidence IDs are eligible. */
export async function reviewActiveEvidence({state,turns,provider=new MockMetaProvider(),signal}:
  {state:CaseState;turns:readonly InputTurn[];provider?:MetaAnalysisProvider;signal?:AbortSignal}):Promise<EvidenceReviewResult>{
  const base={mode:'MOCK' as const,metaCalled:false as const,actualStt:false as const,caseId:state.caseId,
    caseVersion:state.version};
  if(state.status!=='OPEN'||signal?.aborted)return {...base,status:'LOCAL_FALLBACK',analysis:null,evidenceIds:[],reasonCode:'ABORTED'};
  const active=new Set(state.checkpoint.turns.filter(t=>t.status==='ACTIVE').map(t=>t.turnId));
  const candidate=turns.filter(t=>active.has(t.turnId));
  if(!candidate.length)return {...base,status:'NO_ACTIVE_EVIDENCE',analysis:null,evidenceIds:[]};
  const input=validateMetaInput({turns:candidate,actionEvent:state.actionEvent});
  const view=getCaseView(state).assessment;
  const activeState=state.checkpoint.turns.filter(t=>t.status==='ACTIVE');
  const absToInput=new Map(activeState.map((t,i)=>[t.absoluteIndex,i]));
  const canonical={...view,signals:view.signals.map(s=>({...s,turn:s.turn<0?-1:(absToInput.get(s.turn)??-1)}))};
  const trusted=new Set(callerSignalIds(state));
  async function knownSafeFallback(reason:'PROVIDER_FAILED'|'PROVIDER_INVALID'|'ABORTED'){
    const out=await new MockMetaProvider().analyze({input,triage:canonical});
    const evidenceIds=out.analysis.evidenceUtteranceIds.filter(id=>trusted.has(id));
    return {...base,status:'LOCAL_FALLBACK' as const,analysis:{...out.analysis,evidenceUtteranceIds:evidenceIds},evidenceIds,reasonCode:reason};
  }
  // Never allow an unauthorised LIVE provider to receive any transcript bytes/text.
  if(provider.mode!=='MOCK')return knownSafeFallback('PROVIDER_INVALID');
  try{
    const response:MetaAnalysisResponse=await provider.analyze({input,triage:canonical});
    if(signal?.aborted)return knownSafeFallback('ABORTED');
    if(response.analysisMode!=='MOCK'||response.model==='muse-spark-1.3'&&provider.mode!=='MOCK')return knownSafeFallback('PROVIDER_INVALID');
    const model=validateModelOutput(response.analysis,input.turns);
    const allowed=new Set(input.turns.map(t=>t.turnId));
    if(model.evidenceUtteranceIds.some(id=>!trusted.has(id)||!allowed.has(id)))return knownSafeFallback('PROVIDER_INVALID');
    // AI may propose interpretation, but MUST NOT supersede canonical score/emergency.
    if(model.riskIndex!==canonical.riskIndex||model.manipulationIndex!==canonical.psychologicalPressureIndex||
       model.riskLevel!==canonical.riskBand||model.emergencyFlag!==canonical.emergencyFlag)
      return knownSafeFallback('PROVIDER_INVALID');
    return {...base,status:'MOCK_VALIDATED',analysis:model,evidenceIds:model.evidenceUtteranceIds};
  }catch{return knownSafeFallback(signal?.aborted?'ABORTED':'PROVIDER_FAILED');}
}
