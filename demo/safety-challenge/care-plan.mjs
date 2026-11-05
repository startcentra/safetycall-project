/**
 * SafeCall Care v0.9 — display-only, deterministic post-analysis policy.
 * No calls, identity checks, money movement, inference of verified family safety or additional detector.
 * The deterministic playbook stays authoritative; user check-ins are unverified self-reports.
 */
import {cardById} from '../../src/modules/playbook/cards.ts';

export const CARE_CONCERNS=Object.freeze({
  FAMILY_CONCERN:'가족 위급 상황이 걱정됨',
  PAYMENT_OR_CODE:'돈이나 인증정보 요구가 걱정됨',
  UNSURE:'수상하지만 상황을 정확히 모르겠음',
});

const VERIFY_NOTICES=Object.freeze({
  REQUESTED:'가상 확인 요청을 보냈습니다. 응답 전까지 안전 여부는 미확인입니다.',
  SELF_REPORTED_SAFE:'가상 가족이 안전하다고 자가 보고했습니다. 상대방의 신원이나 실제 안전이 인증된 것은 아닙니다. 기존에 알던 연락처로 별도 확인하세요.',
  HELP_REQUESTED:'가상 가족이 도움을 요청했습니다. 실제 신원과 안전은 미확인입니다. 신체 위해가 우려되면 확인 응답을 기다리지 말고 현지 긴급기관에 직접 연락하세요.',
  UNABLE_TO_CONFIRM:'가상 가족이 안전 여부를 확인할 수 없다고 답했습니다. 안전 또는 납치의 증거가 아닙니다. 별도의 안전한 경로로 확인하세요.',
  EXPIRED:'가상 확인 요청이 만료됐습니다. 미응답은 안전 또는 납치의 증거가 아닙니다. 별도의 안전한 경로로 확인하세요.',
});

/** Low-regret observational hint from *existing* canonical checkpoint signals, never
 * a second scorer, fraud verdict, model result or privileged user action.
 * A plain claim to be from an authority is insufficient for a hard warning.
 */
