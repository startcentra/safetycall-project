/** v0.9.2: opt-in, versioned, bounded care questionnaire. NOT a risk classifier.
 * All responses are unverified user self-reports; no arbitrary user text is stored.
 */
const QUESTIONS=Object.freeze({
 REQUEST_TYPE:Object.freeze({id:'REQUEST_TYPE',promptKey:'care.requestType',choices:Object.freeze(['PAYMENT','CREDENTIALS','REMOTE','FAMILY','NONE','UNSURE'])}),
 ACTION_STATUS:Object.freeze({id:'ACTION_STATUS',promptKey:'care.actionStatus',choices:Object.freeze(['NOT_DONE','PARTLY_DONE','DONE','UNSURE'])}),
});
const EVENTS=new Set(['CARE_QUESTION_PRESENTED','CARE_QUESTION_ANSWERED','CARE_QUESTION_SKIPPED','CARE_QUESTION_DISMISSED','CARE_SCREEN_UNSAFE_REPORTED']);
const QUESTION_LIMIT=4;
const refusal=(decision,reason)=>({decision,reason,question:null});
export function createCareInteraction(caseId){return {caseId,version:0,events:[],answers:{},skipped:[],activeQuestion:null,screenUnsafe:false};}
export function nextCareQuestion({caseState,interaction,emergency=false,earlyEvidence=null,guidance=null,concern=null,actions=[],endedAt=null,remoteStatusFollowup=false}){
 if(endedAt||caseState.status!=='OPEN')return refusal('SKIP_CASE_CLOSED','CLOSED');
 if(emergency)return refusal('SKIP_EMERGENCY','PHYSICAL_DANGER_FIRST');
 if(interaction.screenUnsafe)return refusal('SKIP_UNSAFE','SCREEN_MAY_BE_OBSERVED');
 if(actions.some(a=>a.kind==='RECOVERY_OPEN')||guidance?.primary?.id==='POST_PAYMENT_RECOVERY')return refusal('SKIP_NO_NEED','RECOVERY_FIRST');
 const observed=caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&!t.instructionalContext).flatMap(t=>t.signals.map(s=>s.code));
 if(observed.includes('REMOTE_CONTROL')||earlyEvidence?.code==='REMOTE_CONTROL')return refusal('SKIP_UNSAFE','REMOTE_ACCESS_POSSIBLE');
 if(guidance?.primary?.id!=='UNCERTAIN_NO_HARD_WARNING'&&guidance?.status==='ACTIVE')return refusal('SKIP_NO_NEED','GUIDANCE_ALREADY_AVAILABLE');
 if(concern?.type==='FAMILY_CONCERN')return refusal('SKIP_NO_NEED','INDEPENDENT_CHECK_ALREADY_ADVISED');
 let q;
 if(!Object.hasOwn(interaction.answers,'REQUEST_TYPE'))q=QUESTIONS.REQUEST_TYPE;
 else if((remoteStatusFollowup?['PAYMENT','CREDENTIALS','REMOTE']:['PAYMENT','CREDENTIALS']).includes(interaction.answers.REQUEST_TYPE)&&!Object.hasOwn(interaction.answers,'ACTION_STATUS'))q=QUESTIONS.ACTION_STATUS;
 else return refusal('SKIP_NO_NEED','ENOUGH_TO_COACH');
 if(interaction.skipped.includes(q.id))return refusal('SKIP_NO_NEED','USER_SKIPPED');
 if(interaction.events.filter(e=>e.type==='CARE_QUESTION_PRESENTED').length>=QUESTION_LIMIT)return refusal('SKIP_NO_NEED','QUESTION_BUDGET');
 return {decision:'ASK',reason:'OPTIONAL_SELF_REPORT',question:{...q,caseId:caseState.caseId,caseVersion:caseState.version,
  canSkip:true,sensitiveDataRequired:false,informationSource:'POLICY',evidenceUtteranceIds:[]}};
}
export function careInteractionView({caseState,interaction,...args}){
 const proposed=nextCareQuestion({caseState,interaction,...args});
 const current=interaction.activeQuestion;
 const active=current&&current.caseVersion===caseState.version&&proposed.decision==='ASK'&&proposed.question.id===current.id?
   {...proposed.question,choiceIds:proposed.question.choices}:null;
 return {version:interaction.version,screenUnsafe:interaction.screenUnsafe,answers:{...interaction.answers},
  answerProvenance:'USER_SELF_REPORT_UNVERIFIED',activeQuestion:active,
  questionProposal:active?{decision:'ALREADY_PRESENTED',reason:'AWAITING_USER'}:{decision:proposed.decision,reason:proposed.reason,questionId:proposed.question?.id??null},
  presentedCount:interaction.events.filter(e=>e.type==='CARE_QUESTION_PRESENTED').length,
  storedEvents:interaction.events.map(e=>({eventId:e.eventId,type:e.type,questionId:e.questionId??null})),
  authenticated:false,countsAsAutomaticDetection:false};
}
function error(message){const e=new Error(message);e.status=409;throw e;}
export function applyCareInteractionEvent(state,event,{caseState,decision}){
 if(event.caseId!==state.caseId||caseState.caseId!==state.caseId)error('다른 사건의 질문 요청');
 if(!EVENTS.has(event.type)||typeof event.eventId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(event.eventId))error('허용되지 않은 케어 이벤트');
 const normalized={type:event.type,questionId:event.questionId??null,choiceId:event.choiceId??null,caseVersion:event.caseVersion??null};
 const prior=state.events.find(e=>e.eventId===event.eventId);
 if(prior){
  if(JSON.stringify(prior.payload)!==JSON.stringify(normalized))error('동일 이벤트 ID의 내용이 충돌');
  return state;
 }
 if(state.events.length>=20)error('케어 질문 이벤트 한도 초과');
 if(event.type==='CARE_SCREEN_UNSAFE_REPORTED'&&state.screenUnsafe)error('이미 화면 조작 중단이 기록됐습니다');
 if(event.expectedInteractionVersion!==state.version)error('케어 기록 버전 불일치');
 if(caseState.status!=='OPEN')error('종료 사건에서는 케어 질문 변경 불가');
 if(event.caseVersion!==caseState.version)error('오래된 사건에서 온 질문 이벤트');
 let answers={...state.answers},skipped=[...state.skipped],activeQuestion=state.activeQuestion,screenUnsafe=state.screenUnsafe;
 if(event.type==='CARE_SCREEN_UNSAFE_REPORTED'){
  if(event.questionId!==undefined||event.choiceId!==undefined)error('불필요한 입력');
  screenUnsafe=true;activeQuestion=null;
 }else if(event.type==='CARE_QUESTION_PRESENTED'){
  if(event.choiceId!==undefined||activeQuestion)error('기존 질문을 먼저 처리하세요');
  if(decision.decision!=='ASK'||event.questionId!==decision.question?.id)error('현재 질문 정책에 없는 질문');
  activeQuestion={id:event.questionId,caseVersion:caseState.version};
 }else{
  if(!activeQuestion||activeQuestion.id!==event.questionId||activeQuestion.caseVersion!==caseState.version)error('현재 열려 있는 질문과 일치하지 않음');
  if(event.type==='CARE_QUESTION_ANSWERED'){
   if(!QUESTIONS[event.questionId].choices.includes(event.choiceId))error('허용되지 않은 답변');
   answers[event.questionId]=event.choiceId;
  }else if(event.type==='CARE_QUESTION_SKIPPED'||event.type==='CARE_QUESTION_DISMISSED'){
   if(event.choiceId!==undefined)error('건너뛰기는 답변이 없음');
   skipped.push(event.questionId);
  }
  activeQuestion=null;
 }
 return {...state,version:state.version+1,answers,skipped,activeQuestion,screenUnsafe,
  events:[...state.events,{eventId:event.eventId,type:event.type,questionId:event.questionId??null,payload:normalized}]};
}
export function invalidateCareQuestion(state){
 if(!state.activeQuestion)return state;
 return {...state,activeQuestion:null,version:state.version+1};
}
/** No new fraud score, evidence utterance, verified identity, or claimed external outcome. */
export function deriveActiveCare(interaction){
 const requestType=interaction.answers.REQUEST_TYPE??null;
 const actionStatus=interaction.answers.ACTION_STATUS??null;
 return {requestType,actionStatus,screenUnsafe:interaction.screenUnsafe,source:'USER_SELF_REPORT_UNVERIFIED',
  affectsRiskScore:false,countsAsPassiveDetection:false};
}
