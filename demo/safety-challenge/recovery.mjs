/** v0.9 deterministic, fictional recovery checklist. No claim of actual victimization,
 * no network integration, no proof that a user-reported step occurred.
 * A recovery revision is separate from the immutable closed Case Coordinator state.
 */
export const RECOVERY_PATHS=Object.freeze({
  PAYMENT:{title:'송금·금전 피해 의심',summary:'실제 송금 여부를 확인하고 추가 송금을 보류합니다.',steps:[
    ['STOP','추가 송금·환급 선입금 요구를 보류하고, 상대가 알려준 번호를 사용하지 않습니다.'],
    ['PROVIDER','공식 앱·카드 뒷면 등 직접 확인한 경로로 금융회사에 피해 신고·회수 가능 여부를 문의합니다.'],
    ['REPORT','해당 국가의 공식 신고 창구를 확인하고, 필요한 자료를 별도로 안전하게 보관합니다.']]},
  CREDENTIALS:{title:'인증정보·비밀번호 노출 의심',summary:'정보 제공을 중단하고 신뢰할 수 있는 기기에서 계정을 보호합니다.',steps:[
    ['STOP','인증번호·비밀번호를 추가로 공유하지 않습니다.'],
    ['SECURE','안전한 기기와 공식 앱에서 비밀번호를 변경하고 사용한 다른 계정도 점검합니다.'],
    ['PROVIDER','계정·금융 서비스의 공식 지원 경로로 무단 접근과 추가 보호 조치를 문의합니다.']]},
  REMOTE_ACCESS:{title:'원격제어·악성 앱 의심',summary:'의심 기기와 다른 안전한 경로를 사용해 조치를 확인합니다.',steps:[
    ['NO_MORE_ACCESS','상대가 요구하는 화면 공유·원격 접근·추가 설치를 중단합니다.'],
    ['SAFE_DEVICE','의심 기기만 믿지 말고 다른 신뢰할 수 있는 기기로 공식 지원 경로를 확인합니다.'],
    ['DEVICE_SUPPORT','공식 보안·제조사 지원을 통해 앱 검사·제거 및 계정 보호 필요성을 확인합니다.']]},
  IDENTITY:{title:'개인정보·신분정보 노출 의심',summary:'노출 범위를 검토하고 해당 국가의 공식 보호 절차를 확인합니다.',steps:[
    ['INVENTORY','어떤 개인정보가 어디에 제공됐는지 개인정보를 화면에 입력하지 않고 스스로 점검합니다.'],
    ['ACCOUNT','관련 계정 및 금융기관의 공식 경로에서 보호 조치를 확인합니다.'],
    ['REPORT','거주 국가의 공식 신원도용·피해신고 자료를 확인합니다.']]},
  UNKNOWN:{title:'피해 여부 불확실',summary:'피해를 단정하지 않고 확인할 사실부터 정리합니다.',steps:[
    ['STOP','추가 금전·인증정보 제공·앱 설치를 보류합니다.'],
    ['INDEPENDENT','기존에 알고 있던 연락처나 공식 앱에서 요구의 진위를 독립 확인합니다.'],
    ['CHECK','계정·거래에 실제 이상이 있는지 안전한 경로로 확인하고 필요시 유형별 절차를 선택합니다.']]}
});

