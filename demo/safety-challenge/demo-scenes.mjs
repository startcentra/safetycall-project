/** v1.0.0 presenter runbook. Each milestone is computed from actual server case state.
 * This is a MOCK walk-through, not a model evaluation or evidence of prevented fraud.
 */
export const SCENE_DEFINITIONS = Object.freeze([
  {id:'normal',title:'01 정상 연락 · 과잉 경고 확인',scenarioId:'benign',mode:'guidance',country:'KR',
    intent:'정상적인 가족 연락에서도 범죄나 긴급 상황을 확정하지 않습니다.',
    milestones:[
      {id:'start',label:'정상 대화 사례 시작',instruction:'선택한 정상 연락 대본을 확인하세요.'},
      {id:'first',label:'첫 발화 관찰',instruction:'‘다음 발화 보기’를 누르고 위험 표시를 확인하세요.'},
      {id:'all',label:'대본 끝까지 관찰',instruction:'나머지 발화를 표시하고 긴급 경고가 생기지 않는지 확인하세요.'},
    ]},
  {id:'early',title:'02 피해 전 직접 시작하는 케어',scenarioId:'otp',mode:'guidance',country:'KR',
    intent:'전화 원음 없이 사용자가 직접 위험을 알리고, 송금 보류를 선택합니다. 자동 탐지 성공이 아닙니다.',
    milestones:[
      {id:'start',label:'인증번호 사칭 대본 시작',instruction:'아직 발화가 없는 상태에서도 케어가 가능합니다.'},
      {id:'checkin',label:'사용자 걱정 직접 선택',instruction:'‘돈·인증번호를 요구해요’를 눌러 미확인 자기 보고 기반 안내를 확인하세요.'},
      {id:'stop',label:'보류 행동 선택',instruction:'‘송금 보류’를 누르세요. 실제 송금이나 외부 차단은 없습니다.'},
    ]},
  {id:'family',title:'03 가상 가족의 도움 요청',scenarioId:'benign',mode:'verified',country:'KR',
    intent:'독립된 자녀 역할 창의 미인증 HELP_REQUESTED가 보호자의 주 코칭에 반영됩니다.',
    milestones:[
      {id:'start',label:'가상 가족 연결 시작',instruction:'이 장면은 실제 연락이나 신원 확인을 수행하지 않습니다.'},
      {id:'request',label:'가상 가족 확인 요청',instruction:'‘가상 가족에게 확인 요청’을 누른 뒤 자녀 화면을 여세요.'},
      {id:'help',label:'자녀 역할 도움 요청',instruction:'자녀 창에서 ‘도움이 필요함’을 누르세요. 보호자 화면에 안전 확인 안내가 나타납니다.'},
    ]},
  {id:'recovery',title:'04 피해 후 회복 체크리스트',scenarioId:'otp',mode:'guidance',country:'KR',
    intent:'사건 위험 상태는 종료 이후 변경되지 않지만 사용자 체크리스트는 계속 갱신할 수 있습니다.',
    milestones:[
      {id:'start',label:'회복 사례 시작',instruction:'피해가 발생했다고 확정하지 않습니다.'},
      {id:'open',label:'사후관리 패널 열기',instruction:'‘사후관리 안내’를 선택하세요.'},
      {id:'path',label:'회복 유형 직접 선택',instruction:'‘송금·금전 피해 의심’ 등 알맞은 회복 유형을 선택하세요.'},
      {id:'close',label:'사건 종료',instruction:'‘사건 종료’를 선택해 사건 위험 상태를 닫으세요.'},
      {id:'after',label:'종료 후 회복 기록',instruction:'종료된 사건에서 ‘회복 단계 다시 검토했다고 기록’을 선택하세요.'},
    ]},
]);
const SCENE_BY_ID = new Map(SCENE_DEFINITIONS.map(scene=>[scene.id,scene]));
export const getSceneDefinition=id=>SCENE_BY_ID.get(id)??null;
export function getSceneGuide(run){
  if(!run.demoSceneId)return null;
  const scene=getSceneDefinition(run.demoSceneId);
  if(!scene)return null;
  const statuses={
    start:true,
    first:run.step>=1,
    all:run.step>=run.totalSteps&&!run.caseState.assessment?.emergencyFlag,
    checkin:run.concern?.type==='PAYMENT_OR_CODE',
    stop:run.actions.some(a=>a.kind==='STOP_TRANSFER'),
    request:run.verification?.status==='REQUESTED'||['SELF_REPORTED_SAFE','HELP_REQUESTED','UNABLE_TO_CONFIRM','EXPIRED'].includes(run.verification?.status),
    help:run.verification?.status==='HELP_REQUESTED',
    open:run.actions.some(a=>a.kind==='RECOVERY_OPEN'),
    path:!!run.recovery.selectedPath,
    close:!!run.endedAt,
    after:!!run.recovery.reviewedAt&&!!run.endedAt,
  };
  const milestones=scene.milestones.map(m=>({...m,done:!!statuses[m.id]}));
  const done=milestones.filter(m=>m.done).length;
  return {id:scene.id,title:scene.title,intent:scene.intent,scenarioId:scene.scenarioId,mode:scene.mode,
    milestones,completed:done===milestones.length,progress:{done,total:milestones.length},
    next:milestones.find(m=>!m.done)??null,
    mockOnly:true,noRealWorldOutcome:true};
}
export const listSceneDefinitions=()=>SCENE_DEFINITIONS.map(({id,title,scenarioId,mode,country,intent})=>({id,title,scenarioId,mode,country,intent}));
