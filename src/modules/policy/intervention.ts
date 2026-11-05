/** Deterministic advisory-only safety route. NEVER authorizes financial operations. */
import type {CaseState} from '../case/index.ts';
import {getCaseView} from '../case/index.ts';
export type AdvisoryRoute='EMERGENCY_FIRST'|'NO_ALERT'|'OFFICIAL_VERIFICATION'|'OTP_PROTECTION'|'TRANSFER_PAUSE'|'DEVICE_PROTECTION'|'CARD_RISK_REPORTED';
export function deriveIntervention(caseState:CaseState,{cardDetailsExposedByUser=false}:{cardDetailsExposedByUser?:boolean}={}):Readonly<{
  route:AdvisoryRoute; canSuggestMockCardLock:boolean;canSuggestMockTransferHold:boolean;
  bankArrivalVerified:boolean;automaticFinancialAction:boolean;automaticMockCardLock:boolean;
}> {
  const assessment=getCaseView(caseState).assessment;
  const codes=new Set(caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller').flatMap(t=>t.signals.map(s=>s.code)));
  let route:AdvisoryRoute='NO_ALERT';
  if(assessment.emergencyFlag)route='EMERGENCY_FIRST';
  else if(cardDetailsExposedByUser)route='CARD_RISK_REPORTED';
  else if(codes.has('CREDENTIAL_REQUEST'))route='OTP_PROTECTION';
  else if(codes.has('MONEY_REQUEST')||caseState.actionEvent==='TRANSFER_PREPARED')route='TRANSFER_PAUSE';
  else if(codes.has('REMOTE_CONTROL'))route='DEVICE_PROTECTION';
  else if(assessment.riskBand!=='LOW')route='OFFICIAL_VERIFICATION';
  return {route,canSuggestMockCardLock:route==='CARD_RISK_REPORTED',
    canSuggestMockTransferHold:route==='TRANSFER_PAUSE',bankArrivalVerified:false,automaticFinancialAction:false,
    automaticMockCardLock:assessment.emergencyFlag};
}