const SOURCES=Object.freeze({
  KR:[
    {label:'경찰청 사이버범죄 피해구제 안내',url:'https://ecrm.police.go.kr/minwon/crs/quick/vichelp',scope:'금전 피해 및 공식 신고 절차',pathIds:['PAYMENT','CREDENTIALS','IDENTITY','UNKNOWN']},
    {label:'KISA 보호나라 보안 공지',url:'https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&menuNo=205020&nttId=71739',scope:'사칭·원격제어 앱 유도 주의',pathIds:['REMOTE_ACCESS','CREDENTIALS','UNKNOWN']}
  ],
  US:[
    {label:'FTC 사기 피해 후 대응',url:'https://consumer.ftc.gov/articles/what-do-if-you-were-scammed',scope:'금전·계정·개인정보·기기 접근 대응',pathIds:['PAYMENT','CREDENTIALS','REMOTE_ACCESS','IDENTITY','UNKNOWN']},
    {label:'FTC IdentityTheft.gov',url:'https://www.identitytheft.gov/',scope:'신원도용 대응 계획',pathIds:['IDENTITY','CREDENTIALS','UNKNOWN']}
  ],
  UNKNOWN:[]
});
const STATES=new Set(['TODO','DONE','NOT_APPLICABLE']);
const ID=/^[a-zA-Z0-9_-]{1,80}$/;
const fail=message=>{const err=new Error(message);err.status=400;throw err;};
export const availableRecoveryPaths=()=>Object.entries(RECOVERY_PATHS).map(([id,v])=>({id,title:v.title,summary:v.summary}));
export function newRecoveryProgress(caseId){if(!ID.test(caseId))fail('올바르지 않은 사건 ID');return {caseId,version:0,selectedPath:null,progress:{},events:[],reviewedAt:null};}
export function recoveryView(store,country='UNKNOWN'){
  const info=Object.hasOwn(RECOVERY_PATHS,store.selectedPath)?RECOVERY_PATHS[store.selectedPath]:null;
  const steps=info?info.steps.map(([id,description])=>({id,description,status:store.progress[store.selectedPath]?.[id]??'TODO'})):[];
  return {caseId:store.caseId,version:store.version,selectedPath:store.selectedPath,
    paths:availableRecoveryPaths(),title:info?.title??null,summary:info?.summary??null,steps,
    reviewedAt:store.reviewedAt,events:store.events.slice(-25).map(({eventId,type,pathId,stepId,status,at})=>({eventId,type,pathId,stepId,status,at})),
    sourceCountry:country==='KR'||country==='US'?country:'UNKNOWN',
    sources:country==='KR'||country==='US'?SOURCES[country].filter(source=>source.pathIds.includes(store.selectedPath)).map(({label,url,scope})=>({label,url,scope})):[],
    statement:'체크는 사용자 선택 기록일 뿐이며 실제 조치·피해·신원·송금·신고 완료를 증명하지 않습니다.',
    externalActionPerformed:false,realMoneySent:false,verifiedCompletion:false};
}
export function applyRecoveryEvent(store,event){
  if(!event||typeof event!=='object'||Array.isArray(event))fail('회복 이벤트 형식 오류');
  if(event.caseId!==store.caseId)fail('다른 사건의 회복 이벤트');
  if(typeof event.eventId!=='string'||!ID.test(event.eventId))fail('회복 이벤트 식별자 오류');
  if(!['CARE_PATH_SELECTED','RECOVERY_STEP_MARKED','RECOVERY_STEP_REOPENED','RECOVERY_REVIEWED'].includes(event.type))fail('허용되지 않은 회복 이벤트');
  const normalized={caseId:event.caseId,eventId:event.eventId,type:event.type,pathId:event.pathId??null,
    stepId:event.stepId??null,status:event.status??null};
  const fingerprint=JSON.stringify(normalized);
  const existing=store.events.find(x=>x.eventId===event.eventId);
  if(existing){if(existing.fingerprint!==fingerprint)fail('동일 이벤트 ID로 서로 다른 조치 시도');return store;}
  if(event.expectedRecoveryVersion!==store.version) {const err=new Error('오래된 회복 상태 버전');err.status=409;throw err;}
  if(store.events.length>=100){const err=new Error('로컬 데모 회복 이벤트 100개 한도 도달');err.status=409;throw err;}
  const path=Object.hasOwn(RECOVERY_PATHS,event.pathId)?RECOVERY_PATHS[event.pathId]:null;
  if(event.type==='CARE_PATH_SELECTED'){
    if(!path||event.stepId!==undefined||event.status!==undefined)fail('잘못된 회복 유형 선택');
  }else if(event.type==='RECOVERY_REVIEWED'){
    if(!store.selectedPath||event.pathId!==store.selectedPath||event.stepId!==undefined||event.status!==undefined)fail('진행 중인 케어 유형을 확인하세요');
  }else{
    if(!path||event.pathId!==store.selectedPath||!path.steps.some(([id])=>id===event.stepId))fail('현재 케어 유형에 없는 단계');
    if(event.type==='RECOVERY_STEP_REOPENED'){
      if(event.status!=='TODO')fail('재개 상태는 TODO여야 합니다');
    }else if(!STATES.has(event.status)||event.status==='TODO')fail('허용되지 않은 완료 상태');
  }
  const progress={...store.progress};
  if(event.type==='RECOVERY_STEP_MARKED'||event.type==='RECOVERY_STEP_REOPENED'){
    progress[event.pathId]={...(progress[event.pathId]??{}),[event.stepId]:event.status};
  }
  const at=new Date().toISOString();
  return {...store,version:store.version+1,
    selectedPath:event.type==='CARE_PATH_SELECTED'?event.pathId:store.selectedPath,
    progress,reviewedAt:event.type==='RECOVERY_REVIEWED'?at:store.reviewedAt,
    events:[...store.events,{...normalized,at,fingerprint}]};
}
