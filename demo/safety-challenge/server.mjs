/**
 * SafeCall MOCK vertical-slice server, native Node.js + existing v0.6.6 pure modules.
 * No phone provider, money transfer, or account contact. Meta calls occur ONLY after explicit opt-in + server-side gates and only for synthetic scripted text.
 * Binds loopback by default and is intentionally NOT a production auth design.
 */
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {readFileSync,createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import {LiveMetaProvider,buildContext} from '../../src/modules/analysis/meta-provider.ts';
import {LiveRequestGate} from '../../src/modules/analysis/meta-gate.ts';
import {validateMetaInput,validateModelOutput} from '../../src/modules/analysis/meta-validation.ts';
import {PLATFORM_CAPABILITIES} from '../../src/modules/platform-capability/index.ts';
import {createRecoveryCapsule,openRecoveryCapsule} from '../../src/modules/postcall-capsule/index.ts';
import {createDemoBankState,applyDemoBankCommand} from '../../src/modules/mock-banking/safe-bank-ledger.ts';
import {createMockCardState,applyMockCardCommand} from '../../src/modules/mock-banking/mock-card-ledger.ts';
import {evaluateToolProposal} from '../../src/modules/analysis/tool-proposals.ts';
import {applyValidatedFixture,FixtureValidationError} from '../../src/modules/audio/fixture-protocol.ts';
import {reviewActiveEvidence} from '../../src/modules/analysis/evidence-review.ts';
import {DEMO_AUDIO_OPTIONS,demoAudioAdapter,makeDemoAudioInput} from '../../src/modules/audio/stt-demo-catalog.ts';
import {digestAudio,validateAudioInput} from '../../src/modules/audio/stt-port.ts';
import {LocalWhisperCliAdapter} from '../../src/modules/audio/local-whisper-stt.ts';
import {makeCanonicalEvent} from '../../src/modules/events/canonical.ts';
import {MESSAGE_FIXTURES,classifyMessage,projectMessages,derivePostCallPlan,EXPOSURE_QUESTIONS,REVIEW_TTL_MS} from '../../src/modules/message-safety/index.ts';
import {getReplayPolicy,mayEnableExtendedReplay} from '../../src/modules/audio/replay-policy.ts';
import {deriveCaptionAdvisory} from '../../src/modules/policy/provisional-caption.ts';
import {validateVideoFixture,extractContextEvidence} from '../../src/modules/voice-benchmark/index.ts';
import {deriveIntervention} from '../../src/modules/policy/intervention.ts';
import {decideBankArrival,maskedStaffScript} from '../../src/modules/bank-arrival/index.ts';
import {createCase,applyCaseEvent,getCaseView} from '../../src/modules/case/index.ts';
import {selectLiveGuidance} from '../../src/modules/playbook/select.ts';
import {SCENARIOS,MODES} from './scenarios.mjs';
import {evaluateTextCorpus} from '../../src/modules/text-benchmark/benchmark.ts';
import {evaluateSemanticCorpus} from '../../src/modules/text-benchmark/evaluate-v138.ts';
import {getSceneDefinition,listSceneDefinitions} from './demo-scenes.mjs';
import {CARE_CONCERNS,deriveEarlyCareEvidence} from './care-plan.mjs';
import {newRecoveryProgress,applyRecoveryEvent} from './recovery.mjs';
import {createCareInteraction,nextCareQuestion,applyCareInteractionEvent,invalidateCareQuestion,deriveActiveCare} from './adaptive-care.mjs';
import {createGuidedJourney,applyGuidedEvent} from './guided-actions.mjs';
import {HttpError,assertSameOrigin,requireJsonContentType,readJsonObject,readBoundedBody} from './http-utils.mjs';
import {projectDemoSnapshot} from './state-projection.mjs';
import {createSessionRepository} from './session-repository.mjs';
import {dispatchCaseCommand} from './command-router.mjs';
import {projectForRole} from './role-projection.mjs';
import {projectGlassesState} from './glasses-projection.mjs';
import {initialLocation,routePointForStep,protectionDecision,contextLocationObservation} from './live-journey.mjs';
import {MEDIA_CATALOG,mediaById,streamMediaToMuse} from './media-realtime.mjs';
import {createMediaOrchestrator,PROVENANCE} from './media-orchestrator.mjs';

const TEXT_BENCH_CASES=JSON.parse(readFileSync(new URL('../../data/v137/text-corpus.json',import.meta.url),'utf8')).cases;
const TEXT_BENCH_RESULT=evaluateTextCorpus(TEXT_BENCH_CASES);
const V138_FROZEN=JSON.parse(readFileSync(new URL('../../data/v138/frozen-probe.json',import.meta.url),'utf8')).cases;
const V138_BENCH_RESULT=evaluateSemanticCorpus(V138_FROZEN);
const V138_PUBLIC_PROBE=JSON.parse(readFileSync(new URL('../../data/v138/public-pattern-probe.json',import.meta.url),'utf8')).cases;
const V138_PUBLIC_RESULT=evaluateSemanticCorpus(V138_PUBLIC_PROBE);
const SITE_DIR=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const MEDIA_DIR=path.join(path.dirname(fileURLToPath(import.meta.url)),'media');
// Immutable, manually observed sparse subtitle snapshots, NOT speech-to-text or live monitoring.
const CAPTION_DATA=JSON.parse(readFileSync(new URL('../../data/v131/video-caption-observations.json',import.meta.url),'utf8'));
const CAPTION_CASES=new Map(CAPTION_DATA.cases.map(item=>{validateVideoFixture(item);return [item.id,item];}));
const MAX_LOCAL_SEGMENTS=8; // Default only. Extended mode requires explicit server-recorded opt-in.
const CAPTION_STEP_MS=5000;
const MAX_CAPTION_MS=110000;

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
const MAX_BODY=8_192;
const MAX_LOG=150;
const MAX_ACTIONS=120;
const MAX_MESSAGE_FIXTURES=12;
const MAX_MESSAGE_ATTEMPTS=24;
const MAX_MESSAGE_REVIEWS=16;
const MAX_POSTCALL_CAPSULE_OPS=8;
const MAX_FOLLOWUP_EVENTS=40;
const MAX_STREAM_CLIENTS=4;
const SESSION_CREATION_WINDOW_MS=60_000;
const MAX_CREATES_PER_WINDOW=48;
const DEFAULT_META_CONFIG=Object.freeze({enabled:false,approved:false,killSwitch:true,apiKey:'',maxCallsPerRun:4,maxCallsPerProcess:16,timeoutMs:12000});
const META_MODEL='muse-spark-1.3';
const META_ADVISORIES=Object.freeze({
  VERIFY_OFFICIAL_CHANNEL:'상대가 알려준 번호나 링크가 아닌 공식 채널에서 따로 확인하세요.',
  DO_NOT_TRANSFER:'확인 전에는 송금하거나 자금을 옮기지 마세요.',
  DO_NOT_SHARE_OTP:'인증번호·비밀번호를 전화 상대에게 제공하지 마세요.',
  DO_NOT_INSTALL_APP:'상대가 안내한 앱 설치·원격 접근을 중단하세요.',
  CONTACT_112:'실제 신체 위해가 우려되면 현지 긴급기관에 연락하세요.',
  CONTACT_BANK_AND_112:'은행 공식 연락처와 현지 긴급기관에 독립적으로 도움을 요청하세요.',
  SEEK_INDEPENDENT_HELP:'믿을 수 있는 가족이나 공식 기관에 독립적으로 확인하세요.',
  NO_IMMEDIATE_ACTION:'급하게 행동하지 말고 출처를 확인하세요.'
});
const unique=()=>randomUUID().replaceAll('-','').slice(0,20);
const clock=()=>new Date().toISOString();
const CLEAN_ACTIONS=new Set(['STOP_TRANSFER','SIMULATED_TRANSFER','EMERGENCY_HELP','END_CALL','RECOVERY_OPEN','CARD_EXPOSURE_REPORTED']);
const VERIFY_RESPONSES=new Set(['SELF_REPORTED_SAFE','HELP_REQUESTED','UNABLE_TO_CONFIRM']);

export function createDemoServer({host='127.0.0.1',port=0,allowLegacyShared=false,sessionIdleMs=30*60*1000,sessionLifetimeMs=60*60*1000,localSttConfig=null,metaConfig={},metaProvider=null,mediaAsrEnabled=false,mediaAsrRunner=streamMediaToMuse,mediaAsrConfig={},mediaClockNow=undefined}={}){
  // Prevent accidental public exposure of the unauthenticated MOCK session-creation endpoint.
  if(host!=='127.0.0.1'&&host!=='localhost')throw new Error('MOCK 데모는 로컬(127.0.0.1/localhost)에서만 실행할 수 있습니다.');
  if(!Number.isSafeInteger(sessionIdleMs)||sessionIdleMs<1||!Number.isSafeInteger(sessionLifetimeMs)||sessionLifetimeMs<1)throw new Error('invalid local session TTL');
  // Session IDs resolve to explicit, isolated in-memory contexts (no ambient async state).
  const localStt=localSttConfig?new LocalWhisperCliAdapter(localSttConfig):null;
  const metaSettings={...DEFAULT_META_CONFIG,...metaConfig};
  for(const [key,max] of [['maxCallsPerRun',5],['maxCallsPerProcess',50]]){
    if(!Number.isSafeInteger(metaSettings[key])||metaSettings[key]<1||metaSettings[key]>max)throw new Error('invalid Meta call budget');
  }
  if(!Number.isSafeInteger(metaSettings.timeoutMs)||metaSettings.timeoutMs<100||metaSettings.timeoutMs>30000)throw new Error('invalid Meta timeout');
  const metaReady=metaSettings.enabled===true&&metaSettings.approved===true&&metaSettings.killSwitch===false&&
    (metaProvider!==null||typeof metaSettings.apiKey==='string'&&metaSettings.apiKey.length>0);
  const globalMetaGate=new LiveRequestGate(metaSettings.maxCallsPerProcess);
  const mediaAsrReady=mediaAsrEnabled===true&&metaReady&&typeof metaSettings.apiKey==='string'&&metaSettings.apiKey.length>0;
  const media=createMediaOrchestrator({config:mediaAsrConfig,runner:mediaAsrRunner,mediaDir:MEDIA_DIR,apiKey:metaSettings.apiKey,
    isReady:()=>mediaAsrReady,isLegacy:ctx=>ctx===legacy,...(mediaClockNow?{now:mediaClockNow}:{})});
  const META_READINESS=Object.freeze({releaseVersion:'1.42',mediaIntegrationVersion:'1.47',product:'SafeCall',providerInThisDemo:metaReady?'META_LIVE_OPT_IN':'SCRIPTED_MOCK',
    glassesDisplay:'BROWSER_PREVIEW_ONLY',officialSimulatorVerified:false,realDeviceVerified:false,
    enabled:metaReady,configured:Boolean(metaSettings.apiKey)||metaProvider!==null,consentRequired:true,
    keyLocation:'SERVER_ENV_ONLY',metaCalled:false,liveVerified:false,adapterPresent:true,adapterModel:META_MODEL,
    inputMode:'SYNTHETIC_TTS_PCM_STREAM_OPT_IN',actualStt:false,realAudioUploadAllowed:false,realFinancialActions:false,
    maxCallsPerRun:metaSettings.maxCallsPerRun,
    explanation:metaReady?'합성 TTS 오디오의 실제 Meta 전사는 키/승인/사건별 동의가 있을 때만 가능. 호출 성공 여부는 이벤트 기준으로 판단.':'Meta LIVE 비활성 · 키/승인/비용 차단 스위치 확인 필요.'});
  const sessions=createSessionRepository();
  const legacy={sessionId:'legacy-test-fixture',run:null,clients:new Set(),completed:[]};
  const secureToken=()=>randomBytes(32).toString('base64url');
  const MAX_SESSIONS=32;
  const MAX_SESSION_STT_REQUESTS=48; // Bounded across case resets: <= 1 hour session.
  const creationTimes=[];
  function checkCreationRate(){
    const now=Date.now();
    while(creationTimes.length&&now-creationTimes[0]>=SESSION_CREATION_WINDOW_MS)creationTimes.shift();
    if(creationTimes.length>=MAX_CREATES_PER_WINDOW)throw new HttpError(429,'세션 생성 요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    creationTimes.push(now);
  }
  function parseRequestUrl(req){
    const hostHeader=req.headers.host;
    if(typeof hostHeader!=='string'||! /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(hostHeader))
      throw new HttpError(400,'유효하지 않은 로컬 Host 헤더');
    const target=req.url;
    if(typeof target!=='string'||!target.startsWith('/')||target.startsWith('//')||target.length>2048)
      throw new HttpError(400,'유효하지 않은 요청 경로');
    try{return new URL(target,'http://127.0.0.1');}
    catch{throw new HttpError(400,'URL 파싱 오류');}
  }
  const SESSION_IDLE_MS=sessionIdleMs;
  const SESSION_LIFETIME_MS=sessionLifetimeMs;
  function disposeSession(id){
    const ctx=sessions.get(id);if(!ctx)return false;
    for(const client of ctx.clients){try{client.response.end();}catch{}}ctx.clients.clear();
    ctx.metaController?.abort();ctx.metaController=null;ctx.metaQueued=false;ctx.media?.controller?.abort();ctx.media=null;ctx.pendingLocalStt=null;ctx.localSttInFlight=false;ctx.localDigests?.clear();ctx.run=null;ctx.completed.length=0;ctx.parentToken='';ctx.childToken='';ctx.glassesToken='';sessions.delete(id);
    return true;
  }
  function cleanupSessions(now=Date.now()){
    let count=0;
    for(const [id,ctx] of sessions){if(now-ctx.lastTouchedAt>=SESSION_IDLE_MS||now-ctx.createdAtMs>=SESSION_LIFETIME_MS){if(disposeSession(id))count++;}}
    return count;
  }
  function startSession(scenarioId='kidnap',mode='verified'){
    if(!Object.hasOwn(SCENARIOS,scenarioId)||!Object.hasOwn(MODES,mode))throw new HttpError(400,'시나리오 또는 모드 오류');
    cleanupSessions();
    checkCreationRate();
    if(sessions.size>=MAX_SESSIONS)throw new HttpError(429,'로컬 시연 세션 한도를 초과했습니다. 서버를 재시작하세요.');
    const ctx={sessionId:'session_'+unique(),run:null,media:null,clients:new Set(),completed:[],createdAtMs:Date.now(),lastTouchedAt:Date.now(),
      parentToken:secureToken(),childToken:secureToken(),glassesToken:secureToken(),pendingLocalStt:null,localSttInFlight:false,localSttRequests:0,localDigests:new Set(),capsuleOps:0};
    ctx.commands=createCaseCommands(ctx);ctx.commands.newRun(scenarioId,mode);sessions.set(ctx.sessionId,ctx);
    return {ctx,parentToken:ctx.parentToken,childToken:ctx.childToken,glassesToken:ctx.glassesToken};
  }
  function equalToken(a,b){if(typeof a!=='string'||!a||a.length!==b.length)return false;
    return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
  function deliver(ctx,client,payload){
    client.pending=payload;
    if(client.blocked)return;
    const body=client.pending;client.pending=null;
    try{
      if(!client.response.write(body)){
        client.blocked=true;
        client.response.once('drain',()=>{
          client.blocked=false;
          if(client.pending&&ctx.clients.has(client))deliver(ctx,client,client.pending);
        });
      }
    }catch{ctx.clients.delete(client);try{client.response.destroy();}catch{}}
  }

  // Each command service captures exactly one context. No process-wide mutable current run.
  function createCaseCommands(ctx){
    let run=ctx.run;
  const newRun=(scenarioId='kidnap',mode='verified')=>{
    const scenario=SCENARIOS[scenarioId],which=MODES[mode];
    if(!scenario||!which)throw new HttpError(400,'존재하지 않는 시나리오 또는 실험 모드');
    const id='demo_'+unique();
    ctx.metaController?.abort();ctx.metaController=null;ctx.metaQueued=false;ctx.media?.controller?.abort();ctx.media=null;ctx.pendingLocalStt=null;ctx.localDigests?.clear();
    ctx.run={id,scenarioId,mode,startedAt:clock(),endedAt:null,callEndedAt:null,step:0,caseState:createCase(id),transcript:[],
      messages:[],messageAttempts:[],messageReviews:[],postCall:{answers:{},taskStates:{},eventIds:[],restoredFrom:null},
      verification:null,concern:null,jurisdiction:scenario.country,jurisdictionSource:'SCRIPTED_SCENARIO',recovery:newRecoveryProgress(id),careInteraction:createCareInteraction(id),guided:createGuidedJourney(id),safeBank:createDemoBankState(id,0),mockCard:createMockCardState(id),cardExposureReported:false,voiceFixture:{mode:'SCRIPTED',lastStatus:'IDLE',finalCount:0,ignoredCount:0,eventCount:0,lastTurnId:null,lastRevision:null,localSegmentCount:0,nextStartMs:0,localSttAttempts:0,replayMode:'STANDARD_40S',replayMaxSegments:8},captionReplay:null,canonicalEvents:[],toolProposals:[],toolAudit:[],bankArrivalConfirmed:false,bankHelpConsented:false,location:initialLocation(),actions:[],notes:[],sequence:0,log:[],version:0,demoSceneId:null,meta:{status:metaReady?'AWAITING_CONSENT':'DISABLED',consented:false,callCount:0,caseVersion:null,review:null,errorCode:null,lastStartedAt:null,lastCompletedAt:null,judgementLog:[]}};
    run=ctx.run;
    addLog('START',`${scenario.name} · ${which.title} 시작`);
    return run;
  };
  function addLog(type,message){
    run.version++;run.log.push({eventId:`${run.id}_${run.version}`,at:clock(),type,message});
    if(run.log.length>MAX_LOG)run.log.shift();
  }
  function recordAction(kind,note){
    // Repeated clicks of the same action at the same transcript step are not new evidence.
    const last=run.actions.at(-1);
    if(last?.kind===kind&&last.step===run.step)return false;
    run.actions.push({kind,at:clock(),step:run.step,note:note??''});
    if(run.actions.length>MAX_ACTIONS)run.actions.shift();
    addLog(kind,note||kind);
    return true;
  }
  // One request-scoped immutable projection, shared by GET, POST and SSE responses.
  function enforceRuleCardLock(){
    if(run.endedAt||run.mockCard.status!=='ACTIVE')return;
    const assessment=getCaseView(run.caseState).assessment;
    const emergency=assessment.emergencyFlag;
    const nearBank=['NEAR_BANK','AT_BANK'].includes(run.location.zone)&&assessment.riskBand==='HIGH';
    if(!emergency&&!nearBank)return;
    const result=applyMockCardCommand(run.mockCard,{
      id:emergency?'emergency_rule_lock':'bank_proximity_rule_lock',caseId:run.id,cardRef:'DEMO_CARD_1',action:'LOCK',
      expectedRevision:run.mockCard.revision,userConfirmed:true,caseOpen:true,
    });
    if(result.reason!=='APPLIED')return;
    run.mockCard=result.state;
    addLog(emergency?'MOCK_CARD_EMERGENCY_LOCK':'MOCK_CARD_PROXIMITY_LOCK',emergency
      ?'로컬 위해 협박 규칙으로 가상 카드를 잠갔습니다. 모델이 실행한 명령이 아니며 실제 카드에는 영향이 없습니다.'
      :'가상 은행 근처의 높은 위험 규칙으로 가상 카드를 잠갔습니다. 모델이 실행한 명령이 아니며 실제 카드에는 영향이 없습니다.');
  }
  function snapshot(){enforceRuleCardLock();const state=projectDemoSnapshot(ctx,{metaReadiness:META_READINESS,legacy});return {...state,location:run.location,media:media.project(ctx),ruleSignals:ruleSignals(),protectionGate:protectionDecision({riskBand:state.risk.band,location:run.location,ended:!!run.endedAt})};}
  function ruleSignals(){
    // The rule engine reports an evidence snippet, not a turn id: attribute it to the earliest active transcript line containing it.
    try{
      const active=new Set(run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE').map(t=>t.turnId));
      const lines=run.transcript.filter(t=>active.has(t.turnId));
      return getCaseView(run.caseState).assessment.signals.slice(0,12).map(s=>{
        const snippet=typeof s.evidence==='string'?s.evidence.trim():'';
        const probe=snippet.slice(0,24);
        const line=probe?lines.find(t=>t.text.normalize('NFKC').replace(/\s+/g,' ').includes(probe)):undefined;
        return {code:s.code,weight:s.weight,turnId:line?.turnId??null,evidence:snippet.slice(0,90),source:PROVENANCE.RULE_ENGINE};
      });
    }catch{return [];}
  }
  function protectionBlocked(){return protectionDecision({riskBand:getCaseView(run.caseState).assessment.riskBand,location:run.location,ended:!!run.endedAt}).blocked;}
  function hudSignalCodes(){
    const codes=[];
    try{
      for(const signal of getCaseView(run.caseState).assessment.signals){
        if(signal&&typeof signal.code==='string'&&!codes.includes(signal.code))codes.push(signal.code);
        if(codes.length>=8)break;
      }
    }catch{return [];}
    return codes;
  }
  function glassesFrom(parentState){return projectGlassesState({...parentState,hudSignalCodes:hudSignalCodes()});}
  function recordModelJudgement(modelStatus,modelRiskLevel){
    let ruleBand='LOW';
    try{ruleBand=getCaseView(run.caseState).assessment.riskBand;}catch{/* keep rules label local */}
    const entry={at:clock(),modelStatus,modelRiskLevel:modelRiskLevel??null,ruleBand,errorCode:run.meta.errorCode??null,separated:true,effect:'RULES_UNCHANGED'};
    run.meta.judgementLog=[entry,...(Array.isArray(run.meta.judgementLog)?run.meta.judgementLog:[])].slice(0,8);
  }
  function loadScene(body){
    assertRun(body);assertVersion(body);
    const scene=getSceneDefinition(body.sceneId);
    if(!scene)throw new HttpError(400,'존재하지 않는 시연 장면입니다.');
    newRun(scene.scenarioId,scene.mode);
    run.demoSceneId=scene.id;
    addLog('PRESENTER_SCENE',`시연 장면 ${scene.id} 시작 · 가상 시나리오 · 실제 결과 아님`);
  }
  function publish(){
    if(!ctx.clients.size)return;
    const parentState=snapshot();
    const parentPayload=`event: state\ndata: ${JSON.stringify(parentState)}\n\n`;
    const childPayload=`event: state\ndata: ${JSON.stringify(projectForRole(parentState,'child'))}\n\n`;
    const glassesPayload=`event: state\ndata: ${JSON.stringify(glassesFrom(parentState))}\n\n`;
    for(const client of ctx.clients)deliver(ctx,client,client.role==='glasses'?glassesPayload:client.role==='child'?childPayload:parentPayload);
  }
  function assertOpen(){if(run.endedAt)throw new HttpError(409,'종료된 시뮬레이션입니다. 새로 시작하세요.','CASE_ENDED');}
  function assertCallOngoing(){if(run.callEndedAt)throw new HttpError(409,'통화가 종료된 사건에는 신규 음성·자막 발화를 추가할 수 없습니다.','POLICY_DENIED');}
  function assertNotTextOnly(){if(run.scenarioId.startsWith('txt_'))throw new HttpError(409,'텍스트 전용 사건은 오디오/STT/자막 입력과 혼합할 수 없습니다. 새 사건을 선택하세요.','POLICY_DENIED');}
  function assertRun(body){if(body.runId!==run.id)throw new HttpError(409,'사건이 바뀌었습니다. 새 화면을 확인하세요.');}
  function assertVersion(body){if(body.expectedVersion!==run.version)throw new HttpError(409,'화면 상태가 바뀌었습니다. 최신 상태를 확인하세요.','CASE_VERSION_CONFLICT');}
  function metaConsent(body){
    assertRun(body);assertVersion(body);assertOpen();assertCallOngoing();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','consented'].includes(k))||body.consented!==true)
      throw new HttpError(400,'유료 Meta 분석을 위한 명시적 사건 동의가 필요합니다.','VALIDATION_ERROR');
    if(ctx===legacy)throw new HttpError(403,'공유 레거시 세션에서는 외부 Meta 호출이 금지됩니다.','FORBIDDEN');
    if(!metaReady)throw new HttpError(503,'Meta LIVE 서버 설정이 비활성 상태입니다.','META_DISABLED');
    if(run.meta.consented)throw new HttpError(409,'이 사건에서 이미 Meta 분석을 활성화했습니다.','POLICY_DENIED');
    if(run.voiceFixture.mode!=='SCRIPTED'||run.captionReplay||run.canonicalEvents.some(e=>e.source!=='SCRIPTED_MOCK'))
      throw new HttpError(409,'Meta LIVE는 개인정보 없는 합성 대본 사건에서만 사용할 수 있습니다.','POLICY_DENIED');
    run.meta.consented=true;run.meta.status='READY';
    addLog('META_CONSENT','합성 대화 전송 동의 · 유료 요청 예산 제한 적용 · 모델은 보호 안내만 제안');
    // If consent arrives after one or more scripted turns, assess the current prefix.
    void startMetaReview();
  }
  function startMetaReview(){
    if(!metaReady||!run.meta.consented||run.endedAt||run.callEndedAt||run.voiceFixture.mode!=='SCRIPTED'||run.captionReplay)return;
    const active=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE');
    if(!active.length)return;
    // Single-flight, latest-wins coalescing: don't launch a second billed call while one is pending.
    // The earlier response becomes stale as the case version changes; recheck the latest prefix after it settles.
    if(ctx.metaController&&!ctx.metaController.signal.aborted){
      ctx.metaQueued=true;run.meta.status='WAITING_LATEST';publish();return;
    }
    if(run.meta.callCount>=metaSettings.maxCallsPerRun){
      // Keep the last accepted judgment. A later turn still cannot buy another call.
      run.meta.status='BUDGET_EXHAUSTED';publish();return;
    }
    // Risk checkpoints deliberately do not store raw text; use active, provenance-checked script transcripts only.
    const activeById=new Map(active.map(t=>[t.turnId,t]));
    const selected=run.transcript.filter(t=>activeById.has(t.turnId)&&t.turnId.startsWith('turn_'))
      .slice(-8).map(t=>({turnId:t.turnId,speaker:activeById.get(t.turnId).speaker,text:t.text}));
    let input;try{input=validateMetaInput({turns:selected,locationObservation:contextLocationObservation(run.location)});}catch{
      run.meta.status='INPUT_REJECTED';run.meta.review=null;publish();return;
    }
    // At most one paid call in flight per case. The latest text is processed after completion.
    const controller=new AbortController();ctx.metaController=controller;
    const capturedRun=run,caseVersion=run.caseState.version,locationZone=run.location.zone;
    const fingerprint=`${ctx.sessionId}:${run.id}:${caseVersion}`;
    try{globalMetaGate.reserve(fingerprint);}catch{
      run.meta.status='PROCESS_BUDGET_EXHAUSTED';publish();return;
    }
    run.meta.status='PENDING';run.meta.caseVersion=caseVersion;run.meta.errorCode=null;
    run.meta.callCount++;run.meta.lastStartedAt=clock();publish();
    const provider=metaProvider??new LiveMetaProvider({apiKey:metaSettings.apiKey,timeoutMs:metaSettings.timeoutMs,signal:controller.signal});
    const analysis=provider.analyze(buildContext(input));
    let closed=false;
    const startedAt=Date.now();
    const watchdog=setInterval(()=>{
      if(closed||ctx.metaController!==controller){clearInterval(watchdog);return;}
      if(Date.now()-startedAt<15000)return;
      controller.abort();
      settle(Object.assign(new Error('meta-timeout'),{kind:'TIMEOUT'}));
    },1000);
    function settle(err,response){
      if(closed)return;
      closed=true;clearInterval(watchdog);
      const queued=ctx.metaQueued;ctx.metaQueued=false;
      if(ctx.metaController===controller)ctx.metaController=null;
      globalMetaGate.finish(fingerprint);
      if(ctx.run!==capturedRun||run.meta.status==='CANCELLED_ON_END')return;
      const current=ctx.run===capturedRun&&!run.endedAt&&!run.callEndedAt&&run.caseState.version===caseVersion&&run.location.zone===locationZone;
      if(!err&&response&&current){
        try{
          if(response?.analysisMode!=='LIVE'||!response.analysis||!Array.isArray(response.analysis.evidenceUtteranceIds))throw new Error('invalid LIVE result');
          const validated=validateModelOutput(response.analysis,input.turns);
          const actions=validated.recommendedActionCodes;
          if(!Array.isArray(actions)||actions.some(a=>!Object.hasOwn(META_ADVISORIES,a)))throw new Error('invalid advisory');
          run.meta.review={analysisMode:'LIVE',model:META_MODEL,riskLevel:validated.riskLevel,
            evidenceTurnIds:validated.evidenceUtteranceIds.slice(0,8),
            actionCodes:actions.slice(0,5),advisories:actions.slice(0,5).map(a=>META_ADVISORIES[a]),
            elapsedMs:response.elapsedMs??null,usage:response.usage?{inputTokens:response.usage.inputTokens??null,outputTokens:response.usage.outputTokens??null,totalTokens:response.usage.totalTokens??null}:null};
          run.meta.status='LIVE_VERIFIED';run.meta.errorCode=null;run.meta.lastCompletedAt=clock();recordModelJudgement('LIVE_VERIFIED',validated.riskLevel);publish();
        }catch(error){err=error;}
      }else if(!err&&response&&!queued){
        run.meta.status='STALE_DISCARDED';run.meta.review=null;publish();
      }
      if(err&&ctx.run===capturedRun&&run.meta.status!=='CANCELLED_ON_END'){
        const code=['UNAUTHORIZED','RATE_LIMIT','TIMEOUT','INVALID_RESPONSE','UPSTREAM','UNAVAILABLE'].includes(err?.kind)?err.kind:'INVALID_RESPONSE';
        if(run.meta.review){run.meta.status='LIVE_VERIFIED';run.meta.errorCode=code;}
        else{run.meta.status='ERROR';run.meta.review=null;run.meta.errorCode=code;}
        recordModelJudgement(run.meta.status,run.meta.review?.riskLevel??null);publish();
      }
      if(queued&&ctx.run===capturedRun&&!run.endedAt&&!run.callEndedAt)void startMetaReview();
    }
    analysis.then(response=>settle(null,response),err=>settle(err));
  }
  function mediaBegin(mediaId,{provider,replay=false}){
    if(run.step!==0||run.transcript.length)throw new HttpError(409,'기존 발화와 미디어 혼합 불가','POLICY_DENIED');
    run.voiceFixture.mode=replay?'SCRIPTED_TTS_REPLAY':'STREAMED_MEDIA_STT';run.voiceFixture.lastStatus=replay?'REPLAY_READY':'CONNECTING';
    run.meta.consented=!replay&&metaReady;run.meta.status=replay?'DISABLED':metaReady?'READY':'DISABLED';
    addLog('MEDIA_SOURCE',replay?'가상 합성 대본 재생 · 실제 음성인식/Meta AI 호출 아님 · 20턴 상한':provider==='META'?'권리·동의 확인된 녹음 자료 · Meta 실시간 음성인식 전송 · 금융 집행 없음':'로컬 계약 시뮬레이터 · 외부 전송 없음 · 실제 음성인식 아님');
  }
  /** Applies one quality-checked ASR final. Returns rule deltas, or null when the case can't take more evidence. */
  function mediaFinal(event){
    if(!['STREAMED_MEDIA_STT','SCRIPTED_TTS_REPLAY'].includes(run.voiceFixture.mode)||run.endedAt||run.callEndedAt)return null;
    if(typeof event?.text!=='string'||!event.text.trim()||event.text.length>800)return null;
    if(run.voiceFixture.finalCount>=20)return null;
    const index=run.voiceFixture.finalCount,turnId=`media_turn_${index}`;
    const text=event.text.trim();
    const before=getCaseView(run.caseState).assessment;
    const previousCodes=new Set(before.signals.map(s=>s.code));
    // Live ASR has unverified speakers, while offline replay has labelled FICTIONAL roles.
    const replay=run.voiceFixture.mode==='SCRIPTED_TTS_REPLAY';
    const speaker=replay?(event.role==='receiver'?'user':event.role==='narrator'?'unknown':'caller'):'caller';
    run.caseState=applyCaseEvent(run.caseState,{type:'UTTERANCE_FINAL',caseId:run.id,eventId:`media_final_${index}`,turnId,revision:0,absoluteIndex:index,speaker,text});
    const startMs=Number.isFinite(event.startMediaMs)?Math.max(0,Math.round(event.startMediaMs)):null;
    const endMs=Number.isFinite(event.endMediaMs)?Math.max(startMs??0,Math.round(event.endMediaMs)):null;
    run.transcript.push({turnId,index,speaker,speakerVerified:false,speakerLabel:event.speakerLabel??null,text,cue:replay?'LOCAL_SCRIPT_REPLAY · NOT_ASR':'Meta Muse Voice Transcribe · 화자 미확인 · 사전 녹음',at:clock(),
      source:replay?'SCRIPTED_TTS_REPLAY':'STREAMED_MEDIA_STT',provenance:replay?'SCRIPTED_MOCK':media.asrProvenance,startMediaMs:startMs,endMediaMs:endMs,mediaTimeMs:endMs});
    run.voiceFixture.finalCount=index+1;run.voiceFixture.lastStatus='APPLIED_FINAL';run.voiceFixture.lastTurnId=turnId;
    run.canonicalEvents.push(makeCanonicalEvent({caseId:run.id,eventId:`media_final_${index}`,turnId,sequence:index,kind:'UTTERANCE_FINAL',source:replay?'SCRIPTED_MOCK':'META_STREAMING_STT',speaker,revision:0,
      startMs:startMs??Math.max(0,(endMs??0)-3000),endMs:endMs??0,status:replay?'SCRIPTED_DEMO':'ASR_FINAL'}));
    if(run.canonicalEvents.length>80)run.canonicalEvents=run.canonicalEvents.slice(-80);
    run.careInteraction=invalidateCareQuestion(run.careInteraction);
    addLog(replay?'MEDIA_SCRIPT_FINAL':'MEDIA_ASR_FINAL',`합성 오디오 ${index+1}/20 발화 처리 · ${replay?'오프라인 대본 리플레이':'실제 음성인식'} · 규칙 엔진 평가`);
    const after=getCaseView(run.caseState).assessment;
    return {turnId,riskBand:after.riskBand,riskIndex:after.riskIndex,newSignalCodes:after.signals.map(s=>s.code).filter(c=>!previousCodes.has(c))};
  }
  function mediaLocationStep(step){
    const previousZone=run.location.zone;
    applyLocationStep(step);
    return {zone:run.location.zone,previousZone,distanceMeters:run.location.distanceMeters};
  }
  /**
   * Model review of the latest usable ASR finals plus SIMULATED_GPS context. Single-flight with latest-wins coalescing.
   * The last budgeted call is reserved for the end-of-audio review. A response describing an older prefix is still valid
   * evidence about that prefix, so it is kept (with its coverage) rather than discarded as stale.
   */
  async function startMediaMetaReview(reason='FINALS_WINDOW'){
    if(!metaReady||!run.meta.consented||run.voiceFixture.mode!=='STREAMED_MEDIA_STT'||!ctx.media||run.endedAt||run.callEndedAt)return;
    if(!media.transferBasis(mediaById(ctx.media.mediaId)))return;
    // A run labelled as simulator must never reach the live Meta provider.
    if(media.config.modelProvider!=='META'&&!metaProvider)return;
    if(ctx.metaController&&!ctx.metaController.signal.aborted){ctx.metaQueued=ctx.metaQueued==='AUDIO_COMPLETED'?'AUDIO_COMPLETED':reason;if(run.meta.status!=='PENDING')run.meta.status='WAITING_LATEST';publish();return;}
    const budget=metaSettings.maxCallsPerRun;
    if(run.meta.callCount>=budget||(reason!=='AUDIO_COMPLETED'&&budget>1&&run.meta.callCount>=budget-1)){
      if(run.meta.callCount>=budget)run.meta.status='BUDGET_EXHAUSTED';
      media.pushEvent(ctx,'AI_ANALYSIS_SKIPPED',media.modelProvenance,{reason,cause:run.meta.callCount>=budget?'RUN_BUDGET_EXHAUSTED':'RESERVED_FOR_COMPLETION'});return;
    }
    const selected=run.transcript.filter(t=>t.source==='STREAMED_MEDIA_STT').slice(-8).map(t=>({turnId:t.turnId,speaker:'unknown',text:t.text.slice(0,800)}));
    if(!selected.length)return;
    const locationObservation=contextLocationObservation(run.location);
    let input;try{input=validateMetaInput({turns:selected,locationObservation});}catch{run.meta.status='INPUT_REJECTED';publish();return;}
    const currentRun=run,newestTurnId=selected.at(-1).turnId;
    const fingerprint=`media:${ctx.sessionId}:${run.id}:${newestTurnId}:${run.location.zone}`;
    try{globalMetaGate.reserve(fingerprint);}catch{
      const duplicate=run.meta.review?.newestTurnId===newestTurnId&&run.meta.review?.locationZone===run.location.zone;
      if(!duplicate)run.meta.status='PROCESS_BUDGET_EXHAUSTED';
      media.pushEvent(ctx,'AI_ANALYSIS_SKIPPED',media.modelProvenance,{reason,cause:duplicate?'DUPLICATE_INPUT':'PROCESS_BUDGET_EXHAUSTED'});return;
    }
    const controller=new AbortController();ctx.metaController=controller;
    run.meta.status='PENDING';run.meta.callCount++;run.meta.lastStartedAt=clock();run.meta.errorCode=null;
    media.noteReviewStarted(ctx);
    media.pushEvent(ctx,'AI_ANALYSIS_STARTED',media.modelProvenance,{reason,inputTurnIds:selected.map(t=>t.turnId),location:locationObservation??null,call:run.meta.callCount,budget});
    try{
      const provider=metaProvider??new LiveMetaProvider({apiKey:metaSettings.apiKey,timeoutMs:metaSettings.timeoutMs,signal:controller.signal,sourceContext:'CONSENTED_PRERECORDED_AUDIO'});
      const response=await provider.analyze(buildContext(input));
      if(ctx.run!==currentRun||controller.signal.aborted)return;
      if(response?.analysisMode!=='LIVE')throw Object.assign(new Error('not live'),{kind:'INVALID_RESPONSE'});
      const v=validateModelOutput(response.analysis,input.turns);
      const actions=v.recommendedActionCodes.filter(a=>Object.hasOwn(META_ADVISORIES,a)).slice(0,5);
      const usage=response.usage?{inputTokens:response.usage.inputTokens??null,outputTokens:response.usage.outputTokens??null,totalTokens:response.usage.totalTokens??null}:null;
      const newestIndex=run.transcript.findIndex(t=>t.turnId===newestTurnId);
      run.meta.review={analysisMode:'LIVE',provider:media.config.modelProvider,provenance:media.modelProvenance,model:META_MODEL,trigger:reason,
        riskLevel:v.riskLevel,riskIndex:v.riskIndex,manipulationIndex:v.manipulationIndex,
        evidenceTurnIds:v.evidenceUtteranceIds.slice(0,8),actionCodes:actions,advisories:actions.map(a=>META_ADVISORIES[a]),
        detectedSignals:v.detectedSignals.slice(0,8),manipulationTechniques:v.manipulationTechniques.slice(0,8),emergencyFlag:v.emergencyFlag,
        uncertainty:v.uncertainty,inputTurnIds:selected.map(t=>t.turnId),newestTurnId,locationZone:currentRun.location.zone,location:locationObservation??null,
        finalsSince:Math.max(0,run.transcript.length-1-newestIndex),
        // Accepted only when anchored in conversation evidence; location context alone never counts.
        accepted:v.evidenceUtteranceIds.length>0&&v.riskLevel!=='UNKNOWN',
        elapsedMs:response.elapsedMs??null,usage,at:clock()};
      run.meta.status='LIVE_VERIFIED';run.meta.lastCompletedAt=clock();recordModelJudgement('LIVE_VERIFIED',v.riskLevel);
      media.recordModel(ctx,{elapsedMs:response.elapsedMs,usage,newestTurnId});
      media.pushEvent(ctx,'AI_ANALYSIS_COMPLETED',media.modelProvenance,{reason,riskLevel:v.riskLevel,evidenceTurnIds:run.meta.review.evidenceTurnIds,accepted:run.meta.review.accepted,
        emergencyFlag:v.emergencyFlag,elapsedMs:response.elapsedMs??null,protectionEffect:'NONE_SERVER_RULES_DECIDE'},{publish:false});
    }catch(error){
      if(ctx.run!==currentRun)return;
      const code=['RATE_LIMIT','TIMEOUT','UNAUTHORIZED','UPSTREAM','UNAVAILABLE','INVALID_RESPONSE','CANCELLED'].includes(error?.kind)?error.kind:'INVALID_RESPONSE';
      run.meta.errorCode=code;run.meta.status=run.meta.review?'LIVE_VERIFIED':'ERROR';recordModelJudgement(run.meta.status,run.meta.review?.riskLevel??null);
      media.recordModel(ctx,{elapsedMs:null,usage:null,newestTurnId:null});
      media.pushEvent(ctx,'AI_ANALYSIS_ERROR',media.modelProvenance,{reason,errorCode:code},{publish:false});
    }finally{
      globalMetaGate.finish(fingerprint);
      if(ctx.metaController===controller)ctx.metaController=null;
      if(ctx.run===currentRun){
        publish();
        const queued=ctx.metaQueued;ctx.metaQueued=false;
        if(queued&&run.voiceFixture.mode==='STREAMED_MEDIA_STT')void startMediaMetaReview(typeof queued==='string'?queued:'FINALS_WINDOW');
      }
    }
  }
  function reset(body,{legacyReset=false}={}){
    if(!legacyReset){assertRun(body);assertVersion(body);}
    return newRun(body.scenarioId,body.mode);
  }
  function locationTick(body){
    assertRun(body);assertVersion(body);assertOpen();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','routeId','step'].includes(k))||body.routeId!=='BANK_APPROACH_V1')
      throw new HttpError(400,'등록된 위치 시뮬레이션만 사용할 수 있습니다.','VALIDATION_ERROR');
    if(['CONNECTING','STREAMING','RECONNECTING','FLUSHING'].includes(ctx.media?.status))
      throw new HttpError(409,'녹음 분석 중에는 서버가 재생 시각에 맞춰 가상 GPS를 진행합니다.','POLICY_DENIED');
    let next;try{next=routePointForStep(body.step);}catch{throw new HttpError(400,'유효하지 않은 위치 단계','VALIDATION_ERROR');}
    if(next.step===run.location.step)return;
    if(next.step!==run.location.step+1)throw new HttpError(409,'위치 이벤트는 순서대로만 진행할 수 있습니다.','CASE_VERSION_CONFLICT');
    const previousZone=applyLocationStep(next.step);
    if(run.voiceFixture.mode==='STREAMED_MEDIA_STT'){
      media.pushEvent(ctx,'SIMULATED_GPS',PROVENANCE.SIMULATED_GPS,{step:next.step,zone:run.location.zone,distanceMeters:run.location.distanceMeters,manual:true},{publish:false});
      media.checkGate(ctx);
    }
    // Location is contextual evidence for actual AI analysis only when there is explicit Meta consent.
    // Re-judge when the caller is near or at the bank. Distant movement is not a new situation.
    // Model output never overrides the deterministic safety gate.
    if(run.location.zone!==previousZone&&(run.location.zone==='NEAR_BANK'||run.location.zone==='AT_BANK')){void startMetaReview();if(run.voiceFixture.mode==='STREAMED_MEDIA_STT')void startMediaMetaReview('GPS_ZONE_CHANGED');}
  }
  /** Shared by the manual fixture endpoint and the server-owned media schedule. Returns the previous zone. */
  function applyLocationStep(step){
    assertOpen();
    const next=routePointForStep(step);
    if(next.step!==run.location.step+1)throw new HttpError(409,'위치 이벤트는 순서대로만 진행할 수 있습니다.','CASE_VERSION_CONFLICT');
    const previousZone=run.location.zone;
    run.location=next;
    const ruleBand=getCaseView(run.caseState).assessment.riskBand;
    const gate=protectionDecision({riskBand:ruleBand,location:next,ended:!!run.endedAt});
    addLog(gate.blocked?'SIMULATED_BANK_GUARD':'SIMULATED_LOCATION',
      `가상 GPS ${next.step+1}/9 · ${next.zone} · SafeBank 보호 ${gate.blocked?'ON':'OFF'}`);
    return previousZone;
  }
  function advance(body){assertRun(body);assertVersion(body);assertOpen();
    if(run.callEndedAt)throw new HttpError(409,'이미 종료된 가상 통화입니다.','POLICY_DENIED');
    if(run.voiceFixture.mode!=='SCRIPTED')throw new HttpError(409,'전사 입력 사건에서는 합성 대본을 혼합할 수 없습니다. 새 사건을 시작하세요.','POLICY_DENIED');
    const scenario=SCENARIOS[run.scenarioId];
    if(run.step>=scenario.turns.length)throw new HttpError(409,'이미 모든 발화가 표시됐습니다.');
    const idx=run.step;const utterance=scenario.turns[idx];const turnId=`turn_${idx+1}`;
    run.caseState=applyCaseEvent(run.caseState,{type:'UTTERANCE_FINAL',caseId:run.id,eventId:`turn_event_${idx+1}`,
      turnId,revision:0,absoluteIndex:idx,speaker:utterance.speaker,text:utterance.text});
    run.step++;run.careInteraction=invalidateCareQuestion(run.careInteraction);
    run.transcript.push({turnId,index:idx,speaker:utterance.speaker,text:utterance.text,cue:utterance.cue,at:clock()});
    run.canonicalEvents.push(makeCanonicalEvent({caseId:run.id,eventId:`turn_event_${idx+1}`,turnId,
      sequence:idx,kind:'UTTERANCE_FINAL',source:'SCRIPTED_MOCK',speaker:utterance.speaker,revision:0,
      startMs:idx*5000,endMs:(idx+1)*5000,status:'SCRIPTED_DEMO'}));
    addLog('TRANSCRIPT',`발화 ${idx+1} 규칙 분석 완료 · Meta 별도 검토`);
    void startMetaReview();
  }
  /** A test-only transcript path: never accepts audio bytes, model output or real call data. */
  function voiceFixture(body){
    assertNotTextOnly();assertRun(body);assertVersion(body);assertOpen();assertCallOngoing();
    if(run.step!==0||!['SCRIPTED','FIXTURE'].includes(run.voiceFixture.mode))throw new HttpError(409,'서로 다른 전사 출처를 혼합할 수 없습니다. 새 사건을 시작하세요.','POLICY_DENIED');
    if(run.voiceFixture.eventCount>=80)throw new HttpError(429,'MOCK 전사 사건당 입력 이벤트 한도에 도달했습니다.','RATE_LIMITED');
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','event'].includes(k)))throw new HttpError(400,'허용되지 않은 MOCK 전사 입력','VALIDATION_ERROR');
    let applied;
    try{applied=applyValidatedFixture(run.caseState,body.event);}
    catch(error){if(error instanceof FixtureValidationError)throw new HttpError(400,error.message,'VALIDATION_ERROR');
      throw new HttpError(409,'전사 이벤트 충돌 또는 사건 상태 오류','CASE_VERSION_CONFLICT');}
    if(run.caseState.checkpoint.turns.length>=8&&applied.status==='APPLIED_FINAL'&&
       !run.caseState.checkpoint.turns.some(t=>t.turnId===applied.turnId))throw new HttpError(409,'이 로컬 MOCK 사건은 최대 8개 확정 발화를 허용합니다.','POLICY_DENIED');
    if(applied.status==='REPLAY')return;
    run.voiceFixture.eventCount++;run.voiceFixture.mode='FIXTURE';run.voiceFixture.lastStatus=applied.status;
    if(applied.status==='IGNORED_INTERIM'||applied.status==='IGNORED_QUALITY'){
      run.voiceFixture.ignoredCount++;
      addLog('VOICE_FIXTURE_SKIPPED',applied.status+' · 미확정·불확실 전사는 위험 근거로 사용되지 않음');return;
    }
    run.caseState=applied.state;
    const evidenceTurn=run.caseState.checkpoint.turns.find(t=>t.turnId===applied.turnId);
    const sequence=evidenceTurn?.absoluteIndex??0;
    if(run.canonicalEvents.length>=80)throw new HttpError(429,'사건 이벤트 한도 초과','RATE_LIMITED');
    run.canonicalEvents.push(makeCanonicalEvent({caseId:run.id,eventId:`v128_${applied.turnId}_${body.event.revision}_${body.event.operation}`,
      turnId:applied.turnId,sequence,kind:applied.status==='APPLIED_RETRACT'?'UTTERANCE_RETRACT':'UTTERANCE_FINAL',
      source:'MOCK_TRANSCRIPT_FIXTURE',speaker:evidenceTurn?.speaker??'unknown',revision:body.event.revision,
      startMs:sequence*5000,endMs:(sequence+1)*5000,status:'MOCK_FIXTURE'}));
    run.voiceFixture.lastTurnId=applied.turnId;run.voiceFixture.lastRevision=body.event.revision;
    // A corrected or retracted voice fact invalidates previous bank visit/assistance consent.
    run.bankArrivalConfirmed=false;run.bankHelpConsented=false;run.bankArrivalVersion=null;
    run.voiceFixture.finalCount=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE').length;
    run.careInteraction=invalidateCareQuestion(run.careInteraction);
    if(applied.status==='APPLIED_RETRACT')run.transcript=run.transcript.filter(t=>t.turnId!==applied.turnId);
    else{
      const input=body.event;const turn=run.caseState.checkpoint.turns.find(t=>t.turnId===applied.turnId);
      if(!turn)throw new HttpError(409,'전사 변경 후 사건 근거가 없습니다.','CASE_VERSION_CONFLICT');
      const entry={turnId:turn.turnId,index:turn.absoluteIndex,speaker:turn.speaker,text:input.text,cue:'MOCK ASR 입력 · 사용자 동의 · 실제 STT 아님',at:clock()};
      const existing=run.transcript.findIndex(t=>t.turnId===turn.turnId);
      if(existing>=0)run.transcript[existing]=entry;else run.transcript.push(entry);
    }
    addLog('VOICE_FIXTURE',applied.status+' · 전사 본문은 감사 로그에서 제외 · Meta 미호출');
  }
  /** Synthetic tone → pre-written fixture text, NOT genuine speech recognition. */
  async function demoAudioFixture(body){
    assertNotTextOnly();assertRun(body);assertVersion(body);assertOpen();assertCallOngoing();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','fixtureId','consented'].includes(k))||
        body.consented!==true||!DEMO_AUDIO_OPTIONS.includes(body.fixtureId))
      throw new HttpError(400,'가상 음성 매칭용 사용자 동의와 등록된 테스트 ID가 필요합니다.','VALIDATION_ERROR');
    if(run.voiceFixture.eventCount>=80)throw new HttpError(429,'전사 입력 한도 초과','RATE_LIMITED');
    // Audio is created locally; no uploads, microphone, network STT or stored audio.
    const input=makeDemoAudioInput(body.fixtureId,run.id);
    const result=await demoAudioAdapter.recognize(input);
    if(result.actualStt||result.externalCalls!==0||result.mode!=='DIGEST_MAPPED_FIXTURE')
      throw new HttpError(500,'모의 음성 매칭 계약 오류');
    for(const item of result.segments){
      voiceFixture({runId:body.runId,expectedVersion:run.version,event:{source:'MOCK_ASR_FIXTURE',consented:true,
        operation:item.kind==='PARTIAL'?'INTERIM':item.kind==='RETRACTION'?'RETRACT':'FINAL',
        turnId:item.turnId,revision:item.revision,...(item.kind==='RETRACTION'?{}:{speaker:item.speaker,text:item.text,quality:item.quality})}});
    }
    // Immutable, non-sensitive statement: raw bytes and transcript never enter tech logs.
    return {mode:'DIGEST_MAPPED_FIXTURE',actualStt:false,metaCalled:false,externalCalls:0,fixtureId:body.fixtureId};
  }
  /** Explicit opt-in to 120s local research, not an implicit STT/financial permission. */
  function enableExtendedReplay(body){
    assertRun(body);assertVersion(body);assertOpen();assertCallOngoing();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','consented','mode'].includes(k))||
       body.consented!==true||body.mode!=='EXTENDED_120S')
      throw new HttpError(400,'120초 실험에는 별도의 명시적 선택과 정확한 모드가 필요합니다.','VALIDATION_ERROR');
    if(!mayEnableExtendedReplay({scenarioId:run.scenarioId,step:run.step,endedAt:run.endedAt,
      voiceMode:run.voiceFixture.mode,eventCount:run.voiceFixture.eventCount,
      localSegmentCount:run.voiceFixture.localSegmentCount,captionActive:!!run.captionReplay,
      hasPending:!!ctx.pendingLocalStt,inFlight:ctx.localSttInFlight,
      transcriptCount:run.transcript.length,hasCanonicalEvents:run.canonicalEvents.length!==0}) ||
      run.voiceFixture.replayMode!=='STANDARD_40S')
      throw new HttpError(409,'새 정상 대화 사건에서 음성 입력 이전에만 120초 실험을 선택할 수 있습니다.','POLICY_DENIED');
    const p=getReplayPolicy('EXTENDED_120S');
    run.voiceFixture.replayMode=p.mode;run.voiceFixture.replayMaxSegments=p.maxSegments;
    addLog('REPLAY_POLICY_OPT_IN','사용자 명시 동의 · 120초/24구간 연구 모드 · 실제 STT/금융 실행 아님');
  }
  /** Optional, operator-enabled local-only ASR. Output is a pending, UNTRUSTED draft.
   * This cannot generate bank actions or canonical risk until human confirmation.
   * Never logs speech, audio, paths or private model output.
   */
  async function recognizeLocalStt(input){
    assertNotTextOnly();assertCallOngoing();
    if(!localStt)throw new HttpError(503,'로컬 음성 모델이 활성화되지 않았습니다.','STT_UNAVAILABLE');
    if(ctx.localSttInFlight)throw new HttpError(429,'로컬 음성 인식 진행 중','RATE_LIMITED');
    if(ctx.pendingLocalStt)throw new HttpError(409,'이전 STT 초안을 확정 또는 삭제한 다음 새 구간을 처리하세요.','POLICY_DENIED');
    const replayPolicy=getReplayPolicy(run.voiceFixture.replayMode);
    if(ctx.localSttRequests>=MAX_SESSION_STT_REQUESTS || run.voiceFixture.localSttAttempts>=replayPolicy.maxRequests)
      throw new HttpError(429,'사건 또는 세션의 로컬 STT 요청 한도를 초과했습니다.','RATE_LIMITED');
    // In long-form research, silence/repetition can legitimately yield identical PCM hashes
    // at different ordered offsets. Sequence+caseVersion protect against same-slot replay.
    if(run.voiceFixture.replayMode==='STANDARD_40S'&&ctx.localDigests.has(input.audio.inputDigest))
      throw new HttpError(409,'기본 모드에서 동일 오디오 재제출은 허용되지 않습니다.','COMMAND_REPLAY_CONFLICT');
    if(run.id!==input.runId||run.version!==input.expectedVersion)throw new HttpError(409,'사건 상태가 변경되었습니다.','CASE_VERSION_CONFLICT');
    assertOpen();
    if(run.step!==0||!['SCRIPTED','LOCAL_STT_USER_REVIEWED'].includes(run.voiceFixture.mode)||run.voiceFixture.eventCount!==0)
      throw new HttpError(409,'시나리오·자막·MOCK 전사와 실제 로컬 STT를 혼합할 수 없습니다.','POLICY_DENIED');
    const segmentIndex=run.voiceFixture.localSegmentCount;
    if(segmentIndex>=replayPolicy.maxSegments)throw new HttpError(429,'선택한 사건의 STT 구간 한도를 초과했습니다.','RATE_LIMITED');
    // A caller may supply explicit time metadata; it cannot rewrite earlier evidence or skip sequence.
    const proposedIndex=input.segmentIndex??segmentIndex;
    const proposedStartMs=input.segmentStartMs??run.voiceFixture.nextStartMs;
    if(proposedIndex!==segmentIndex||proposedStartMs!==run.voiceFixture.nextStartMs||
       !Number.isSafeInteger(proposedIndex)||!Number.isSafeInteger(proposedStartMs)||
       proposedStartMs+input.audio.durationMs>replayPolicy.maxDurationMs)
      throw new HttpError(409,'구간 번호·미디어 시간이 이전 확정 구간과 맞지 않습니다.','CASE_VERSION_CONFLICT');
    const previous=run;
    ctx.localSttInFlight=true;ctx.localSttRequests++;run.voiceFixture.localSttAttempts++;
    try{
      const result=await localStt.recognize(input.audio);
      if(ctx.run!==previous||run.id!==input.runId||run.version!==input.expectedVersion||run.endedAt||run.callEndedAt)
        throw new HttpError(409,'인식 중 사건이 변경되어 결과를 폐기했습니다.','CASE_VERSION_CONFLICT');
      const candidateId='local_'+unique();
      ctx.pendingLocalStt={candidateId,caseId:run.id,version:run.version,expiresAt:Date.now()+60_000,
        digest:result.inputDigest,text:result.text,segmentIndex:proposedIndex,startMs:proposedStartMs,
        endMs:proposedStartMs+input.audio.durationMs};
      const expiry=setTimeout(()=>{if(ctx.pendingLocalStt?.candidateId===candidateId)ctx.pendingLocalStt=null;},60_000);expiry.unref?.();
      return {...result,candidateId,caseId:run.id,caseVersion:run.version,segmentIndex:proposedIndex,
        segmentStartMs:proposedStartMs,segmentEndMs:proposedStartMs+input.audio.durationMs,
        notice:'로컬 STT 초안입니다. 실제 화자와 문장을 사용자가 확인하기 전에는 위험 판단에 사용되지 않습니다.'};
    }finally{ctx.localSttInFlight=false;}
  }
  function discardLocalStt(body){
    assertRun(body);assertVersion(body);
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','candidateId'].includes(k))||typeof body.candidateId!=='string')
      throw new HttpError(400,'초안 삭제 요청 형식 오류','VALIDATION_ERROR');
    if(ctx.pendingLocalStt?.candidateId===body.candidateId)ctx.pendingLocalStt=null;
    // No case state mutation, no text/voice in audit log.
  }
  function confirmLocalStt(body){
    assertRun(body);assertVersion(body);assertOpen();assertCallOngoing();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','candidateId','speaker','confirmedText','consented'].includes(k))||
      body.consented!==true||!['caller','user'].includes(body.speaker)||
      typeof body.confirmedText!=='string'||body.confirmedText.trim().length<1||body.confirmedText.length>800)
      throw new HttpError(400,'문장·화자 직접 확인이 필요합니다.','VALIDATION_ERROR');
    const pending=ctx.pendingLocalStt;
    if(!pending||Date.now()>=pending.expiresAt||pending.caseId!==run.id||pending.version!==run.version||
       pending.candidateId!==body.candidateId||pending.segmentIndex!==run.voiceFixture.localSegmentCount||
       pending.startMs!==run.voiceFixture.nextStartMs)
      throw new HttpError(409,'로컬 전사 확인 후보가 만료되거나 변경됐습니다.','CASE_VERSION_CONFLICT');
    const index=pending.segmentIndex;
    const turnId=`voice_local_${index}`;
    const eventId=`reviewed_local_${index}`;
    // Canonical Case Coordinator is authoritative; no MOCK fixture source impersonation.
    run.caseState=applyCaseEvent(run.caseState,{type:'UTTERANCE_FINAL',caseId:run.id,eventId,turnId,
      revision:0,absoluteIndex:index,speaker:body.speaker,text:body.confirmedText});
    run.canonicalEvents.push(makeCanonicalEvent({caseId:run.id,eventId,turnId,sequence:index,
      kind:'UTTERANCE_FINAL',source:'LOCAL_STT_HUMAN_REVIEWED',speaker:body.speaker,
      revision:0,startMs:pending.startMs,endMs:pending.endMs,status:'HUMAN_REVIEWED'}));
    run.transcript.push({turnId,index,speaker:body.speaker,text:body.confirmedText,
      cue:`로컬 STT 구간 ${index+1} · 사용자 검토 · 신원 검증 아님`,at:clock()});
    run.voiceFixture.mode='LOCAL_STT_USER_REVIEWED';run.voiceFixture.lastStatus='APPLIED_FINAL';
    run.voiceFixture.lastTurnId=turnId;run.voiceFixture.lastRevision=0;
    run.voiceFixture.localSegmentCount=index+1;run.voiceFixture.nextStartMs=pending.endMs;
    run.voiceFixture.finalCount=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE').length;
    run.bankArrivalConfirmed=false;run.bankHelpConsented=false;run.bankArrivalVersion=null;
    run.careInteraction=invalidateCareQuestion(run.careInteraction);
    ctx.localDigests.add(pending.digest);
    ctx.pendingLocalStt=null;
    addLog('LOCAL_STT_REVIEWED',`로컬 STT ${index+1}/${getReplayPolicy(run.voiceFixture.replayMode).maxSegments} 구간 확정 · 음성·원문 비기록 · 실제 금융 실행 없음`);
  }
  /** Explicit reviewed-local correction or retraction, never an ASR-generated action. */
  function reviseLocalStt(body){
    assertRun(body);assertVersion(body);assertOpen();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','turnId','revision','operation','speaker','text','consented'].includes(k))||
       body.consented!==true||!['CORRECT','RETRACT'].includes(body.operation)||
       !Number.isSafeInteger(body.revision)||body.revision<1||body.revision>1000||
       typeof body.turnId!=='string'||!/^voice_local_(?:0|[1-9]\d?)$/.test(body.turnId)||
       (body.operation==='CORRECT'&&(!['caller','user'].includes(body.speaker)||typeof body.text!=='string'||!body.text.trim()||body.text.length>800))||
       (body.operation==='RETRACT'&&(body.speaker!==undefined||body.text!==undefined)))
      throw new HttpError(400,'검토된 발화 정정·철회 명령 오류','VALIDATION_ERROR');
    if(run.voiceFixture.mode!=='LOCAL_STT_USER_REVIEWED'||ctx.pendingLocalStt)
      throw new HttpError(409,'사용자 검토된 로컬 STT 사건에서만 정정할 수 있습니다.','POLICY_DENIED');
    const old=run.caseState.checkpoint.turns.find(t=>t.turnId===body.turnId);
    if(!old||old.absoluteIndex>=getReplayPolicy(run.voiceFixture.replayMode).maxSegments||body.revision!==old.revision+1)
      throw new HttpError(409,'발화 버전 충돌 또는 잘못된 대상입니다.','CASE_VERSION_CONFLICT');
    const type=body.operation==='RETRACT'?'UTTERANCE_RETRACT':'UTTERANCE_FINAL';
    const eventId=`reviewed_local_${old.absoluteIndex}_revision_${body.revision}`;
    const event={type,caseId:run.id,eventId,turnId:body.turnId,revision:body.revision,
      ...(type==='UTTERANCE_FINAL'?{absoluteIndex:old.absoluteIndex,speaker:body.speaker,text:body.text}:{})};
    run.caseState=applyCaseEvent(run.caseState,event);
    const metadata=run.canonicalEvents.find(e=>e.turnId===body.turnId);
    run.canonicalEvents.push(makeCanonicalEvent({caseId:run.id,eventId,turnId:body.turnId,
      sequence:old.absoluteIndex,kind:type,source:'LOCAL_STT_HUMAN_REVIEWED',speaker:body.speaker??old.speaker,
      revision:body.revision,startMs:metadata?.startMs??0,endMs:metadata?.endMs??0,status:'HUMAN_REVIEWED'}));
    if(type==='UTTERANCE_RETRACT')run.transcript=run.transcript.filter(t=>t.turnId!==body.turnId);
    else run.transcript=run.transcript.map(t=>t.turnId===body.turnId?{...t,speaker:body.speaker,text:body.text,cue:'로컬 STT 사용자 정정 · 신원 검증 아님',at:clock()}:t);
    run.voiceFixture.lastTurnId=body.turnId;run.voiceFixture.lastRevision=body.revision;
    run.voiceFixture.lastStatus=type==='UTTERANCE_RETRACT'?'APPLIED_RETRACT':'APPLIED_FINAL';
    run.voiceFixture.finalCount=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE').length;
    run.bankArrivalConfirmed=false;run.bankHelpConsented=false;run.bankArrivalVersion=null;
    run.careInteraction=invalidateCareQuestion(run.careInteraction);
    addLog('LOCAL_STT_REVISED',`검토된 STT 발화 ${old.absoluteIndex+1}번 ${type==='UTTERANCE_RETRACT'?'철회':'정정'} · 금융 실행 없음`);
  }
  /** Sparse, previously observed subtitle benchmark. Never labels this as real ASR.
   * A tick contributes ONLY observations that occur by the current media cutoff.
   */
  function captionAdvance(body){
    assertNotTextOnly();assertRun(body);assertVersion(body);assertOpen();assertCallOngoing();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','fixtureId','consented'].includes(k))||
       body.consented!==true||!CAPTION_CASES.has(body.fixtureId))
      throw new HttpError(400,'등록된 관찰 자료와 명시적 동의가 필요합니다.','VALIDATION_ERROR');
    if(run.step!==0||run.scenarioId!=='benign'||
       !['SCRIPTED','CAPTION_OBSERVATION'].includes(run.voiceFixture.mode)||
       (run.captionReplay&&run.captionReplay.fixtureId!==body.fixtureId))
      throw new HttpError(409,'자막 실험은 새로운 정상 시나리오 사건에서만 단독 진행할 수 있습니다.','POLICY_DENIED');
    const source=CAPTION_CASES.get(body.fixtureId);
    const previous=run.captionReplay?.elapsedMs??0;
    if(previous>=Math.min(MAX_CAPTION_MS,source.durationMs))
      throw new HttpError(409,'자막 관찰 체크포인트가 모두 종료됐습니다.','POLICY_DENIED');
    const elapsedMs=Math.min(previous+CAPTION_STEP_MS,MAX_CAPTION_MS,source.durationMs);
    const arrived=source.observations.filter(o=>o.observedAtMs>previous&&o.observedAtMs<=elapsedMs);
    if(run.canonicalEvents.length+arrived.length>80)throw new HttpError(429,'사건 기록 한도 초과','RATE_LIMITED');
    for(const observation of arrived){
      const index=source.observations.indexOf(observation);
      const turnId=`caption_${index}`;
      const eventId=`caption_final_${index}`;
      run.caseState=applyCaseEvent(run.caseState,{type:'UTTERANCE_FINAL',caseId:run.id,
        eventId,turnId,revision:0,absoluteIndex:index,speaker:observation.speaker,text:observation.text});
      run.canonicalEvents.push(makeCanonicalEvent({caseId:run.id,eventId,turnId,sequence:index,
        kind:'UTTERANCE_FINAL',source:'SPARSE_CAPTION_OBSERVATION_NOT_STT',speaker:observation.speaker,
        revision:0,startMs:Math.max(0,observation.observedAtMs-CAPTION_STEP_MS),
        endMs:observation.observedAtMs,status:'CAPTION_ONLY'}));
      run.transcript.push({turnId,index,speaker:observation.speaker,text:observation.text,
        cue:`약 ${Math.round(observation.observedAtMs/1000)}초 화면 자막 관찰 · 실제 STT 아님`,at:clock()});
      run.bankArrivalConfirmed=false;run.bankHelpConsented=false;run.bankArrivalVersion=null;
    }
    run.captionReplay={fixtureId:body.fixtureId,elapsedMs,observations:run.transcript.length,
      contextEvidence:extractContextEvidence(source.observations.filter(o=>o.observedAtMs<=elapsedMs)).map(({code,observedAtMs})=>({code,observedAtMs})),
      provenance:'MANUALLY_OBSERVED_SUBTITLE_FRAMES_NOT_STT',actualStt:false,metaCalled:false};
    run.captionReplay.provisionalAdvisory=deriveCaptionAdvisory(run.captionReplay.contextEvidence);
    run.voiceFixture.mode='CAPTION_OBSERVATION';run.voiceFixture.lastStatus='CAPTION_ONLY';
    run.voiceFixture.finalCount=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE').length;
    if(arrived.length)run.careInteraction=invalidateCareQuestion(run.careInteraction);
    addLog('CAPTION_TICK',`자막 스냅샷 ${elapsedMs/1000}초까지 ${arrived.length}건 반영 · STT 미사용`);
  }
  /** A safe read-only mock interpretation using the existing canonical scorer. */
  async function voiceReview(){
    if(!['FIXTURE','LOCAL_STT_USER_REVIEWED','CAPTION_OBSERVATION'].includes(run.voiceFixture.mode))return {mode:'MOCK',status:'NO_FIXTURE',metaCalled:false};
    const active=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE');
    const byId=new Map(run.transcript.map(t=>[t.turnId,t]));
    const turns=active.map(t=>byId.get(t.turnId)).filter(Boolean).map(t=>({turnId:t.turnId,speaker:t.speaker,text:t.text}));
    if(!turns.length)return {mode:'MOCK',status:'NO_ACTIVE_EVIDENCE',metaCalled:false};
    const caseBefore=run.caseState,runBefore=run.id,versionBefore=run.version;
    const analysisResult=await reviewActiveEvidence({state:caseBefore,turns});
    // Never mix a prior model response with the current case after an async boundary.
    if(run.id!==runBefore||run.version!==versionBefore||run.caseState!==caseBefore)
      return {mode:'MOCK',status:'STALE_REVIEW',metaCalled:false,actualStt:false,
        message:'사건이 변경되어 이전 분석 결과를 폐기했습니다. 새로 조회하세요.'};
    if(!analysisResult.analysis)return {mode:'MOCK',status:'NO_ACTIVE_EVIDENCE',metaCalled:false,actualStt:false};
    const intervention=deriveIntervention(run.caseState,{cardDetailsExposedByUser:run.cardExposureReported});
    const evidenceIds=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&t.signals.length).map(t=>t.turnId);
    const candidates=[];
    if(evidenceIds.length&&intervention.canSuggestMockCardLock)candidates.push({kind:'OFFER_MOCK_CARD_LOCK',caseId:run.id,stateVersion:run.version,evidenceIds,cardRef:'DEMO_CARD_1'});
    if(evidenceIds.length&&intervention.canSuggestMockTransferHold)candidates.push({kind:'OFFER_MOCK_TRANSFER_HOLD',caseId:run.id,stateVersion:run.version,evidenceIds,transferRef:'DEMO_TRANSFER_1'});
    const suggestions=candidates.map(p=>({kind:p.kind,decision:evaluateToolProposal(p,run.caseState,run.version,{cardExposureReported:run.cardExposureReported})}));
    return {mode:'MOCK',status:'REVIEWED',metaCalled:false,actualStt:false,caseId:run.id,caseVersion:run.caseState.version,
      analysisMode:'MOCK',model:'RULE_DERIVED_MOCK',analysis:analysisResult.analysis,reviewStatus:analysisResult.status,toolSuggestions:suggestions,
      message:'기존 규칙 분석의 MOCK 변환입니다. AI LIVE·실제 음성인식·금융 실행은 수행되지 않았습니다.'};
  }
  function action(body){assertRun(body);assertVersion(body);assertOpen();
    if(!CLEAN_ACTIONS.has(body.action))throw new HttpError(400,'허용되지 않은 가상 행동');
    if(body.action==='SIMULATED_TRANSFER'){
      const gate=protectionDecision({riskBand:getCaseView(run.caseState).assessment.riskBand,location:run.location,ended:!!run.endedAt});
      if(gate.blocked){
        media.pushEvent(ctx,'SAFEBANK_TRANSFER_DENIED',PROVENANCE.SIMULATED_BANK_HOLD,{reason:gate.reason,scope:gate.scope,realBankControlled:false});
        throw new HttpError(409,'이 송금은 막혀 있습니다. 은행 앱에서 직접 확인하세요.','POLICY_DENIED');
      }
      if(run.actions.at(-1)?.kind==='SIMULATED_TRANSFER'&&run.actions.at(-1)?.step===run.step)return;
      media.pushEvent(ctx,'SAFEBANK_TRANSFER_ALLOWED',PROVENANCE.SIMULATED_BANK_HOLD,{reason:gate.reason,realMoneySent:false},{publish:false});
      recordAction('SIMULATED_TRANSFER','가상 송금 시도 기록 — 실제 돈은 보내지지 않음');
      run.caseState=applyCaseEvent(run.caseState,{type:'USER_ACTION',caseId:run.id,
        eventId:`transfer_${unique()}`,action:'TRANSFER_PREPARED'});
    }else if(body.action==='CARD_EXPOSURE_REPORTED'){run.cardExposureReported=true;recordAction('CARD_EXPOSURE_REPORTED','사용자의 카드 정보 노출 우려 자기보고 · 실제 유출 인증 아님 · 카드번호 수집 없음');}
    else if(body.action==='STOP_TRANSFER')recordAction('STOP_TRANSFER','사용자가 송금을 보류하기로 선택함');
    else if(body.action==='EMERGENCY_HELP')recordAction('EMERGENCY_HELP','긴급 도움 안내를 확인함 — 실제 신고 없음');
    else if(body.action==='END_CALL'){if(run.callEndedAt)throw new HttpError(409,'이미 통화가 종료됐습니다.','POLICY_DENIED');media.stop(ctx,'CALL_ENDED');ctx.metaController?.abort();ctx.metaController=null;ctx.metaQueued=false;if(['PENDING','WAITING_LATEST'].includes(run.meta.status))run.meta.status='CANCELLED_ON_END';ctx.pendingLocalStt=null;run.callEndedAt=clock();recordAction('END_CALL','가상 통화 종료 · 후속 보호 점검 시작 · 실제 통신 제어 없음');}
    else if(body.action==='RECOVERY_OPEN')recordAction('RECOVERY_OPEN','피해 이후 가상 대응 안내 확인');
  }
  /** Fixture only: no access to device SMS, no arbitrary URL input, no outgoing network. */
  function receiveMessageFixture(body){
    assertRun(body);assertVersion(body);assertOpen();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','fixtureId','consented'].includes(k))||
      body.consented!==true||!Object.hasOwn(MESSAGE_FIXTURES,body.fixtureId))
      throw new HttpError(400,'등록된 MOCK 메시지 및 명시적 시연 동의가 필요합니다.','VALIDATION_ERROR');
    if(run.messages.length>=MAX_MESSAGE_FIXTURES)throw new HttpError(429,'가상 수신함 한도 초과','RATE_LIMITED');
    if(run.messages.some(x=>x.fixtureId===body.fixtureId))throw new HttpError(409,'이미 추가된 가상 메시지입니다.','POLICY_DENIED');
    run.messages.push({id:'msg_'+unique(),fixtureId:body.fixtureId,receivedAt:clock()});
    addLog('MOCK_MESSAGE_RECEIVED',`등록된 가상 메시지 ${body.fixtureId} · 외부 SMS 접근 없음`);
  }
  function currentMessages(){
    const view=getCaseView(run.caseState);
    const evidenceIds=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&t.signals.length).map(t=>t.turnId);
    return projectMessages(run.messages,view.assessment.riskBand,{reviews:run.messageReviews,
      caseVersion:run.caseState.version,evidenceIds});
  }
  /** Explicit self-reported review; only call-risk contextual quarantine can be temporarily lifted. */
  function reviewMessage(body){
    assertRun(body);assertOpen();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','reviewId','messageId','action','reason','confirmed'].includes(k))||
       typeof body.reviewId!=='string'||!/^msg_review_[a-zA-Z0-9_-]{8,64}$/.test(body.reviewId)||
       typeof body.messageId!=='string'||!['RELEASE_PREVIEW','REVOKE'].includes(body.action))
      throw new HttpError(400,'메시지 재검토 명령 형식 오류','VALIDATION_ERROR');
    const replay=run.messageReviews.find(r=>r.reviewId===body.reviewId);
    if(replay){if(replay.messageId!==body.messageId||replay.action!==body.action||replay.reason!==body.reason||body.confirmed!==true)
      throw new HttpError(409,'다른 내용으로 재사용된 검토 요청','COMMAND_REPLAY_CONFLICT');return;}
    assertVersion(body);
    const message=currentMessages().find(m=>m.id===body.messageId);
    if(!message||!message.link)throw new HttpError(404,'검토 가능한 메시지가 없습니다.','VALIDATION_ERROR');
    if(run.messageReviews.length>=MAX_MESSAGE_REVIEWS)throw new HttpError(429,'메시지 재검토 한도 초과','RATE_LIMITED');
    if(body.action==='RELEASE_PREVIEW'){
      const base=classifyMessage(message.fixtureId,{caseRiskBand:getCaseView(run.caseState).assessment.riskBand});
      if(base.reasonCode!=='CALL_RISK_CONTEXT'||base.verdict!=='QUARANTINED')
        throw new HttpError(409,'문장 또는 링크 자체에 위험 신호가 있어 이 방법으로는 해제할 수 없습니다.','POLICY_DENIED');
      if(body.confirmed!==true||body.reason!=='INDEPENDENT_OFFICIAL_CHECK_SELF_REPORTED')
        throw new HttpError(400,'독립 공식 경로 확인 자기보고와 명시적 동의가 필요합니다.','VALIDATION_ERROR');
    }else if(body.action==='REVOKE'){
      if(body.reason!=='USER_REVOKED'||body.confirmed!==true)throw new HttpError(400,'철회 확인이 필요합니다.','VALIDATION_ERROR');
    }
    const at=clock();
    run.messageReviews.push({reviewId:body.reviewId,messageId:body.messageId,action:body.action,reason:body.reason,
      caseVersion:run.caseState.version,at,expiresAt:body.action==='RELEASE_PREVIEW'?new Date(Date.parse(at)+REVIEW_TTL_MS).toISOString():null});
    addLog('MESSAGE_REVIEW',`${body.action} · 사용자 자기보고 · 실제 URL 접근·신원 확인 없음`);
  }
  function attemptMessageLink(body){
    assertRun(body);assertOpen();
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','messageId','attemptId'].includes(k))||
      typeof body.attemptId!=='string'||!/^msg_attempt_[a-zA-Z0-9_-]{8,64}$/.test(body.attemptId)||
      typeof body.messageId!=='string')throw new HttpError(400,'허용되지 않은 메시지 명령','VALIDATION_ERROR');
    const repeated=run.messageAttempts.find(a=>a.attemptId===body.attemptId);
    if(repeated){if(repeated.messageId!==body.messageId)throw new HttpError(409,'동일 요청 ID의 다른 메시지 요청을 차단했습니다.','COMMAND_REPLAY_CONFLICT');return;}
    assertVersion(body);
    const message=run.messages.find(m=>m.id===body.messageId);
    if(!message)throw new HttpError(404,'메시지 없음','VALIDATION_ERROR');
    if(!MESSAGE_FIXTURES[message.fixtureId].link)throw new HttpError(409,'링크가 없는 메시지입니다.','POLICY_DENIED');
    if(run.messageAttempts.length>=MAX_MESSAGE_ATTEMPTS)throw new HttpError(429,'시연 요청 제한','RATE_LIMITED');
    const verdict=currentMessages().find(m=>m.id===body.messageId);
    const blocked=verdict.verdict==='QUARANTINED';
    run.messageAttempts.push({attemptId:body.attemptId,messageId:body.messageId,blocked,reason:verdict.reasonCode,at:clock()});
    addLog(blocked?'MOCK_LINK_BLOCKED':'MOCK_LINK_PREVIEW_ONLY',`${verdict.reasonCode} · 실제 링크 열기·웹 요청 없음`);
  }
  function postCallAnswer(body){
    assertRun(body);assertVersion(body);assertOpen();
    if(!run.callEndedAt)throw new HttpError(409,'가상 통화를 종료한 뒤 후속 점검을 시작할 수 있습니다.','POLICY_DENIED');
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','question','answer'].includes(k))||
      !Object.hasOwn(EXPOSURE_QUESTIONS,body.question)||!['YES','NO','UNSURE'].includes(body.answer))
      throw new HttpError(400,'후속 점검 질문 또는 답변 오류','VALIDATION_ERROR');
    if(run.postCall.answers[body.question]===body.answer)return;
    run.postCall.answers[body.question]=body.answer;
    // Preserve completed tasks that remain applicable; remove obsolete completions.
    const assessment=getCaseView(run.caseState).assessment;
    const currentPlan=derivePostCallPlan({callEndedAt:run.callEndedAt,endedAt:run.endedAt,
      riskBand:assessment.riskBand,emergency:assessment.emergencyFlag,answers:run.postCall.answers,
      cardExposureReported:run.cardExposureReported,
      messageVerdicts:currentMessages().map(m=>m.verdict)});
    const applicable=new Set(currentPlan.steps.map(x=>x.id));
    for(const taskId of Object.keys(run.postCall.taskStates))if(!applicable.has(taskId))delete run.postCall.taskStates[taskId];
    addLog('POSTCALL_EXPOSURE_ANSWER','후속 노출 자기보고 항목 변경 · 세부 응답 로그 기록 금지 · 외부 조치 없음');
  }
  function postCallTask(body){
    assertRun(body);assertOpen();
    if(!run.callEndedAt)throw new HttpError(409,'통화 종료 후에만 후속 조치를 기록할 수 있습니다.','POLICY_DENIED');
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','eventId','taskId','status'].includes(k))||
      typeof body.eventId!=='string'||!/^pc_[a-zA-Z0-9_-]{8,64}$/.test(body.eventId)||
      !['TODO','DONE','NOT_APPLICABLE'].includes(body.status))throw new HttpError(400,'후속 조치 형식 오류','VALIDATION_ERROR');
    const replay=run.postCall.eventIds.find(x=>x.id===body.eventId);
    if(replay){if(replay.taskId!==body.taskId||replay.status!==body.status)throw new HttpError(409,'후속 조치 중복 충돌','COMMAND_REPLAY_CONFLICT');return;}
    assertVersion(body);
    if(run.postCall.eventIds.length>=MAX_FOLLOWUP_EVENTS)throw new HttpError(429,'후속 기록 한도 초과','RATE_LIMITED');
    const band=getCaseView(run.caseState).assessment.riskBand;
    const plan=derivePostCallPlan({callEndedAt:run.callEndedAt,endedAt:run.endedAt,riskBand:band,
      emergency:getCaseView(run.caseState).assessment.emergencyFlag,answers:run.postCall.answers,taskStates:run.postCall.taskStates,cardExposureReported:run.cardExposureReported,
      messageVerdicts:currentMessages().map(m=>m.verdict)});
    if(!plan.steps.some(x=>x.id===body.taskId))throw new HttpError(409,'현재 후속 점검에 없는 단계','POLICY_DENIED');
    run.postCall.taskStates[body.taskId]=body.status;
    run.postCall.eventIds.push({id:body.eventId,taskId:body.taskId,status:body.status});
    addLog('POSTCALL_TASK','후속 점검 체크 상태 변경 · 세부 응답 로그 기록 금지 · 외부 조치 없음');
  }
  function exportPostCall(body){
    assertRun(body);assertVersion(body);
    if(!run.callEndedAt)throw new HttpError(409,'통화 종료 후에만 복구 기록을 내보낼 수 있습니다.','POLICY_DENIED');
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','passphrase','consented'].includes(k))||body.consented!==true)
      throw new HttpError(400,'본인 동의가 필요합니다.','VALIDATION_ERROR');
    if((ctx.capsuleOps??0)>=MAX_POSTCALL_CAPSULE_OPS)throw new HttpError(429,'이번 세션의 암호화 백업 요청 한도를 초과했습니다.','RATE_LIMITED');
    ctx.capsuleOps=(ctx.capsuleOps??0)+1;
    try{return {mode:'USER_MANAGED_ENCRYPTED_CAPSULE',capsule:createRecoveryCapsule({answers:run.postCall.answers,taskStates:run.postCall.taskStates},body.passphrase),
      disclaimer:'브라우저 밖에 직접 보관하는 암호화된 MOCK 자기보고만 포함됩니다. 실제 금융 처리·계정 상태는 복구하지 않습니다.'};}
    catch(e){throw new HttpError(400,e.message==='INVALID_PASSPHRASE'?'12자 이상 암호가 필요합니다.':'복구 백업을 만들 수 없습니다.','VALIDATION_ERROR');}
  }
  function importPostCall(body){
    assertRun(body);assertVersion(body);assertOpen();
    if(!run.callEndedAt)throw new HttpError(409,'새 가상 통화를 종료한 후 복원하세요.','POLICY_DENIED');
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','passphrase','capsule','consented'].includes(k))||body.consented!==true)
      throw new HttpError(400,'복원에 명시적 동의가 필요합니다.','VALIDATION_ERROR');
    if(run.postCall.restoredFrom||Object.keys(run.postCall.answers).length||Object.keys(run.postCall.taskStates).length||run.postCall.eventIds.length)
      throw new HttpError(409,'기존 후속 점검이 존재하므로 덮어쓰기를 거부했습니다.','POLICY_DENIED');
    if((ctx.capsuleOps??0)>=MAX_POSTCALL_CAPSULE_OPS)throw new HttpError(429,'이번 세션의 암호화 백업 요청 한도를 초과했습니다.','RATE_LIMITED');
    ctx.capsuleOps=(ctx.capsuleOps??0)+1;
    let restored;
    try{restored=openRecoveryCapsule(body.capsule,body.passphrase);}catch{
      throw new HttpError(400,'복구 자료가 잘못됐거나 만료됐거나 암호가 일치하지 않습니다.','VALIDATION_ERROR');}
    run.postCall.answers=restored.answers;
    const view=getCaseView(run.caseState).assessment;
    const plan=derivePostCallPlan({callEndedAt:run.callEndedAt,endedAt:run.endedAt,riskBand:view.riskBand,
      emergency:view.emergencyFlag,answers:restored.answers,cardExposureReported:run.cardExposureReported,messageVerdicts:currentMessages().map(m=>m.verdict)});
    const applicable=new Set(plan.steps.map(x=>x.id));
    run.postCall.taskStates=Object.fromEntries(Object.entries(restored.taskStates).filter(([k])=>applicable.has(k)));
    run.postCall.restoredFrom='USER_ENCRYPTED_CAPSULE_SELF_REPORTED';
    addLog('POSTCALL_RESTORED','명시적 복원 · 별도 사건의 자기보고만 복구 · 금융·전화 상태 복원 없음');
  }
  function deletePostCall(body){
    assertRun(body);assertVersion(body);
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','scope','confirmed'].includes(k))||
       body.scope!=='POSTCALL_ONLY'||body.confirmed!==true)throw new HttpError(400,'후속 자기보고 기록 삭제 확인이 필요합니다.','VALIDATION_ERROR');
    run.postCall={answers:{},taskStates:{},eventIds:[],restoredFrom:null};
    run.log=run.log.filter(x=>!['POSTCALL_EXPOSURE_ANSWER','POSTCALL_TASK','POSTCALL_RESTORED'].includes(x.type));
    addLog('POSTCALL_DELETED','후속 점검 자기보고 데이터 삭제 · 이미 내보낸 파일은 사용자 관리 대상');
  }
  function bankCommand(body){
    assertRun(body);
    // Retry after a successful response was lost: unchanged outcome, no duplicate log or revision.
    // Exact identity and processed ID are required. A changed payload is never re-executed.
    if((body.type==='HOLD'||body.type==='CANCEL') && typeof body.commandId==='string'){
      const existing=run.safeBank.processedCommands.find(x=>x.id===body.commandId);
      if(existing){
        const same=existing.fingerprint===JSON.stringify([body.type,run.id,run.safeBank.caseVersion,body.expectedBankRevision,body.confirmed===true,true]);
        if(!same)throw new HttpError(409,'Conflicting SafeBank command replay','COMMAND_REPLAY_CONFLICT');
        return;
      }
      if(run.safeBank.processedIds.includes(body.commandId))throw new HttpError(409,'Ambiguous legacy command replay','COMMAND_REPLAY_CONFLICT');
    }
    assertVersion(body);assertOpen();
    if(!['ARRIVAL_CONFIRM','ASSIST_CONSENT','HOLD','CANCEL'].includes(body.type))
      throw new HttpError(400,'Unknown SafeBank demo command');
    const view=getCaseView(run.caseState);
    const caseVersion=run.caseState.version;
    const activeIds=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&t.signals.length).map(t=>t.turnId);
    if(body.type==='ARRIVAL_CONFIRM'){
      if(body.confirmed!==true)throw new HttpError(400,'Explicit arrival confirmation required');
      run.bankArrivalConfirmed=true;run.bankHelpConsented=false;
      run.bankArrivalVersion=caseVersion;
      addLog('BANK_ARRIVAL_SELF_REPORTED','User reported arrival; not independently verified');return;
    }
    if(body.type==='ASSIST_CONSENT'){
      if(body.confirmed!==true||!run.bankArrivalConfirmed||run.bankArrivalVersion!==caseVersion||view.assessment.riskBand==='LOW'||activeIds.length===0||view.assessment.emergencyFlag)
        throw new HttpError(409,'긴급 상황이거나 도착·동의 조건이 충족되지 않아 직원 안내 동의를 진행할 수 없습니다.','POLICY_DENIED');
      run.bankHelpConsented=true;addLog('BANK_HELP_CONSENT','User opted into fictional staff guidance');return;
    }
    const arrival=decideBankArrival({caseId:run.id,stateVersion:caseVersion,caseOpen:!run.endedAt,
      riskIndex:view.assessment.riskIndex,detected:view.assessment.riskBand!=='LOW'&&activeIds.length>0,
      activeEvidenceIds:activeIds,evidenceVersion:caseVersion,country:run.jurisdiction==='US'?'US':'KR',
      arrivalEvidence:run.bankArrivalConfirmed?'USER_CONFIRMED':'NONE',
      arrivalCaseId:run.bankArrivalConfirmed?run.id:null,arrivalVersion:run.bankArrivalVersion??null,
      locationConsent:false,locationTimestampMs:null,nowMs:Date.now(),bankPlaceVerified:false,
      physicalEmergency:view.assessment.emergencyFlag,userWantsHelp:run.bankHelpConsented});
    // Cancellation of a previous fictional hold remains possible after arrival evidence expires.
    if(body.type==='HOLD'&&!arrival.allowBankSimulation)throw new HttpError(409,'위험 근거, 도착(arrival) 확인, 직원 동의가 모두 충족되어야 가상 보류를 진행할 수 있습니다.','POLICY_DENIED');
    if(body.type==='HOLD'&&run.safeBank.status==='READY'&&run.safeBank.caseVersion!==caseVersion)
      run.safeBank=createDemoBankState(run.id,caseVersion);
    const result=applyDemoBankCommand(run.safeBank,{
      id:body.commandId,type:body.type,caseId:run.id,caseVersion:run.safeBank.caseVersion,
      expectedRevision:body.expectedBankRevision,userConfirmed:body.confirmed===true,caseOpen:!run.endedAt});
    if(result.reason==='DUPLICATE')return;
    if(!result.applied)throw new HttpError(409,'SafeBank demo rejected: '+result.reason,result.reason==='STALE'?'CASE_VERSION_CONFLICT':'POLICY_DENIED');
    run.safeBank=result.state;
    addLog('SAFE_BANK_'+body.type,'MOCK only: no real bank or card operation');
  }
  /** Separate MOCK card ledger; never conflates card controls with a bank transfer hold. */
  function cardCommand(body){
    assertRun(body);
    if(!body||Object.keys(body).some(k=>!['runId','expectedVersion','action','cardRef','confirmed','commandId','expectedCardRevision'].includes(k))||!['LOCK','UNLOCK'].includes(body.action)||typeof body.commandId!=='string')
      throw new HttpError(400,'지원하지 않는 가상 카드 명령','VALIDATION_ERROR');
    // Replays MUST be evaluated against the original command before version checks.
    const assessment=getCaseView(run.caseState).assessment;
    if(body.action==='UNLOCK'&&assessment.emergencyFlag)
      throw new HttpError(409,'긴급 상황에서는 가상 카드 잠금을 해제할 수 없습니다.','EMERGENCY_LOCK');
    if(body.action==='UNLOCK'&&assessment.riskBand==='HIGH'&&['NEAR_BANK','AT_BANK'].includes(run.location.zone))
      throw new HttpError(409,'가상 은행 근처의 송금 위험이 이어지는 동안 가상 카드 잠금을 해제할 수 없습니다.','PROXIMITY_LOCK');
    const attempt={id:body.commandId,caseId:run.id,cardRef:body.cardRef,action:body.action,
      expectedRevision:body.expectedCardRevision,userConfirmed:body.confirmed===true,caseOpen:true};
    const result=applyMockCardCommand(run.mockCard,attempt);
    if(result.reason==='DUPLICATE')return;
    if(result.reason==='CONFLICT')throw new HttpError(409,'가상 카드 명령 ID 재사용 내용이 다릅니다.','COMMAND_REPLAY_CONFLICT');
    assertVersion(body);assertOpen();
    if(result.reason==='STALE')throw new HttpError(409,'가상 카드 상태가 변경되었습니다.','CASE_VERSION_CONFLICT');
    if(result.reason!=='APPLIED')throw new HttpError(result.reason==='CONSENT_REQUIRED'?409:400,
      '사용자 확인 또는 가상 카드 상태 조건이 충족되지 않았습니다.','POLICY_DENIED');
    run.mockCard=result.state;
    addLog('MOCK_CARD_'+body.action,'사용자 명시 확인 · 가상 카드 전용 · 실제 카드/계좌이체 영향 없음');
  }
  /** AI can propose a guidance/button, but never execute any bank/card command. */
  function proposeTool(body){
    assertRun(body);assertVersion(body);assertOpen();
    const result=evaluateToolProposal(body.proposal,run.caseState,run.version,{cardExposureReported:run.cardExposureReported});
    run.toolAudit.push({result:result.accepted?'ACCEPTED':'DENIED',reason:result.reason,at:clock(),mode:'SCRIPTED_MOCK'});
    if(run.toolAudit.length>40)run.toolAudit.shift();
    if(!result.accepted)throw new HttpError(409,'AI 도구 제안을 적용하지 않았습니다: '+result.reason,'POLICY_DENIED');
    // Keep only narrow, verified fields; never record prompt, raw speech or arbitrary URLs.
    const proposal=body.proposal;
    run.toolProposals.push({kind:proposal.kind,evidenceIds:[...proposal.evidenceIds],stateVersion:run.version,
      detail:proposal.actionCode||proposal.cardRef||proposal.transferRef,mode:'SCRIPTED_MOCK'});
    if(run.toolProposals.length>20)run.toolProposals.shift();
    addLog('TOOL_PROPOSAL_ACCEPTED','모델이 아닌 데모 입력의 제안 검증 완료 · 실행 명령 아님');
  }
  function setJurisdiction(body){assertRun(body);assertVersion(body);assertOpen();
    if(!['KR','US','UNKNOWN'].includes(body.jurisdiction))throw new HttpError(400,'지원하지 않는 국가 선택');
    if(run.jurisdiction===body.jurisdiction)return;
    run.jurisdiction=body.jurisdiction;run.jurisdictionSource='USER_SELECTED_UNVERIFIED';
    // Country-dependent staff guidance needs a fresh opt-in after changing jurisdiction.
    run.bankHelpConsented=false;
    addLog('JURISDICTION','사용자가 국가별 안내를 직접 선택함 · 실제 위치/신원 검증 아님');
  }
  function careCheckIn(body){assertRun(body);assertVersion(body);assertOpen();
    if(run.mode==='warning')throw new HttpError(403,'일반 경고 대조군에서는 사전 케어를 제공하지 않습니다.');
    if(!Object.hasOwn(CARE_CONCERNS,body.concern))throw new HttpError(400,'선택할 수 없는 안전 고민입니다.');
    if(run.concern?.type===body.concern)return;
    const beforeObservedMoneyRequest=!run.caseState.checkpoint.turns.some(t=>t.status==='ACTIVE'&&
      t.speaker==='caller'&&t.signals.some(sig=>sig.code==='MONEY_REQUEST'));
    run.concern={type:body.concern,label:CARE_CONCERNS[body.concern],at:clock(),step:run.step,
      beforeObservedMoneyRequest};
    recordAction('CARE_CHECK_IN',`사용자 직접 선택: ${run.concern.label} · 확인된 발화 증거 아님`);
  }
  function careQuestionEvent(body){
    assertRun(body);
    if(run.mode==='warning')throw new HttpError(403,'일반 경고 대조군은 안전 질문 기능이 없습니다.');
    // Exact event replay is idempotent even if the overall case has since moved.
    const replay=run.careInteraction.events.find(e=>e.eventId===body.eventId);
    if(!replay)assertVersion(body);
    if(run.endedAt&&!replay)throw new HttpError(409,'종료된 사건은 새로운 질문을 받을 수 없습니다.');
    const caseView=getCaseView(run.caseState);
    const guidance=selectLiveGuidance({caseState:run.caseState,jurisdiction:run.jurisdiction});
    const decision=nextCareQuestion({caseState:run.caseState,interaction:run.careInteraction,
      emergency:caseView.assessment.emergencyFlag,earlyEvidence:deriveEarlyCareEvidence(run.caseState),
      guidance,concern:run.concern,actions:run.actions,endedAt:run.endedAt,remoteStatusFollowup:ctx!==legacy});
    let next;
    try{next=applyCareInteractionEvent(run.careInteraction,{...body,caseId:body.runId},{caseState:run.caseState,decision});}
    catch(e){throw new HttpError(e.status||400,e.message);}
    if(next===run.careInteraction)return;
    run.careInteraction=next;
    const types={CARE_QUESTION_PRESENTED:'선택형 질문 표시',CARE_QUESTION_ANSWERED:'선택형 질문에 사용자가 직접 답함 (미검증)',
      CARE_QUESTION_SKIPPED:'질문 건너뜀',CARE_QUESTION_DISMISSED:'질문 닫음',CARE_SCREEN_UNSAFE_REPORTED:'화면이 안전하지 않다는 자기 보고 · 질문 중단'};
    addLog('CARE_INTERACTION',`${types[body.type]||'케어 상호작용'} · 자동 탐지 증거가 아님`);
  }
  function verificationRequest(body){assertRun(body);assertVersion(body);assertOpen();
    if(run.mode!=='verified')throw new HttpError(403,'이 실험 모드에서는 가족 확인이 제공되지 않습니다.');
    if(run.verification?.status==='REQUESTED')return; // dedupe within current case
    if(run.verification)throw new HttpError(409,'이미 안전 확인 요청을 처리한 사건입니다.');
    run.verification={requestId:'req_'+unique(),status:'REQUESTED',createdAt:clock(),respondedAt:null,
      note:'미확인 · 등록된 가상 자녀 화면만 표시'};
    recordAction('VERIFY_REQUESTED','가상 자녀 브라우저에 확인 요청 생성 — 실제 연락 없음');
  }
  function verificationExpire(body){assertRun(body);assertVersion(body);assertOpen();
    if(!run.verification||run.verification.status!=='REQUESTED')throw new HttpError(409,'만료할 확인 요청이 없습니다.');
    run.verification={...run.verification,status:'EXPIRED',respondedAt:clock(),note:'응답이 없음 · 실제 위해 여부 미확인'};
    recordAction('VERIFY_TIMEOUT','가상 가족 응답 없음 · 위험 여부는 확정하지 않음');
  }
  function verificationResponse(body){assertRun(body);assertVersion(body);assertOpen();
    if(!run.verification||run.verification.status!=='REQUESTED')throw new HttpError(409,'대기 중인 확인 요청이 없습니다.');
    if(body.requestId!==run.verification.requestId)throw new HttpError(409,'요청 ID 불일치');
    if(!VERIFY_RESPONSES.has(body.response))throw new HttpError(400,'허용되지 않은 확인 응답');
    run.verification={...run.verification,status:body.response,respondedAt:clock(),note:
      body.response==='SELF_REPORTED_SAFE'?'가상 자녀가 안전하다고 자가 보고함 · 안전 증명 아님':
      body.response==='HELP_REQUESTED'?'가상 자녀가 도움을 요청함 · 실제 안전 조치 필요 가능성':
      '가상 자녀가 상태를 확인할 수 없다고 응답함'};
    recordAction('VERIFY_RESPONSE',run.verification.note);
  }
  function recoveryEvent(body){
    assertRun(body);
    if(run.mode==='warning')throw new HttpError(403,'일반 경고 대조군은 회복 케어 기능을 제공하지 않습니다.');
    // Allow exact duplicate event replay even when a newer version was published;
    // all new operations still require the latest main and recovery revisions.
    const already=run.recovery.events.find(e=>e.eventId===body.eventId);
    if(!already)assertVersion(body);
    const next=applyRecoveryEvent(run.recovery,{caseId:body.runId,eventId:body.eventId,
      type:body.type,pathId:body.pathId,stepId:body.stepId,status:body.status,
      expectedRecoveryVersion:body.expectedRecoveryVersion});
    if(next===run.recovery)return;
    run.recovery=next;
    addLog('RECOVERY_PROGRESS',`${body.type} · 사용자 체크 기록만 저장 · 실제 조치 검증 아님`);
  }
  function guidedEvent(body){
    assertRun(body);
    if(run.mode==='warning')throw new HttpError(403,'일반 경고 대조군은 단계별 케어 기능을 제공하지 않습니다.');
    const duplicate=run.guided.events.some(e=>e.eventId===body.eventId);
    if(!duplicate)assertVersion(body);
    const assessment=getCaseView(run.caseState).assessment;
    const safety=deriveActiveCare(run.careInteraction);
    // A user cannot mark financial/identity recovery as completed while a screen is unsafe
    // or when an emergency takes precedence. They can still pause or close the journey.
    if(!duplicate&&['GUIDED_STEP_RESULT','GUIDED_CONTEXT_SET'].includes(body.type)&&
       (assessment.emergencyFlag||safety.screenUnsafe||Object.values(run.guided.contexts).some(x=>x.screenUnsafe===true))){
      if(!(body.type==='GUIDED_CONTEXT_SET'&&body.field==='screenUnsafe'&&body.value===false))
        throw new HttpError(409,'긴급 또는 화면 비안전 상황에서는 현재 안내의 수행 기록을 중단합니다.');
    }
    let next;
    try{next=applyGuidedEvent(run.guided,{...body,caseId:body.runId},
      {jurisdiction:run.jurisdiction,caseClosed:!!run.endedAt,emergency:assessment.emergencyFlag});}
    catch(error){throw new HttpError(error.status||400,error.message);}
    if(next===run.guided)return;
    run.guided=next;
    addLog('GUIDED_CARE',`${body.type} · 사용자 선택·미확인 · 외부 조치 없음`);
  }
  function close(body){assertRun(body);assertVersion(body);assertOpen();
    // Drop any uncommitted recognized text and audio replay fingerprints on case closure.
    ctx.metaController?.abort();ctx.metaController=null;ctx.metaQueued=false;
    if(['PENDING','WAITING_LATEST'].includes(run.meta.status))run.meta.status='CANCELLED_ON_END';
    ctx.pendingLocalStt=null;ctx.localDigests?.clear();
    run.caseState=applyCaseEvent(run.caseState,{type:'CASE_CLOSED',caseId:run.id,eventId:'end_'+unique()});
    run.callEndedAt??=clock();run.endedAt=clock();addLog('END','가상 사건 종료 · 결과는 실제 피해 예방 성과가 아님');
    const s=snapshot();ctx.completed.push({runId:run.id,scenario:s.scenario.name,mode:s.mode,review:s.review,steps:s.step,
      startedAt:run.startedAt,endedAt:run.endedAt});if(ctx.completed.length>30)ctx.completed.shift();
  }
    return {newRun,reset,snapshot,publish,mediaBegin,mediaFinal,mediaLocationStep,protectionBlocked,mediaMetaReview:startMediaMetaReview,glassesView:()=>glassesFrom(snapshot()),metaConsent,loadScene,advance,locationTick,voiceFixture,demoAudioFixture,enableExtendedReplay,recognizeLocalStt,confirmLocalStt,discardLocalStt,reviseLocalStt,captionAdvance,voiceReview,action,bankCommand,cardCommand,proposeTool,setJurisdiction,careCheckIn,careQuestionEvent,verificationRequest,verificationExpire,verificationResponse,recoveryEvent,guidedEvent,receiveMessageFixture,attemptMessageLink,reviewMessage,postCallAnswer,postCallTask,exportPostCall,importPostCall,deletePostCall,closeCase:close};
  }
  // A fresh session starts on app startup. Nothing is written to disk.
  legacy.commands=createCaseCommands(legacy);legacy.commands.newRun();
  const handleRequest=async(req,res,role,ctx)=>{
    const {snapshot,publish}=ctx.commands;
    const getState=()=>role==='glasses'?ctx.commands.glassesView():projectForRole(snapshot(),role);
    const url=parseRequestUrl(req);
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src https://www.openstreetmap.org; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'};
    const send=(status,payload)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(payload));};
    const sendError=(err)=>send(err.status||500,{error:err.status?err.message:'시뮬레이션 처리 오류. 다시 시작해 주세요.',code:err.code||'SERVER_ERROR'});
    try{
      if(req.method==='GET'&&url.pathname==='/api/state')return send(200,getState());
      if(req.method==='GET'&&url.pathname==='/api/glasses/state'){if(role!=='glasses'&&role!=='parent')throw new HttpError(403,'안경 상태는 승인된 세션에서만 접근할 수 있습니다.');return send(200,ctx.commands.glassesView());}
      if(req.method==='GET'&&url.pathname==='/api/text/benchmark')return send(200,TEXT_BENCH_RESULT);
      if(req.method==='GET'&&url.pathname==='/api/text/benchmark/v138')return send(200,V138_BENCH_RESULT);
      if(req.method==='GET'&&url.pathname==='/api/text/benchmark/v138/public')return send(200,V138_PUBLIC_RESULT);
      if(req.method==='GET'&&url.pathname==='/api/voice/benchmark/cases')return send(200,{mode:'SPARSE_CAPTION_OBSERVATION_NOT_STT',actualStt:false,externalCalls:0,fixtures:[...CAPTION_CASES.values()].map(x=>({id:x.id,durationMs:x.durationMs,observations:x.observations.length}))});
      if(req.method==='GET'&&url.pathname==='/api/voice/review')return send(200,await ctx.commands.voiceReview());
      if(req.method==='GET'&&url.pathname==='/api/voice/stt/capabilities')return send(200,{mode:'DIGEST_MAPPED_FIXTURE',actualStt:false,externalCalls:0,realAudioUpload:false,realMicrophone:false,metaCalled:false,fixtureIds:DEMO_AUDIO_OPTIONS,replayOptions:{defaultMaxSegments:8,extendedMaxSegments:24,requiresExplicitConsent:true},localStt:{enabled:!!localStt,ready:localStt?await localStt.isReady():false,externalCalls:0,requiresHumanConfirmation:true}});
      if(req.method==='GET'&&url.pathname==='/api/platform/capabilities')return send(200,{mode:'DOCUMENTED_CAPABILITY_MATRIX_NOT_DEVICE_DETECTION',nativeIntegration:false,platforms:PLATFORM_CAPABILITIES});
      if(req.method==='GET'&&url.pathname==='/api/readiness')return send(200,{...META_READINESS,mediaAsrReady,mediaAsrMode:!mediaAsrReady?'DISABLED':media.config.provider==='META'?'META_REALTIME_STT_OPT_IN':'LOCAL_CONTRACT_SIMULATOR',media:media.readiness(),processBudget:globalMetaGate.stats,runbookScenes:listSceneDefinitions().length});
      if(req.method==='GET'&&url.pathname==='/api/media/catalog')return send(200,{cases:MEDIA_CATALOG.map(({filename,...m})=>({...m,src:`/media/${m.id}.wav`,externalTransfer:media.transferBasis(m)??'NOT_AUTHORIZED'})),actualSttAvailable:mediaAsrReady&&media.config.provider==='META',
        asrProvider:mediaAsrReady?media.config.provider:'DISABLED',modelProvider:mediaAsrReady?media.config.modelProvider:'DISABLED',consentRequired:true,rightsConfirmationRequired:true});
      if(req.method==='GET'&&url.pathname==='/api/demo/scenes')return send(200,{mockOnly:true,scenes:listSceneDefinitions()});
      if(req.method==='GET'&&url.pathname==='/api/scenarios')return send(200,{scenarios:Object.values(SCENARIOS).filter(s=>!s.id.startsWith('txt_')).map(s=>({id:s.id,name:s.name,caption:s.caption})),modes:Object.values(MODES)});
      if(req.method==='GET'&&url.pathname==='/api/text/scenarios')return send(200,{mode:'SYNTHETIC_TEXT_FIXTURES',mockOnly:true,scenarios:Object.values(SCENARIOS).filter(s=>s.id.startsWith('txt_')).map(s=>({id:s.id,name:s.name,caption:s.caption})),realAudio:false,metaCalled:false});
      if(req.method==='GET'&&url.pathname==='/api/report')return send(200,{note:'사용자 조작으로 생성된 가상 시연 로그. 연구 참여자나 임상/실제 사기 예방 효과 데이터 아님.',runs:ctx.completed,active:role==='child'?null:snapshot().review});
      if(req.method==='GET'&&['/api/events','/api/glasses/events'].includes(url.pathname)){
        if(url.pathname==='/api/glasses/events'&&role!=='glasses'&&role!=='parent')throw new HttpError(403,'안경 이벤트는 승인된 세션에서만 접근할 수 있습니다.');
        // SSE is a long-lived authenticated stream. Disable the normal 5s request socket timeout.
        if(ctx.clients.size>=MAX_STREAM_CLIENTS)throw new HttpError(429,'SSE 연결 한도를 초과했습니다.');
        req.setTimeout(0);
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8',Connection:'keep-alive',...headers});
        const streamRole=url.pathname==='/api/glasses/events'?'glasses':role;
        const client={response:res,role:streamRole,pending:null,blocked:false};
        ctx.clients.add(client);
        deliver(ctx,client,`event: state\ndata: ${JSON.stringify(streamRole==='glasses'?ctx.commands.glassesView():getState())}\n\n`);
        const heartbeat=setInterval(()=>{try{if(!ctx.clients.has(client)){clearInterval(heartbeat);return;}res.write(': ping\n\n');}catch{ctx.clients.delete(client);clearInterval(heartbeat);}},20_000);
        req.on('close',()=>{clearInterval(heartbeat);ctx.clients.forEach(client=>{if(client.response===res)ctx.clients.delete(client);});});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/voice/stt/local'){
        // Local CLI processing may exceed the normal 5-second HTTP request timeout.
        // Input bytes remain capped at 320044 and CLI has its own <=60s deadline.
        req.setTimeout(65000,()=>req.destroy());
        assertSameOrigin(req);
        if(role!=='parent')throw new HttpError(403,'보호자 세션만 테스트 오디오를 처리할 수 있습니다.');
        if(!localStt)throw new HttpError(503,'로컬 STT 미설정','STT_UNAVAILABLE');
        if(req.headers['content-type']!=='audio/wav'||req.headers['x-safecall-local-consent']!=='granted')
          throw new HttpError(400,'WAV 입력과 명시적 로컬 분석 동의가 필요합니다.','VALIDATION_ERROR');
        const issuedAt=Number(req.headers['x-safecall-consent-at']);
        if(!Number.isSafeInteger(issuedAt)||issuedAt>Date.now()||Date.now()-issuedAt>60_000)
          throw new HttpError(400,'로컬 STT 동의 시각이 유효하지 않습니다.','VALIDATION_ERROR');
        const language=req.headers['x-safecall-language'];
        const caseId=req.headers['x-safecall-run'];
        const expectedVersion=Number(req.headers['x-safecall-version']);
        const suppliedDigest=req.headers['x-safecall-digest'];
        const segmentIndexHeader=req.headers['x-safecall-segment-index'];
        const segmentStartHeader=req.headers['x-safecall-segment-start-ms'];
        const segmentIndex=segmentIndexHeader===undefined?undefined:Number(segmentIndexHeader);
        const segmentStartMs=segmentStartHeader===undefined?undefined:Number(segmentStartHeader);
        if((segmentIndexHeader!==undefined&&(!Number.isSafeInteger(segmentIndex)||segmentIndex<0||segmentIndex>=getReplayPolicy(ctx.run.voiceFixture.replayMode).maxSegments))||
           (segmentStartHeader!==undefined&&(!Number.isSafeInteger(segmentStartMs)||segmentStartMs<0||segmentStartMs>3600000)))
          throw new HttpError(400,'세그먼트 인덱스·시작 시간이 잘못됐습니다.','VALIDATION_ERROR');
        if(!['ko-KR','en-US'].includes(language)||typeof caseId!=='string'||!Number.isSafeInteger(expectedVersion)||
          typeof suppliedDigest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(suppliedDigest))
          throw new HttpError(400,'오디오 메타데이터가 유효하지 않습니다.','VALIDATION_ERROR');
        if(!localStt||!(await localStt.isReady()))throw new HttpError(503,'로컬 음성 모델 준비되지 않음','STT_UNAVAILABLE');
        const bytes=await readBoundedBody(req,{maxBytes:320_044});
        const inFlightController=new AbortController();
        res.on('close',()=>{if(!res.writableEnded)inFlightController.abort();});
        const audio={caseId,sourceType:'CONSENTED_TEST_AUDIO',provenance:'USER_AUTHORIZED_TEST',
          consentReceipt:{granted:true,purpose:'LOCAL_DEMO_ANALYSIS',externalTransfer:false,
          issuedAtMs:issuedAt,expiresAtMs:issuedAt+60_000},
          audioBytes:bytes,inputDigest:suppliedDigest,codec:'WAV_PCM16_MONO_16000',
          durationMs:(bytes.length-44)/32,sizeBytes:bytes.length,languageHint:language,
          retentionPolicy:'DISCARD_IMMEDIATELY',abortSignal:inFlightController.signal};
        try{
          try{validateAudioInput(audio);}catch(e){throw new HttpError(400,'음성 입력 검증 실패: '+e.code,'VALIDATION_ERROR');}
          try{return send(200,await ctx.commands.recognizeLocalStt({runId:caseId,expectedVersion,audio,segmentIndex,segmentStartMs}));}
          catch(e){if(e.code?.startsWith('STT_'))throw new HttpError(e.code==='STT_NOT_CONFIGURED'?503:422,'로컬 STT 실행 오류: '+e.code,e.code);throw e;}
        }finally{bytes.fill(0);}
      }
      if(req.method==='POST'&&url.pathname==='/api/postcall/export'){
        assertSameOrigin(req);requireJsonContentType(req);
        if(role==='child')throw new HttpError(403,'보호자 세션만 백업을 만들 수 있습니다.');
        const body=await readJsonObject(req,{maxBytes:MAX_BODY});
        return send(200,ctx.commands.exportPostCall(body));
      }
      if(req.method==='POST'&&url.pathname==='/api/media/replay'){
        assertSameOrigin(req);requireJsonContentType(req);if(role!=='parent')throw new HttpError(403,'보호자 세션만 오프라인 시연을 시작할 수 있습니다.','FORBIDDEN');
        const body=await readJsonObject(req,{maxBytes:MAX_BODY});media.startReplay(ctx,body);return send(202,getState());
      }
      if(req.method==='POST'&&url.pathname==='/api/media/start'){
        assertSameOrigin(req);requireJsonContentType(req);if(role!=='parent')throw new HttpError(403,'부모 세션만 녹음 자료 분석을 시작할 수 있습니다.','FORBIDDEN');
        const body=await readJsonObject(req,{maxBytes:MAX_BODY});media.start(ctx,body);return send(202,getState());
      }
      if(req.method==='POST'&&url.pathname==='/api/media/control'){
        assertSameOrigin(req);requireJsonContentType(req);if(role!=='parent')throw new HttpError(403,'부모 세션만 분석을 제어합니다.','FORBIDDEN');
        const body=await readJsonObject(req,{maxBytes:MAX_BODY});media.control(ctx,body);return send(200,getState());
      }
      if(req.method==='POST'&&url.pathname==='/api/media/clock'){
        // High-frequency player position report: small reply, no full-state serialization.
        assertSameOrigin(req);requireJsonContentType(req);if(role!=='parent')throw new HttpError(403,'부모 세션만 재생 시각을 보고합니다.','FORBIDDEN');
        const body=await readJsonObject(req,{maxBytes:512});return send(200,media.clockReport(ctx,body));
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/')){
        assertSameOrigin(req,'외부 출처 요청 차단');
        requireJsonContentType(req);
        const body=await readJsonObject(req,{maxBytes:MAX_BODY});
        if(url.pathname==='/api/meta/consent')ctx.commands.metaConsent(body);
        else await dispatchCaseCommand(ctx.commands,url.pathname,body,{role,sessionId:ctx.sessionId});
        publish();return send(200,getState());
      }
      if(req.method!=='GET')throw new HttpError(405,'지원되지 않는 요청');
      if(url.pathname.startsWith('/media/')){
        const id=url.pathname.match(/^\/media\/([a-z][a-z0-9-]{1,31})\.wav$/)?.[1];const item=mediaById(id);
        if(!item)throw new HttpError(404,'등록되지 않은 음성 자료');
        // A paused <audio> may hold a range response open without reading; let it idle longer than API calls.
        req.setTimeout(120_000,()=>req.destroy());
        const file=path.join(MEDIA_DIR,item.filename),info=await stat(file);
        const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        const start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):info.size-1;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>=info.size||end<start)throw new HttpError(416,'지원되지 않는 미디어 범위');
        res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{}) ,...headers});
        createReadStream(file,{start,end}).pipe(res);return;
      }
      const safe=url.pathname==='/'?'index.html':url.pathname==='/mobile'?'mobile.html':url.pathname==='/glasses'?'glasses.html':url.pathname==='/live'?'live.html':url.pathname==='/lab'?'lab.html':url.pathname.replace(/^\/+/, '');
      if(!['index.html','landing.css','i18n.js','lab.html','styles.css','app.js','mobile.html','mobile.css','mobile.js','mobile-client.js','replay-wav.js','glasses.html','glasses.css','glasses.js','glasses-policy.js','glasses-street-far.jpg','glasses-bank-near.jpg','live.html','live.css','live.js','live-i18n.js'].includes(safe))throw new HttpError(404,'페이지 없음');
      const file=path.join(SITE_DIR,safe);await stat(file);
      res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream',...headers});
      res.end(await readFile(file));
    }catch(err){if(!res.headersSent)sendError(err);}
  };
  const server=http.createServer(async(req,res)=>{
    req.setTimeout(5000,()=>req.destroy());
    let url;
    try{url=parseRequestUrl(req);}catch(e){
      res.writeHead(e.status||400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:e.status?e.message:'유효하지 않은 요청'}));return;
    }
    const pathname=url.pathname;
    const error=(status,message,code)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify({error:message,code:code||(status===400||status===422?'VALIDATION_ERROR':status===403?'FORBIDDEN':status===401?'AUTH_REQUIRED':status===409?'CASE_VERSION_CONFLICT':status===429?'RATE_LIMITED':status>=500?'SERVER_ERROR':'UNKNOWN_ERROR')}));};
    const api=pathname.startsWith('/api/');
    cleanupSessions();
    if(req.method==='POST'&&pathname==='/api/session/create'){
      try{
        assertSameOrigin(req,'출처 불일치');
        requireJsonContentType(req);
        const body=await readJsonObject(req,{maxBytes:MAX_BODY});
        const created=startSession(body.scenarioId??'kidnap',body.mode??'verified');
        const state=created.ctx.commands.snapshot();
        res.writeHead(201,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        return res.end(JSON.stringify({...state,sessionCredentials:{sessionId:created.ctx.sessionId,parentToken:created.parentToken,childToken:created.childToken,glassesToken:created.glassesToken}}));
      }catch(e){return error(e.status||400,e.status?e.message:'세션 생성 실패');}
    }
    if(api && !(req.method==='GET'&&['/api/scenarios','/api/readiness','/api/demo/scenes','/api/media/catalog'].includes(pathname))){
      // Session bearer tokens are read from headers only: never from URL query strings.
      const sessionId=req.headers['x-safecall-session'];
      const token=req.headers['x-safecall-token'];
      let ctx,role;
      if(!sessionId&&!token&&allowLegacyShared){ctx=legacy;role='legacy';}
      else {
        ctx=sessions.get(sessionId);
        if(!ctx)return error(403,'유효한 세션 권한이 필요합니다.');
        role=equalToken(token,ctx.parentToken)?'parent':equalToken(token,ctx.childToken)?'child':equalToken(token,ctx.glassesToken)?'glasses':null;
        if(!role)return error(403,'세션 역할 권한이 없습니다.');
      }
      ctx.lastTouchedAt=Date.now();
      if(req.method==='POST'&&pathname==='/api/session/close'){
        if(role!=='parent')return error(403,'보호자 역할만 가상 세션을 종료할 수 있습니다.');
        try{
          assertSameOrigin(req,'출처 불일치');
          requireJsonContentType(req);
          // Session closure does not use request data, but still enforces a strict bound.
          await readBoundedBody(req,{maxBytes:128});
        }catch(e){return error(e.status||400,e.status?e.message:'세션 종료 요청 오류');}
        disposeSession(sessionId);
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        return res.end(JSON.stringify({closed:true,sessionId,metaCalled:false}));
      }
      if(role==='glasses'&&!(req.method==='GET'&&['/api/glasses/state','/api/glasses/events'].includes(pathname)))return error(403,'안경 역할은 읽기 전용 HUD 상태만 볼 수 있습니다.');
      if(role==='child'&&!(req.method==='GET'&&['/api/state','/api/events'].includes(pathname))&&!(req.method==='POST'&&pathname==='/api/verification/respond'))return error(403,'자녀 역할은 이 작업을 수행할 수 없습니다.');
      if(role==='parent'&&pathname==='/api/verification/respond')return error(403,'자녀 역할만 가상 응답을 보낼 수 있습니다.');
      return handleRequest(req,res,role,ctx);
    }
    return handleRequest(req,res,'public',legacy);
  });
  const cleanupTimer=setInterval(()=>cleanupSessions(),60000);cleanupTimer.unref?.();
  server.requestTimeout=10000;server.headersTimeout=8000;
  return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{
    server.off('error',reject);resolve(server.address());});}),close:()=>new Promise(resolve=>{
      clearInterval(cleanupTimer);for(const ctx of [...sessions.values(),legacy]){ctx.media?.controller?.abort();ctx.metaController?.abort();for(const r of ctx.clients)r.response.end();ctx.clients.clear();}server.close(resolve);}),getSnapshot:()=>legacy.commands.snapshot()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const p=Number(process.env.SAFECALL_DEMO_PORT||4173);
  if(!Number.isInteger(p)||p<1||p>65535)throw new Error('포트는 1-65535 범위여야 합니다.');
  const localSttConfig=process.env.SAFECALL_LOCAL_STT_ENABLED==='1'?{executablePath:process.env.SAFECALL_WHISPER_CLI||'',modelPath:process.env.SAFECALL_WHISPER_MODEL||''}:null;
  const mediaAsrConfig={mode:process.env.SAFECALL_MEDIA_ASR_MODE||undefined,ffmpegBin:process.env.SAFECALL_FFMPEG_PATH||undefined,
    languageBias:process.env.SAFECALL_MEDIA_ASR_LANGUAGES?process.env.SAFECALL_MEDIA_ASR_LANGUAGES.split(',').map(s=>s.trim()).filter(Boolean):undefined,
    externalAuthorizedMediaIds:(process.env.SAFECALL_MEDIA_EXTERNAL_AUTHORIZED||'').split(',').map(s=>s.trim()).filter(Boolean)};
  const app=createDemoServer({port:p,localSttConfig,mediaAsrEnabled:process.env.SAFECALL_MEDIA_ASR_ENABLED==='true',mediaAsrConfig,metaConfig:{enabled:process.env.META_LIVE_ENABLED==='true',approved:process.env.META_SPEND_APPROVED==='true',killSwitch:process.env.META_BUDGET_KILL_SWITCH!=='false',apiKey:process.env.MODEL_API_KEY||'',maxCallsPerRun:Math.min(5,Math.max(1,Number(process.env.META_MAX_REQUESTS_PER_RUN||4)||4))}});
  app.listen().then(addr=>console.log(`SafeCall demo: http://127.0.0.1:${addr.port} (Meta gated: ${process.env.META_LIVE_ENABLED==='true'?'configured':'off'} · media ASR: ${process.env.SAFECALL_MEDIA_ASR_ENABLED==='true'?'requested':'off'})`));
}