export function deriveEarlyCareEvidence(caseState){
  const observed=caseState.status==='OPEN'?caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&!t.instructionalContext):[];
  for(const code of ['REMOTE_CONTROL','SECRECY','AUTHORITY_CLAIM']){
    // An isolated institution name is too weak to trigger unsolicited coaching.
    const matched=observed.filter(t=>t.signals.some(sig=>sig.code===code)&&
      (code!=='AUTHORITY_CLAIM'||t.signals.some(sig=>sig.code==='URGENCY'||sig.code==='SECRECY')));
    if(matched.length)return {code,utteranceIds:matched.map(t=>t.turnId)};
  }
  return null;
}
/** @returns {object|null} Guidance and direct check-ins are absent in the generic warning control arm. */
export function deriveCarePlan({mode,guidance,risk,verification=null,concern=null,actions=[],endedAt=null,earlyEvidence=null,careIntegrityEnabled=false}){
  if(mode==='warning'||!guidance)return null;
  const verificationStatus=verification?.status??null;
  const verificationNotice=VERIFY_NOTICES[verificationStatus]??null;
  // Re-display the already-observed emergency warning after closure, without reopening
  // or re-running case events. Closed-case guidance itself remains CLOSED/fallback.
  const emergency=risk.emergency===true;
  const emergencyCard=emergency?cardById('EMERGENCY_CONTACT_GUIDANCE'):null;
  const aftercare=actions.some(a=>a.kind==='RECOVERY_OPEN');
  const stopped=actions.some(a=>a.kind==='STOP_TRANSFER');
  const evidenceBased=guidance.status==='ACTIVE'&&guidance.primary?.id!=='UNCERTAIN_NO_HARD_WARNING';
  let phase='OBSERVE';
  let phaseLabel='상황 관찰';
  let primary=guidance.primary.userAction;
  let secondary=guidance.secondary?.userAction??'상대방의 말만으로 범죄나 가족의 안전을 확정하지 않습니다.';
  let basis=evidenceBased?'활성 발화 근거와 팀 검토 교범 기반':'위험 확정 근거 부족';

  // Invariants: danger and recovery cannot be hidden by safe self-report, check-in or an absence of response.
  if(emergency){
    phase='EMERGENCY';phaseLabel='신체 위해 가능성 · 긴급 안내 우선';
    primary=guidance.primary?.id==='EMERGENCY_CONTACT_GUIDANCE'?guidance.primary.userAction:(emergencyCard?.userAction??guidance.primary.userAction);
    secondary='가족의 응답이 있더라도 실제 신체 위해 가능성이 배제되지 않습니다. 긴급 도움 안내를 가리지 않습니다.';
  }else if(endedAt){
    phase='CLOSED';phaseLabel='사건 종료 · 새로운 자동 판단 없음';
    primary='가상 사건이 종료되었습니다. 실제 상황이라면 안전한 공식 연락 경로로 확인하거나 필요한 사후 조치를 진행하세요.';
    secondary='종료된 사건은 새 입력에 따라 갱신되지 않습니다.';
  }else if(careIntegrityEnabled&&verificationStatus==='HELP_REQUESTED'){
    phase='FAMILY_HELP_UNVERIFIED';phaseLabel='가상 가족 도움 요청 · 미확인';
    primary='가상 가족의 도움 요청은 실제 신원이나 신체 위해의 증명이 아닙니다. 기존에 알고 있던 독립적인 연락 경로로 확인하고, 임박한 위해가 의심되면 현지 긴급기관에 직접 연락하세요.';
    secondary='안전하다고 단정하지 않되, 이 응답만으로 납치나 범죄를 확정하지 않습니다.';
    basis='가상 가족의 미인증 도움 요청 · 위험 엔진 점수 미반영';
  }else if(aftercare){
    phase='AFTERCARE';phaseLabel='피해 이후 케어 · 가상 안내';
    primary='실제 피해가 있었다면 즉시 해당 금융회사에 직접 연락하고, 현지 공식 신고 및 추가 피해 방지 절차를 확인하세요.';
    secondary='여기서 송금이나 개인정보 노출이 실제로 발생한 것은 아닙니다. 아래 사후관리 카드에서 해당되는 단계만 살펴보세요.';
    basis='사용자가 사후관리 안내를 직접 선택함 · 실제 피해 주장 아님';
  }else if(evidenceBased){
    if(guidance.primary.id==='FAMILY_INDEPENDENT_VERIFY'||guidance.primary.id==='SEEK_SECOND_CONTACT'){
      phase='VERIFY';phaseLabel='독립 확인 안내';
    }else{
      phase='PREVENT';phaseLabel='위험 행동 보류 안내';
    }
    if(stopped){
      secondary='송금 보류를 선택했습니다. 다음에는 상대방이 알려준 번호가 아닌 기존에 알고 있던 안전한 경로로 확인하세요.';
    }
  }else if(earlyEvidence){
    phase='EARLY_OBSERVATION';phaseLabel='관찰된 신호 · 저강도 예방 안내';
    basis=`기존 위험 엔진의 ${earlyEvidence.code} 신호 · 사기 확정 아님`;
    if(earlyEvidence.code==='REMOTE_CONTROL'){
      primary='원격제어 앱 설치나 화면 공유를 시작하지 말고, 기존에 알고 있던 공식 연락 경로에서 요청의 진위를 확인하세요.';
      secondary='기기 접근 요구가 관찰됐지만 이를 근거로 범죄를 확정하지는 않습니다. 이미 접근을 허용했다면 사후관리의 원격제어 유형을 확인하세요.';
    }else if(earlyEvidence.code==='SECRECY'){
      primary='다른 사람에게 알리지 말라는 요청이 있었습니다. 중요한 결정을 하기 전에 신뢰하는 사람 또는 기존 공식 경로로 별도 확인하세요.';
      secondary='비밀 유지 요청만으로 사기나 실제 위험을 확정하지 않으며, 긴급한 신체 위해 가능성은 별도로 대응합니다.';
    }else{
      primary='기관이라고 주장하는 통화라면, 돈이나 인증번호를 제공하기 전에 공식 앱·기존 연락처로 직접 확인하세요.';
      secondary='직책이나 기관 언급만으로 사기를 판단하지 않습니다. 먼저 통화를 안전하게 마칠 수 있는지 고려하세요.';
    }
  }else if(concern){
    phase='EARLY_CARE';phaseLabel='통화 접근 없이 시작한 사전 케어';
    basis='사용자 직접 선택(미확인 자기 보고) · 위험 엔진 점수에 반영하지 않음';
    if(concern.type==='FAMILY_CONCERN'){
      primary='가족이 위험하다는 주장을 들었다면 사실로 확정하지 말고, 평소 알고 있던 별도의 연락처로 확인하세요.';
      secondary='신체 위해가 임박했다고 느껴지면 가족의 응답을 기다리며 긴급기관 연락을 늦추지 마세요.';
    }else if(concern.type==='PAYMENT_OR_CODE'){
      primary='송금하거나 인증번호를 공유하기 전에 행동을 보류하고, 기존에 알고 있던 공식 연락 경로로 요청을 확인하세요.';
      secondary='사용자 선택만으로 사기 여부는 확정하지 않으며 실제 결제나 계좌 차단을 실행하지 않습니다.';
    }else{
      primary='지금은 위험을 단정하지 않습니다. 중요한 금전·인증 결정을 앞두었다면 잠시 보류하고 별도 경로로 확인하세요.';
      secondary='필요한 경우 다음 가상 발화를 확인하거나 가족 확인 요청을 직접 선택할 수 있습니다.';
    }
  }
  // Keep every status as separate evidence of a mock workflow, NEVER an identity or safety verdict.
  const nextStep=emergency?'안전한 곳에서 현지 긴급기관에 직접 연락하는 방안을 우선 검토하세요.':
    verificationStatus==='HELP_REQUESTED'?'가상 응답을 실제 확인으로 해석하지 말고, 신체 위해가 우려되면 현지 긴급기관에 직접 연락하세요.':
    verificationStatus==='EXPIRED'||verificationStatus==='UNABLE_TO_CONFIRM'?'응답 여부로 안전을 판단하지 말고 별도의 안전한 연락 경로를 확인하세요.':
    verificationStatus==='SELF_REPORTED_SAFE'?'안전 자가 보고는 신원 인증이 아닙니다. 기존 번호로 독립 확인하세요.':
    verificationStatus==='REQUESTED'?'응답 중에도 고위험 행동을 보류하고, 긴급상황은 지연하지 마세요.':
    phase==='EARLY_CARE'||phase==='EARLY_OBSERVATION'?'위험을 단정하지 않고 안전한 사실 확인부터 진행하세요.':
    '상황에 적합한 안전한 다음 행동을 선택하세요.';
  return {
    phase,phaseLabel,primary,secondary,basis,nextStep,verificationNotice,
    playbookActionId:emergencyCard?.id??guidance.primary.id,sourceIds:emergencyCard?.sourceIds??guidance.primary.sourceIds,
    evidenceUtteranceIds:guidance.primary.evidenceUtteranceIds,
    earlyCareEvidence:phase==='EARLY_OBSERVATION'?earlyEvidence:null,
    earlyCareNotFraudVerdict:true,emergencyGuidancePreserved:emergency,verificationIsAuthenticated:false,
    realWorldActionAuthorized:false,userReportUnverified:!!concern,
  };
}
