/** SafeCall bank-arrival protection (DEMO only): no GPS polling, no money or banking API. */
export type Jurisdiction='KR'|'US';
export type ArrivalEvidence='NONE'|'NEARBY_GPS'|'USER_CONFIRMED'|'DEMO_CHECKIN';
export type ProtectionState='INACTIVE'|'VERIFY_ARRIVAL'|'BANK_ASSIST'|'URGENT_HELP'|'EXPIRED';
export type BankTool='NONE'|'REQUEST_CONFIRMATION'|'SHOW_BANK_STAFF_SCRIPT'|'SHOW_EMERGENCY_GUIDANCE';
export type BankArrivalContext={
 caseId:string;stateVersion:number;caseOpen:boolean;riskIndex:number;detected:boolean;
 activeEvidenceIds:readonly string[];evidenceVersion:number;country:Jurisdiction;
 arrivalEvidence:ArrivalEvidence;arrivalCaseId:string|null;arrivalVersion:number|null;
 locationConsent:boolean;locationTimestampMs:number|null;nowMs:number;bankPlaceVerified:boolean;
 physicalEmergency:boolean;userWantsHelp:boolean;
};
export type BankArrivalDecision={state:ProtectionState;tool:BankTool;reason:string;allowBankSimulation:boolean;autoLockCard:false;autoTransfer:false;locationMayBeStored:false;caseId:string;stateVersion:number};
const reason=(c:BankArrivalContext,state:ProtectionState,tool:BankTool,message:string):BankArrivalDecision=>({
 state,tool,reason:message,allowBankSimulation:state==='BANK_ASSIST',autoLockCard:false,autoTransfer:false,
 locationMayBeStored:false,caseId:c.caseId,stateVersion:c.stateVersion
});
/** No AI score, speech alone, or GPS proximity can trigger a bank/card action. */
export function decideBankArrival(c:BankArrivalContext):BankArrivalDecision{
 if(!c.caseOpen)return reason(c,'INACTIVE','NONE','사건이 종료되었습니다. 은행 보호 모드를 시작하지 않습니다.');
 if(c.physicalEmergency)return reason(c,'URGENT_HELP','SHOW_EMERGENCY_GUIDANCE','즉각적인 위해 가능성: 은행 방문 확인을 기다리지 말고 현지 긴급기관에 연락하세요.');
 if(!c.detected||c.activeEvidenceIds.length===0||c.evidenceVersion!==c.stateVersion)
  return reason(c,'INACTIVE','NONE','현재 사건의 유효한 위험 근거가 없어 보호 모드를 활성화하지 않습니다.');
 if(c.arrivalCaseId!==c.caseId||c.arrivalVersion!==c.stateVersion)
  return reason(c,'VERIFY_ARRIVAL','REQUEST_CONFIRMATION','은행 도착 정보가 현재 사건 버전과 연결되어 있지 않습니다.');
 if(c.arrivalEvidence==='NEARBY_GPS'){
  if(!c.locationConsent||!c.bankPlaceVerified||c.locationTimestampMs===null||!Number.isFinite(c.locationTimestampMs)||c.locationTimestampMs>c.nowMs+5000||c.nowMs-c.locationTimestampMs>120000)
    return reason(c,'EXPIRED','REQUEST_CONFIRMATION','GPS 근처 정보가 불충분하거나 만료되었습니다. 실제 은행 도착으로 간주하지 않습니다.');
  return reason(c,'VERIFY_ARRIVAL','REQUEST_CONFIRMATION','은행 근처입니다. 방문 여부를 직접 확인하세요. GPS만으로 도착을 확정할 수 없습니다.');
 }
 if(c.arrivalEvidence!=='USER_CONFIRMED'&&c.arrivalEvidence!=='DEMO_CHECKIN')
  return reason(c,'VERIFY_ARRIVAL','REQUEST_CONFIRMATION','은행 도착을 사용자가 직접 확인해야 합니다.');
 if(!c.userWantsHelp)return reason(c,'VERIFY_ARRIVAL','REQUEST_CONFIRMATION','은행 직원에게 도움 요청은 사용자 동의가 필요합니다.');
 return reason(c,'BANK_ASSIST','SHOW_BANK_STAFF_SCRIPT',c.country==='KR'?'은행 직원에게 통화 압박 및 송금 요구를 알리고 공식 절차를 문의하세요.':'Tell bank staff about the suspicious call and request help using the bank’s official fraud procedures.');
}
export function maskedStaffScript(country:Jurisdiction):string{
 return country==='KR'?'현재 의심스러운 전화에서 송금을 요구받고 있습니다. 안전한지 확인하고 싶습니다. 은행의 공식 절차로 도와주세요.':
 'I may be receiving a scam call pressuring me to transfer money. Please help me verify the request through your official fraud procedures.';
}
