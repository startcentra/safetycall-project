/**
 * Privacy-minimized, read-only HUD data. Never expose transcripts, personal context,
 * model-generated raw output, banking records, tokens, or actionable URLs to glasses.
 * Risk index is an experimental rules index, NOT a probability of fraud.
 */
const short = (value, limit=135) => typeof value==='string' ? value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,limit) : '';

const CUE_LABELS = Object.freeze({
  AUTHORITY_CLAIM:'기관 사칭 단서',
  MONEY_REQUEST:'긴급 송금 요구',
  SECRECY:'비밀 유지 요구',
  URGENCY:'즉시 처리 압박',
  CREDENTIAL_REQUEST:'인증정보 요구',
  DIRECT_THREAT:'위해 협박 단서',
  REMOTE_CONTROL:'원격 제어 요구',
  REALITY_UNDERMINING:'사실 왜곡 단서',
  POST_TRANSFER:'송금 이후 언급',
});
const CUE_PRIORITY = Object.freeze(Object.keys(CUE_LABELS));

function cueLabels(codes) {
  if (!Array.isArray(codes)) return [];
  const present = new Set(codes.filter(code => typeof code === 'string' && Object.hasOwn(CUE_LABELS, code)));
  const labels = [];
  for (const code of CUE_PRIORITY) {
    if (!present.has(code)) continue;
    labels.push(CUE_LABELS[code]);
    if (labels.length >= 3) break;
  }
  return labels;
}

function projectMeta(meta) {
  if (meta?.review?.provider==='LOCAL_CONTRACT_SIMULATOR') return {metaStatus:'NOT_LIVE', metaDisplay:'LOCAL_CONTRACT_SIMULATOR'};
  const accepted = meta?.review?.accepted!==false && Array.isArray(meta?.review?.evidenceTurnIds) && meta.review.evidenceTurnIds.length>0 &&
    ['HIGH','CAUTION','LOW'].includes(meta?.review?.riskLevel);
  // A spent budget still shows the last accepted judgment. It does not invent a new one.
  const verified = accepted && (meta?.status==='LIVE_VERIFIED' || meta?.status==='BUDGET_EXHAUSTED' || meta?.status==='PROCESS_BUDGET_EXHAUSTED');
  if (verified) return {metaStatus:'LIVE_RESPONSE_VALIDATED', metaDisplay:'META_LIVE_VERIFIED'};
  if (meta?.status==='PENDING' || meta?.status==='WAITING_LATEST') return {metaStatus:'PENDING', metaDisplay:'META_ANALYSIS_PENDING'};
  if (['ERROR','INPUT_REJECTED','BUDGET_EXHAUSTED','PROCESS_BUDGET_EXHAUSTED'].includes(meta?.status)) {
    return {metaStatus:'NOT_LIVE', metaDisplay:'META_UNAVAILABLE'};
  }
  return {metaStatus:'NOT_LIVE', metaDisplay:'OFFLINE_SCRIPTED_MOCK'};
}

export function projectGlassesState(state) {
  const ruleBand = ['LOW','CAUTION','HIGH'].includes(state?.risk?.band) ? state.risk.band : 'LOW';
  const meta = state?.metaReview;
  const metaView = projectMeta(meta);
  const metaVerified = metaView.metaStatus==='LIVE_RESPONSE_VALIDATED';
  const metaBand = metaVerified && ['HIGH','CAUTION'].includes(meta?.review?.riskLevel) ? meta.review.riskLevel : 'LOW';
  const textBand = state?.textAdvisory?.level==='PROTECT' ? 'CAUTION' :
    state?.textAdvisory?.level==='VERIFY' ? 'CAUTION' : 'LOW';
  // HUD severity is an advisory gate, never a claim of crime confirmation.
  const severity = state?.endedAt ? 'CLOSED' : state?.risk?.emergency ? 'HIGH' :
    ruleBand==='HIGH'||metaBand==='HIGH' ? 'HIGH' :
    ruleBand==='CAUTION'||metaBand==='CAUTION'||textBand==='CAUTION' ? 'CAUTION' : 'LOW';
  const stopped = state?.actions?.some(a => a.kind==='STOP_TRANSFER') ?? false;
  const held = state?.safeBank?.status==='HELD';
  let headline='SAFETYED 보호 대기';
  let guidance='위험 단서가 확인되면 이곳에 짧게 안내합니다.';
  if (severity==='CLOSED') {
    headline='통화 종료';
    guidance='이후 안내는 휴대폰 SAFETYED에서 이어집니다.';
  } else if (severity==='HIGH') {
    headline='송금 전 잠시 멈추세요';
    guidance='상대가 알려준 연락처가 아닌 공식 채널에서 직접 확인하세요.';
  } else if (severity==='CAUTION') {
    headline='확인이 필요합니다';
    guidance='급한 요구라도 송금·인증번호 공유 전 직접 확인하세요.';
  } else if ((state?.step??0)>0||state?.media?.actualStt) {
    headline='통화를 듣고 있습니다';
    guidance='아직 강한 위험 신호는 없습니다.';
  }
  if (state?.protectionGate?.blocked && severity!=='CLOSED') {
    headline='송금을 막았습니다';
    guidance='은행 근처에서 송금 요구가 겹쳤습니다. 끊고 공식 번호로 확인하세요.';
  } else if (held && severity!=='CLOSED') {
    headline='송금 보류';
    guidance='이 송금은 보류된 상태입니다. 은행 앱에서 다시 확인하세요.';
  } else if (stopped && severity!=='CLOSED') {
    headline='송금 보류 선택됨';
    guidance='송금은 보류됐습니다. 은행 공식 번호로 확인하세요.';
  }
  return Object.freeze({
    demoOnly:true, displayType:'META_RAY_BAN_DISPLAY_WEB_PREVIEW', readOnly:true,
    deviceVerified:false, simulatorVerified:false,
    runId:short(state?.runId,64), version:Number.isSafeInteger(state?.version)?state.version:0,
    step:Number.isSafeInteger(state?.step)?state.step:0,
    severity, riskBand:ruleBand,
    // Intentionally omit numerical score: prevents presenting a heuristic as an AI probability.
    headline, guidance, cues:cueLabels(state?.hudSignalCodes),
    bankHeldDemo:held, simulatedLocationGuard:!!state?.protectionGate?.blocked, ended:!!state?.endedAt,
    metaStatus:metaView.metaStatus,
    metaDisplay:metaView.metaDisplay,
    modelAssessment:metaBand==='HIGH'?'HIGH':metaBand==='CAUTION'?'CAUTION':'NONE',
    provenance:metaVerified?'META_REVIEW_AND_RULES_SEPARATE':'LOCAL_RULES_OR_FIXTURES',
    source:'SIMULATED_CALL_AND_BANK_ONLY',
    disclaimer:'DEMO ONLY · 실제 통화·결제 차단 아님'
  });
}
