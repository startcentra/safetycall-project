/**
 * Read-only HTTP state projection for the SafeCall MOCK demo.
 * Keeps evidence, policies and presentation separate from server mutation/transport.
 * The output contains only guidance and self-reported state (no real-world actions).
 */
import {getCaseView} from '../../src/modules/case/index.ts';
import {deriveUnifiedTextAdvisory} from '../../src/modules/text-benchmark/semantic-v138.ts';
import {projectMessages,derivePostCallPlan} from '../../src/modules/message-safety/index.ts';
import {deriveIntervention} from '../../src/modules/policy/intervention.ts';
import {selectLiveGuidance} from '../../src/modules/playbook/select.ts';
import {SCENARIOS} from './scenarios.mjs';
import {getSceneGuide} from './demo-scenes.mjs';
import {deriveCarePlan,deriveEarlyCareEvidence} from './care-plan.mjs';
import {recoveryView} from './recovery.mjs';
import {selectActionCoaching} from './coaching-policy.mjs';
import {careInteractionView,deriveActiveCare} from './adaptive-care.mjs';
import {guidedJourneyView} from './guided-actions.mjs';

export function projectDemoSnapshot(context,{metaReadiness,legacy}){
    const run=context.run;
    const scenario=SCENARIOS[run.scenarioId];
    const view=getCaseView(run.caseState);
    const earlyEvidence=deriveEarlyCareEvidence(run.caseState);
    const activeCare=deriveActiveCare(run.careInteraction);
    const guidance=selectLiveGuidance({caseState:run.caseState,jurisdiction:run.jurisdiction,
      familyContactStatus:run.verification?.status==='EXPIRED'?'NO_RESPONSE':run.verification?.status==='SELF_REPORTED_SAFE'?'SELF_REPORTED_SAFE':'NOT_REQUESTED',
      safeToSpeak:false});
    const completedAction=run.actions.some(a=>a.kind==='SIMULATED_TRANSFER');
    const stopped=run.actions.some(a=>a.kind==='STOP_TRANSFER');
    const emergency=run.actions.some(a=>a.kind==='EMERGENCY_HELP');
    const verified=run.actions.some(a=>a.kind==='VERIFY_REQUESTED');
    const baseCare=deriveCarePlan({mode:run.mode,guidance,verification:run.verification,concern:run.concern,
      actions:run.actions,risk:{emergency:view.assessment.emergencyFlag},endedAt:run.endedAt,
      earlyEvidence,careIntegrityEnabled:context!==legacy});
    const coaching=run.mode==='warning'?null:selectActionCoaching({caseState:run.caseState,guidance,jurisdiction:run.jurisdiction,
      emergency:view.assessment.emergencyFlag,endedAt:run.endedAt,earlyEvidence,
      concern:run.concern,actions:run.actions,recoveryPath:run.recovery.selectedPath,activeCare:deriveActiveCare(run.careInteraction),verification:run.verification,enableSafetyBranches:context!==legacy});
    const activeCareApplies=!view.assessment.emergencyFlag&&!run.endedAt&&!!(activeCare.requestType||activeCare.screenUnsafe);
    const care=baseCare?{...baseCare,
      phase:activeCareApplies&&baseCare.phase==='OBSERVE'?(activeCare.screenUnsafe?'SCREEN_UNSAFE':'ACTIVE_CHECK_IN'):baseCare.phase,
      phaseLabel:activeCareApplies&&baseCare.phase==='OBSERVE'?(activeCare.screenUnsafe?'화면 비안전 자기 보고 · 질문 중단':'사용자 응답 기반 안전 코칭 · 미확인'):baseCare.phaseLabel,
      basis:activeCareApplies?'질문 답변 또는 화면 안전 자기 보고 · 미확인 · 자동 탐지 점수 미반영':baseCare.basis,
      primary:run.endedAt&&!view.assessment.emergencyFlag?baseCare.primary:coaching.primaryInstruction,sourceIds:coaching.sourceIds,coaching,
      secondary:run.jurisdiction==='US'?'The caller or family reply is not independently authenticated. Do not share money, codes, or device access while checking through a trusted channel.':baseCare.secondary,
      nextStep:run.jurisdiction==='US'?'Use a trusted, independently located contact method. These actions are guidance only; nothing was performed.':baseCare.nextStep,
      verificationNotice:run.jurisdiction==='US'&&baseCare.verificationNotice?`${baseCare.verificationNotice} / Mock family response only. Identity and actual safety have NOT been authenticated.`:baseCare.verificationNotice}:null;
    const callerRequestedMoney=run.caseState.checkpoint.turns.some(t=>t.status==='ACTIVE'&&
      t.speaker==='caller'&&t.signals.some(sig=>sig.code==='MONEY_REQUEST'));
    const captionLabel=run.captionReplay?.fixtureId==='registered-mail'?'등기배송':
      run.captionReplay?.fixtureId==='prosecutor-personal-data'?'검찰사칭·개인정보':null;
    const evidenceIds=run.caseState.checkpoint.turns.filter(t=>t.status==='ACTIVE'&&t.speaker==='caller'&&t.signals.length).map(t=>t.turnId);
    const projectedMessages=projectMessages(run.messages,view.assessment.riskBand,{reviews:run.messageReviews||[],caseVersion:run.caseState.version,evidenceIds});
    return {demoOnly:true,provider:run.scenarioId.startsWith('txt_')?'TEXT_ONLY_SYNTHETIC_FIXTURE':run.captionReplay?'CAPTION_OBSERVATION_NOT_STT':
      run.voiceFixture.mode==='LOCAL_STT_USER_REVIEWED'?'LOCAL_STT_HUMAN_REVIEWED':run.voiceFixture.mode==='STREAMED_MEDIA_STT'?'META_STREAMING_AUDIO':'SCRIPTED_MOCK',metaCalled:run.meta?.callCount>0,realMoneySent:false,externalActionPerformed:false,
      modelReadiness:metaReadiness,metaReview:run.meta?{...run.meta,review:run.meta.review?{...run.meta.review}:null}:null,textAdvisory:deriveUnifiedTextAdvisory(run.transcript.filter(t=>run.caseState.checkpoint.turns.some(e=>e.turnId===t.turnId&&e.status==='ACTIVE')),{emergency:view.assessment.emergencyFlag}),intervention:deriveIntervention(run.caseState,{cardDetailsExposedByUser:run.cardExposureReported}),cardExposureReported:run.cardExposureReported,sceneGuide:getSceneGuide({...context.run,totalSteps:scenario.turns.length}),
      messages:{mode:'IN_APP_MOCK_ONLY',osSmsBlocked:false,externalLinksOpened:false,
        entries:projectedMessages,
        lastAttempt:run.messageAttempts.at(-1)??null,totalAttempts:run.messageAttempts.length},
      postCall:derivePostCallPlan({callEndedAt:run.callEndedAt,endedAt:run.endedAt,
        riskBand:view.assessment.riskBand,emergency:view.assessment.emergencyFlag,cardExposureReported:run.cardExposureReported,answers:run.postCall.answers,
        taskStates:run.postCall.taskStates,messageVerdicts:projectedMessages.map(m=>m.verdict)}),
      recoveryVault:{mode:'OPT_IN_ENCRYPTED_USER_CAPSULE',serverPersistence:false,restoredFrom:run.postCall.restoredFrom||null,retentionDays:7},
      platformCapability:{web:'IN_APP_MOCK_ONLY',android:'CONDITIONAL_NOT_IMPLEMENTED',ios:'CONDITIONAL_NOT_IMPLEMENTED',
        nativeSmsBlocked:false,actualPhoneCallMonitoring:false,canBlockThirdPartyLinks:false},
      callEndedAt:run.callEndedAt,
      runId:run.id,careCaseVersion:run.caseState.version,jurisdiction:run.jurisdiction,jurisdictionSource:run.jurisdictionSource,scenario:{id:scenario.id,name:captionLabel?`자막 관찰: ${captionLabel}`:scenario.name,caption:captionLabel?'화면에서 관찰한 희소 자막 · 실제 STT 아님':scenario.caption,
        intro:captionLabel?'검증된 통화 수신이 아닙니다. 공개 예방 사례 자막을 5초 체크포인트로 재현합니다.':scenario.intro,country:scenario.country,
        threat:scenario.threat,fakeAmount:scenario.fakeAmount,target:scenario.target,totalSteps:scenario.turns.length},
      mode:run.mode,step:run.step,endedAt:run.endedAt,startedAt:run.startedAt,version:run.version,
      safeBank:run.safeBank,mockCard:run.mockCard,voiceFixture:{...run.voiceFixture},captionReplay:run.captionReplay?{...run.captionReplay}:null,
      canonicalEvents:run.canonicalEvents.slice(-80),toolProposals:run.toolProposals.map(p=>({...p,evidenceIds:[...p.evidenceIds]})),toolAudit:run.toolAudit.map(e=>({...e})),bankArrivalConfirmed:run.bankArrivalConfirmed,bankHelpConsented:run.bankHelpConsented,bankArrivalVersion:run.bankArrivalVersion??null,
      transcript:run.transcript,verification:run.verification,concern:run.concern,care,actions:run.actions,
      careInteraction:run.mode==='warning'?null:careInteractionView({caseState:run.caseState,interaction:run.careInteraction,
        emergency:view.assessment.emergencyFlag,earlyEvidence,guidance,
        concern:run.concern,actions:run.actions,endedAt:run.endedAt,remoteStatusFollowup:context!==legacy}),
      recovery:run.mode==='warning'?null:recoveryView(run.recovery,run.jurisdiction),
      guided:run.mode==='warning'?null:guidedJourneyView(run.guided,{jurisdiction:run.jurisdiction,caseClosed:!!run.endedAt,emergency:view.assessment.emergencyFlag,screenUnsafe:activeCare.screenUnsafe,verification:run.verification}),
      risk:{band:view.assessment.riskBand,index:view.assessment.riskIndex,emergency:view.assessment.emergencyFlag,
        urgency:view.live.urgency,pressure:view.live.coercivePressure,proximity:view.live.actionProximity,
        evidence:view.activeEvidenceCount},
      guidance:run.mode==='warning'?null:guidance,
      review:{fakeTransferAttempted:completedAction,stoppedTransfer:stopped,emergencyHelpSelected:emergency,
        familyVerificationRequested:verified,careCheckInRequested:!!run.concern,
        checkInBeforeObservedMoneyRequest:!!run.concern?.beforeObservedMoneyRequest,
        callerMoneyRequestObserved:callerRequestedMoney,notProofOfSafety:true},
      log:run.log.slice(-20),completedRuns:context.completed.slice(-8).map(r=>({...r}))};
  }
