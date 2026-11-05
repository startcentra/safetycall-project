import type {ModelAssessment} from '../analysis/meta-contract.ts';
import type {TriageResult} from '../risk-triage/index.ts';
import {selectDemoCoaching} from './index.ts';
/**
 * Legacy adapter maintained for old tests/callers. Without a CaseState and matching
 * finalized evidence IDs the model's suggested code CANNOT authorize a new action.
 * Current UI uses playbook/selectLiveGuidance for source-based, versioned advice.
 */
export function selectAssistedCoaching(triage:TriageResult, _model:ModelAssessment|null):string {
  void _model;
  const base=selectDemoCoaching({assessment:triage,transferStatus:'NONE',claimStatus:'UNVERIFIED',ended:false});
  if(triage.emergencyFlag)return '폭력·납치 등 즉각적인 위해 가능성이 있다면 AI 결과를 기다리지 말고 112에 신고하세요.';
  if(triage.signals.some(s=>s.code==='MONEY_REQUEST'))return '지금 송금하지 마세요. 가족이나 금융기관에 공식 경로로 직접 확인하세요.';
  if(triage.signals.some(s=>s.code==='CREDENTIAL_REQUEST'))return '인증번호와 비밀번호를 알려주지 마세요. 공식 경로로 확인하세요.';
  return base;
}
