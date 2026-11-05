/** SafeCall Care v0.9.1. Deterministic presentation/coaching policy, NOT a detector.
 * Inputs are case-versioned canonical guidance and unverified user check-ins.
 * Official sources are maintained as a strict allowlist; no AI/URL generation.
 */
import {sourceById} from '../../src/modules/playbook/sources.ts';

const RULES=Object.freeze({
 KR:Object.freeze({
  EMERGENCY:{id:'KR_EMERGENCY',text:'신체 위해가 임박한 것으로 의심된다면 안전을 먼저 확보하고 현지 긴급기관에 직접 연락하세요. 가족 응답을 기다리며 도움 요청을 늦추지 마세요.',sources:['KR_POLICE_VOICE_2025']},
  PAYMENT_HOLD:{id:'KR_PAYMENT_HOLD',text:'송금하거나 인증번호를 공유하기 전에 행동을 보류하세요. 상대가 알려준 번호가 아닌 금융회사 공식 앱이나 평소 알고 있던 번호로 독립 확인하세요.',sources:['KR_FSC_2026']},
  PAID:{id:'KR_PAYMENT_REPORT',text:'이미 금전을 보냈다고 생각한다면 추가 송금을 멈추고 해당 금융회사의 직접 확인한 연락처나 경찰(112)로 신속히 연락해 지급정지 가능 여부를 문의하세요. 실제 지급정지는 실행되지 않았습니다.',sources:['KR_FSC_2026','KR_POLICE_RECOVERY']},
  CREDENTIALS:{id:'KR_CREDENTIALS',text:'인증번호·비밀번호를 제공하지 마세요. 이미 제공했다면 신뢰할 수 있는 기기에서 해당 서비스의 공식 경로를 통해 계정 보호 조치를 확인하세요.',sources:['KR_FSC_2026']},
  SCREEN_UNSAFE:{id:'KR_SCREEN_UNSAFE',text:'이 화면을 다른 사람이 볼 수 있거나 기기 통제가 의심되면 이 기기에 비밀번호·인증번호를 입력하지 마세요. 안전하게 이용할 수 있는 다른 기기나 독립된 연락 경로에서 공식 지원을 확인하세요. 이 화면을 계속 조작할 필요는 없습니다.',sources:['KR_KISA_SMISHING']},
  REMOTE_GRANTED:{id:'KR_REMOTE_GRANTED',text:'원격 접근을 이미 허용했을 가능성이 있다면 의심 기기로 금융·인증 업무를 하지 마세요. 신뢰할 수 있는 다른 기기에서 공식 지원 경로를 확인하고 계정·금융 피해 여부에 따라 후속 조치를 검토하세요.',sources:['KR_KISA_SMISHING','KR_FSC_2026']},
  HELP_VERIFY:{id:'KR_FAMILY_HELP_UNVERIFIED',text:'가상 가족이 도움을 요청했습니다. 실제 신원·위해 여부는 확인되지 않았습니다. 기존에 알고 있던 독립적인 경로로 안전을 확인하고, 임박한 신체 위해가 의심되면 현지 긴급기관에 직접 연락하세요.',sources:['KR_POLICE_VOICE_2025']},
  REMOTE:{id:'KR_REMOTE',text:'원격제어 앱 설치와 화면 공유를 보류하세요. 이미 접근을 허용했다면 의심 기기로 금융 업무를 하지 말고 다른 안전한 기기에서 공식 지원 경로를 확인하세요.',sources:['KR_KISA_SMISHING','KR_FSC_2026']},
  IDENTITY:{id:'KR_IDENTITY',text:'추가 개인정보 제공을 중단하고 공식 금융회사·금융감독원 안내에 따라 개인정보 노출에 따른 보호 조치를 검토하세요.',sources:['KR_FSC_2026']},
  VERIFY:{id:'KR_VERIFY',text:'가족 또는 기관의 주장은 아직 확인되지 않았습니다. 평소 알고 있던 가족 연락처나 공식 앱 등 독립적인 경로로 확인하세요.',sources:['KR_POLICE_VOICE_2025']},
  OBSERVE:{id:'KR_OBSERVE',text:'지금은 위험을 단정하지 않습니다. 사기라고 판단할 근거가 충분하지 않으며, 돈·인증정보·앱 설치 요구가 생기면 보류하고 별도 경로로 확인하세요.',sources:[]},
 }),
 US:Object.freeze({
  EMERGENCY:{id:'US_EMERGENCY',text:'If immediate physical danger is possible, get somewhere safe and contact local emergency services directly. Do not delay urgent help while waiting for a family reply.',sources:['FBI_VIRTUAL_KIDNAPPING']},
  PAYMENT_HOLD:{id:'US_PAYMENT_HOLD',text:'Pause the requested payment. Verify the person or institution using a number or official channel you independently know, not one given by the caller.',sources:['FTC_SCAM_SIGNS_2025']},
  PAID:{id:'US_PAYMENT_REPORT',text:'If you believe you paid a scammer, contact your bank or payment provider immediately using its official channel and ask about stopping or reversing the transaction. Recovery is not guaranteed.',sources:['FTC_AFTER_SCAM']},
  CREDENTIALS:{id:'US_CREDENTIALS',text:'Do not share passwords or one-time codes. If you already did, use a trusted device and the real service’s official account-recovery channel.',sources:['FTC_AFTER_SCAM']},
  SCREEN_UNSAFE:{id:'US_SCREEN_UNSAFE',text:'If someone may be observing or controlling this screen, do not enter passwords or codes here. Use a different trusted device or independent contact method for official help. You do not need to keep interacting with this screen.',sources:['FTC_AFTER_SCAM']},
  REMOTE_GRANTED:{id:'US_REMOTE_GRANTED',text:'If you may have granted remote access, avoid sensitive account activity on that device. From a different trusted device, contact official support and review appropriate account and payment protection steps.',sources:['FTC_AFTER_SCAM']},
  HELP_VERIFY:{id:'US_FAMILY_HELP_UNVERIFIED',text:'A mock family member requested help. Identity and actual danger are unverified. Check through a previously trusted independent method; if immediate physical danger is possible, contact local emergency services directly.',sources:['FTC_FAMILY_AI_2023']},
  REMOTE:{id:'US_REMOTE',text:'Do not install remote-access software or start screen sharing at a caller’s request. If access was granted, use a different trusted device to contact official technical support.',sources:['FTC_AFTER_SCAM']},
  IDENTITY:{id:'US_IDENTITY',text:'Stop sharing personal information. If identity theft is suspected, review the official recovery steps at IdentityTheft.gov.',sources:['FTC_IDENTITY_STEPS']},
  VERIFY:{id:'US_VERIFY',text:'A claim about a relative or institution is not verified. Reach them through a previously known independent contact method.',sources:['FTC_FAMILY_AI_2023']},
  OBSERVE:{id:'US_OBSERVE',text:'There is not enough evidence to call this a scam. If a consequential request appears, pause and verify it independently.',sources:[]},
 }),
 UNKNOWN:Object.freeze({
  EMERGENCY:{id:'UNKNOWN_EMERGENCY',text:'신체 위해가 임박한 것으로 보이면 안전한 장소에서 현재 위치의 긴급기관에 직접 연락하세요. 국가·번호는 추정하지 않습니다. / Seek local emergency help if immediate danger is possible; no number is assumed.',sources:[]},
  PAYMENT_HOLD:{id:'UNKNOWN_PAYMENT_HOLD',text:'송금은 보류하고 기존 공식 경로로 확인하세요. / Pause payment and independently verify.',sources:[]},
  PAID:{id:'UNKNOWN_PAID',text:'이미 송금했다면 해당 결제 수단의 공식 제공사에 신속히 연락해 취소 가능성을 문의하세요. / Contact the payment provider immediately; reversal is not guaranteed.',sources:[]},
  CREDENTIALS:{id:'UNKNOWN_CREDENTIALS',text:'인증정보 공유를 중단하고 신뢰할 수 있는 기기의 공식 계정 보호 경로를 확인하세요. / Stop sharing credentials; use trusted account recovery.',sources:[]},
  SCREEN_UNSAFE:{id:'UNKNOWN_SCREEN_UNSAFE',text:'화면이 감시될 수 있다면 민감정보를 입력하지 말고 다른 신뢰 가능한 기기·연락 경로를 이용하세요. / Do not enter secrets on an unsafe screen; use a trusted device.',sources:[]},
  REMOTE_GRANTED:{id:'UNKNOWN_REMOTE_GRANTED',text:'원격 접근을 이미 허용했다면 의심 기기에서 금융·인증 업무를 피하세요. / If access was granted, avoid sensitive actions on the affected device.',sources:[]},
  HELP_VERIFY:{id:'UNKNOWN_FAMILY_HELP_UNVERIFIED',text:'가상 가족 도움 요청은 미인증 정보입니다. 독립적으로 확인하고 임박한 신체 위해가 의심되면 현지 긴급기관에 연락하세요. / Independently verify the unverified help request; seek local emergency help if needed.',sources:[]},
  REMOTE:{id:'UNKNOWN_REMOTE',text:'원격 접근을 허용하지 마세요. 의심 기기를 통한 금융·인증 업무는 피하세요. / Pause remote access; use a trusted device.',sources:[]},
  IDENTITY:{id:'UNKNOWN_IDENTITY',text:'개인정보 공유를 멈추고 관련 공식 서비스의 보호 절차를 확인하세요. / Stop sharing personal data and check official support.',sources:[]},
  VERIFY:{id:'UNKNOWN_VERIFY',text:'상대의 신원을 기존에 알고 있던 연락 경로로 독립 확인하세요. / Independently verify through a known contact.',sources:[]},
  OBSERVE:{id:'UNKNOWN_OBSERVE',text:'사기를 단정할 근거가 없습니다. 중요한 행동 전에는 사실 확인부터 하세요. / Evidence is insufficient; verify before consequential actions.',sources:[]},
 }),
});
const VALID_COUNTRIES=new Set(['KR','US','UNKNOWN']);
const INERT_NOTICES={KR:'국가: 한국(시나리오 또는 사용자 선택, 위치·신원 미인증)',US:'Jurisdiction: US (scenario or user choice; not verified location or identity)',UNKNOWN:'국가/위치 미확인 · 특정 기관·번호 안내 없음'};
/** @param {object} args - Never accepts a model-generated country or action URL. */
export function selectActionCoaching({caseState,guidance,jurisdiction='UNKNOWN',emergency=false,endedAt=null,earlyEvidence=null,concern=null,actions=[],recoveryPath=null,activeCare=null,verification=null,enableSafetyBranches=false}){
 const country=VALID_COUNTRIES.has(jurisdiction)?jurisdiction:'UNKNOWN';
 const policy=RULES[country];
 const actionId=guidance?.primary?.id??'UNCERTAIN_NO_HARD_WARNING';
 const signals=caseState?.status==='OPEN'?caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&!t.instructionalContext).flatMap(t=>t.signals.map(s=>s.code)):[];
 const reportedPayment=caseState?.status==='OPEN'&&caseState.checkpoint.turns.some(t=>t.status==='ACTIVE'&&t.speaker==='user'&&t.signals.some(s=>s.code==='POST_TRANSFER'));
 // 'SIMULATED_TRANSFER' / 'TRANSFER_PREPARED' do not prove payment.
 const hasRecoveryRequest=actions.some(a=>a.kind==='RECOVERY_OPEN');
 const active=activeCare?.source==='USER_SELF_REPORT_UNVERIFIED'?activeCare:null;
 const request=active?.requestType,completed=active?.actionStatus==='DONE'||active?.actionStatus==='PARTLY_DONE';
 let kind='OBSERVE';
 if(emergency)kind='EMERGENCY';
 else if(endedAt)kind=recoveryPath==='PAYMENT'?'PAID':recoveryPath==='CREDENTIALS'?'CREDENTIALS':recoveryPath==='REMOTE_ACCESS'?'REMOTE':recoveryPath==='IDENTITY'?'IDENTITY':'OBSERVE';
 else if(enableSafetyBranches&&active?.screenUnsafe)kind='SCREEN_UNSAFE';
 else if(enableSafetyBranches&&verification?.status==='HELP_REQUESTED')kind='HELP_VERIFY';
 else if(hasRecoveryRequest){
  kind=recoveryPath==='PAYMENT'?'PAID':recoveryPath==='CREDENTIALS'?'CREDENTIALS':recoveryPath==='REMOTE_ACCESS'?'REMOTE':recoveryPath==='IDENTITY'?'IDENTITY':'OBSERVE';
 }else if(reportedPayment||actionId==='POST_PAYMENT_RECOVERY')kind='PAID';
 else if(completed&&request==='PAYMENT')kind='PAID';
 else if(completed&&request==='CREDENTIALS')kind='CREDENTIALS';
 else if(enableSafetyBranches&&request==='REMOTE'&&completed)kind='REMOTE_GRANTED';
 else if(request==='REMOTE'||active?.screenUnsafe)kind='REMOTE';
 else if(actionId==='DO_NOT_DISCLOSE_PERSONAL_DATA')kind='CREDENTIALS';
 else if(signals.includes('REMOTE_CONTROL')||earlyEvidence?.code==='REMOTE_CONTROL')kind='REMOTE';
 else if(actionId==='DO_NOT_TRANSFER'||(signals.includes('MONEY_REQUEST')&&actionId!=='UNCERTAIN_NO_HARD_WARNING'))kind='PAYMENT_HOLD';
 else if(['FAMILY_INDEPENDENT_VERIFY','SEEK_SECOND_CONTACT'].includes(actionId)||signals.includes('SECRECY')||earlyEvidence?.code==='SECRECY'||earlyEvidence?.code==='AUTHORITY_CLAIM'||concern?.type==='FAMILY_CONCERN')kind='VERIFY';
 else if(concern?.type==='PAYMENT_OR_CODE')kind='PAYMENT_HOLD';
 if(kind==='OBSERVE'&&request==='PAYMENT')kind='PAYMENT_HOLD';
 if(kind==='OBSERVE'&&request==='CREDENTIALS')kind='CREDENTIALS';
 if(kind==='OBSERVE'&&request==='FAMILY')kind='VERIFY';
 // Authority claim alone does not trigger an alarm or force active verification.
 const choice=policy[kind];
 const sourceIds=choice.sources.filter(id=>{const s=sourceById(id);return !!s&&s.status==='PUBLIC_SOURCE_CHECKED'&&s.jurisdiction===country;});
 return Object.freeze({caseId:caseState?.caseId??guidance?.caseId??null,caseVersion:caseState?.version??guidance?.stateVersion??null,
  jurisdiction:country,jurisdictionNotice:INERT_NOTICES[country],actionId:choice.id,kind,
  primaryInstruction:choice.text,sourceIds,sourceLinks:sourceIds.map(id=>{const s=sourceById(id);return {id,label:`${s.organization} · ${s.title}`,url:s.url};}),
  evidenceUtteranceIds:[...new Set([...(guidance?.primary?.evidenceUtteranceIds??[]),...(earlyEvidence?.utteranceIds??[])])],
  basis:kind==='EMERGENCY'?'긴급 위험 기존 사건 상태':kind==='HELP_VERIFY'?'미인증 가상 가족 도움 요청 · 실제 위해 확정 아님':kind==='SCREEN_UNSAFE'?'사용자 화면 비안전 자기 보고 · 실제 감염·감시 확정 아님':kind==='OBSERVE'?'관찰된 행동 위험 불충분':
   active?.requestType||active?.screenUnsafe?'사용자 질문 답변 또는 화면 안전 자기 보고 · 미검증 · 위험 점수 미반영':
   concern&&!signals.length?'사용자 직접 선택 · 미확인':`기존 사건 근거 및 코칭 카드: ${actionId}`,
  uncertaintyNotice:'사용자 주장과 가족 자가 보고는 신원·실제 피해를 확인하지 않습니다. 가상 시연이며 외부 조치를 수행하지 않습니다.',
  policyVersion:'KR-US-COACH-V093-1',identityVerified:false,externalActionAuthorized:false,realWorldOutcomeVerified:false});
}
