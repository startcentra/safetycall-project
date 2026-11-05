/**
 * Deterministic care journey reducer and projection.
 * Content lives in guided-playbooks.mjs; all external actions remain mock-only.
 */
import {GUIDE_PATHS, PAYMENT_METHODS, OFFICIAL_GUIDE_SOURCES, validCountry, sourceSet, guidedSteps} from './guided-playbooks.mjs';
export {GUIDE_PATHS, PAYMENT_METHODS, OFFICIAL_GUIDE_SOURCES, guidedSteps} from './guided-playbooks.mjs';

const ID=/^[a-zA-Z0-9_-]{1,80}$/;
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const STEP_RESULTS=new Set(['USER_REPORTED_DONE','UNABLE_TO_COMPLETE','SKIPPED','RESULT_UNKNOWN']);
export function createGuidedJourney(caseId){if(typeof caseId!=='string'||!ID.test(caseId))fail('사건 ID 오류');return {caseId,version:0,paths:[],activePath:null,progress:{},contexts:{},phase:'NOT_STARTED',events:[],reviewedAt:null};}
export function applyGuidedEvent(store,event,{jurisdiction='UNKNOWN',caseClosed=false,emergency=false}={}){
  if(!event||typeof event!=='object'||Array.isArray(event))fail('안내 이벤트 형식 오류');
  if(event.caseId!==store.caseId||typeof event.eventId!=='string'||!ID.test(event.eventId))fail('사건 또는 이벤트 식별자 불일치');
  const allowed=['GUIDED_PATH_ADDED','GUIDED_CONTEXT_SET','GUIDED_STEP_RESULT','GUIDED_PAUSED','GUIDED_RESUMED','GUIDED_CLOSED'];
  if(!allowed.includes(event.type))fail('허용되지 않은 케어 이벤트');
  const normalized={caseId:event.caseId,eventId:event.eventId,type:event.type,pathId:event.pathId??null,stepId:event.stepId??null,result:event.result??null,field:event.field??null,value:event.value??null};
  const fingerprint=JSON.stringify(normalized);
  const existing=store.events.find(x=>x.eventId===event.eventId);
  if(existing){if(existing.fingerprint!==fingerprint)fail('동일 이벤트 ID 변경 시도',409);return store;}
  if(event.expectedGuidedVersion!==store.version)fail('오래된 케어 상태 버전',409);
  if(store.events.length>=100)fail('케어 기록 100건 상한',409);
  if(store.phase==='CLOSED')fail('이미 종료된 케어입니다',409);
  if(store.phase==='PAUSED'&&!['GUIDED_RESUMED','GUIDED_CLOSED'].includes(event.type))fail('일시 중단된 케어는 재개 후 진행하세요',409);
  let next={...store,paths:[...store.paths],progress:{...store.progress},contexts:{...store.contexts}};
  if(event.type==='GUIDED_PATH_ADDED'){
    if(!Object.hasOwn(GUIDE_PATHS,event.pathId)||event.stepId!==undefined||event.field!==undefined||event.result!==undefined)fail('지원하지 않는 케어 유형');
    if(!next.paths.includes(event.pathId)){if(next.paths.length>=6)fail('추가 가능한 케어 유형 한도',409);next.paths.push(event.pathId);}
    next.activePath=event.pathId;next.phase='ACTIVE';
  } else if(event.type==='GUIDED_CONTEXT_SET'){
    if(!['paymentMethod','actionStatus','screenUnsafe'].includes(event.field)||!store.activePath)fail('맥락 변경 불가');
    if(event.field==='paymentMethod'){
      if(!PAYMENT_METHODS[validCountry(jurisdiction)].includes(event.value))fail('국가와 맞지 않는 결제 방식');
    } else if(event.field==='actionStatus'){
      if(!['NOT_DONE','PARTLY_DONE','DONE','UNKNOWN'].includes(event.value))fail('잘못된 행동 상태');
    } else {if(typeof event.value!=='boolean')fail('화면 안전 상태 오류');
      if(event.value===false&&Object.values(store.contexts).some(x=>x.screenUnsafe===true))fail('이미 보고된 화면 비안전 상태는 이 사건에서 자동 해제되지 않습니다',409);}
    next.contexts[store.activePath]={paymentMethod:'UNKNOWN',actionStatus:'UNKNOWN',screenUnsafe:false,...(store.contexts[store.activePath]??{}),[event.field]:event.value};
  } else if(event.type==='GUIDED_STEP_RESULT'){
    if(!store.activePath||event.pathId!==store.activePath||!STEP_RESULTS.has(event.result))fail('단계·결과가 유효하지 않습니다');
    const steps=guidedSteps(event.pathId,jurisdiction,store.contexts[event.pathId]??{});
    if(!steps.some(s=>s.id===event.stepId))fail('선택한 케어에 없는 단계');
    const existingProgress=store.progress[event.pathId]??{};
    const first=steps.find(s=>!['USER_REPORTED_DONE','SKIPPED'].includes(existingProgress[s.id]));
    if(first?.id!==event.stepId)fail('현재 진행 단계가 아닙니다',409);
    if(existingProgress[event.stepId]===event.result)fail('새 정보 없이 같은 상태를 반복할 수 없습니다',409);
    next.progress[event.pathId]={...existingProgress,[event.stepId]:event.result};
  } else if(event.type==='GUIDED_PAUSED'){
    if(store.phase!=='ACTIVE')fail('일시 중단할 케어가 없습니다',409);next.phase='PAUSED';
  } else if(event.type==='GUIDED_RESUMED'){
    if(store.phase!=='PAUSED')fail('재개할 케어가 없습니다',409);next.phase='ACTIVE';
  } else if(event.type==='GUIDED_CLOSED'){
    next.phase='CLOSED';
  }
  const at=new Date().toISOString();next.version++;
  next.events=[...store.events,{...normalized,fingerprint,at,caseClosedAtEvent:caseClosed,emergencyAtEvent:emergency}];
  return next;
}
export function guidedJourneyView(store,{jurisdiction='UNKNOWN',caseClosed=false,emergency=false,screenUnsafe=false,verification=null}={}){
  const country=validCountry(jurisdiction),path=store.activePath;
  const chosen=store.contexts[path]??{paymentMethod:'UNKNOWN',actionStatus:'UNKNOWN',screenUnsafe:false};
  const anyScreenUnsafe=Object.values(store.contexts).some(x=>x.screenUnsafe===true);
  const context={...chosen,paymentMethod:PAYMENT_METHODS[country].includes(chosen.paymentMethod)?chosen.paymentMethod:'UNKNOWN',screenUnsafe:chosen.screenUnsafe||screenUnsafe||anyScreenUnsafe};
  const steps=path?guidedSteps(path,country,context):[];
  const progress=store.progress[path]??{};
  const current=steps.find(s=>!['USER_REPORTED_DONE','SKIPPED'].includes(progress[s.id]));
  const blocker=emergency?'EMERGENCY_PRIORITY':context.screenUnsafe?'SCREEN_UNSAFE':null;
  const report=verification?.status==='HELP_REQUESTED'?'가상 가족이 도움을 요청했습니다. 실제 인증이 아니며 임박한 위해 가능성은 별도 긴급 안내가 우선합니다.':null;
  const sources=(path?sourceSet(country,path):[]).map(id=>({sourceId:id,...OFFICIAL_GUIDE_SOURCES[id]}));
  return {caseId:store.caseId,version:store.version,paths:store.paths,activePath:path,pathLabel:path?GUIDE_PATHS[path]:null,
    availablePaths:Object.entries(GUIDE_PATHS).map(([id,label])=>({id,label})),phase:store.phase,context,
    paymentMethods:PAYMENT_METHODS[country],steps:steps.map(s=>({...s,status:progress[s.id]||'NOT_STARTED'})),
    currentStep:current?{...current,status:progress[current.id]||'NOT_STARTED'}:null,
    blocker,assurance:report,caseClosed,canRecord:store.phase==='ACTIVE'&&!blocker,sourceCountry:country,sources,
    userReportedOnly:true,externalActionPerformed:false,realMoneySent:false,identityVerified:false,
    verifiedExternalCompletion:false,metaCalled:false,
    completionNotice:'이 기록은 사용자가 선택한 진행 상태이며 실제 외부 연락·피해 복구·지급정지·신원 확인을 인증하지 않습니다.',
    events:store.events.slice(-12).map(({eventId,type,pathId,stepId,result,at})=>({eventId,type,pathId,stepId,result,at}))};
}
