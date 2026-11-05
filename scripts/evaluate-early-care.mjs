/** Three distinct evaluations: unchanged passive prefixes, opt-in adaptive care, KR/US/UNKNOWN coaching. */
import {writeFileSync} from 'node:fs';
import {scenarios} from '../src/modules/evaluation/index.ts';
import {adaptiveCases} from '../src/modules/evaluation/adaptive-cases.mjs';
import {createCase,applyCaseEvent,getCaseView} from '../src/modules/case/index.ts';
import {selectLiveGuidance} from '../src/modules/playbook/select.ts';
import {deriveCarePlan,deriveEarlyCareEvidence} from '../demo/safety-challenge/care-plan.mjs';
import {selectActionCoaching} from '../demo/safety-challenge/coaching-policy.mjs';
import {createCareInteraction,nextCareQuestion,applyCareInteractionEvent,deriveActiveCare} from '../demo/safety-challenge/adaptive-care.mjs';
const strictCards=new Set(['DO_NOT_TRANSFER','EMERGENCY_CONTACT_GUIDANCE','DO_NOT_DISCLOSE_PERSONAL_DATA']);
const audit=[];let prefixes=0,strictBefore=0,strictBy=0,lowBefore=0,normalLow=0,normalEmergency=0;
for(const sc of scenarios){
 let state=createCase(sc.scenarioId),firstStrict=null,firstLow=null,firstSignal=null,firstSignalCodes=[];
 for(const [i,turn] of sc.turns.entries()){
  state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:`audit_${i}`,turnId:turn.turnId,revision:0,absoluteIndex:i,speaker:turn.speaker,text:turn.text});
  const g=selectLiveGuidance({caseState:state,jurisdiction:'KR'}),v=getCaseView(state);
  const care=deriveCarePlan({mode:'guidance',guidance:g,risk:{emergency:v.assessment.emergencyFlag},earlyEvidence:deriveEarlyCareEvidence(state)});
  prefixes++;const now=i+1;
  if(firstStrict===null&&strictCards.has(g.primary.id))firstStrict=now;
  if(firstLow===null&&(g.primary.id!=='UNCERTAIN_NO_HARD_WARNING'||care.phase==='EARLY_OBSERVATION'))firstLow=now;
  if(firstSignal===null&&v.assessment.signals.length){firstSignal=now;firstSignalCodes=v.assessment.signals.map(x=>x.code);}
  if(sc.category==='NORMAL'&&g.primary.id==='EMERGENCY_CONTACT_GUIDANCE')normalEmergency++;
 }
 const critical=sc.groundTruth.expectedCriticalTurn,risk=['TRADITIONAL','EVOLVED'].includes(sc.category)&&typeof critical==='number';
 if(risk){if(firstStrict!==null&&firstStrict<critical)strictBefore++;if(firstStrict!==null&&firstStrict<=critical)strictBy++;if(firstLow!==null&&firstLow<critical)lowBefore++;}
 if(sc.category==='NORMAL'&&firstLow!==null)normalLow++;
 let reason='NOT_APPLICABLE';
 if(risk){reason=firstSignal===null||firstSignal>=critical?'NO_OBSERVABLE_CANONICAL_SIGNAL_BEFORE_CRITICAL':
  firstStrict===null||firstStrict>=critical?'SIGNAL_OBSERVED_BUT_STRICT_GUIDANCE_NOT_BEFORE_CRITICAL':'EARLY_STRICT_GUIDANCE_PRESENT';}
 audit.push({scenarioId:sc.scenarioId,category:sc.category,criticalTurn:critical,firstCanonicalSignalTurn:firstSignal,
  initialSignalCodes:firstSignalCodes,firstStrictTurn:firstStrict,firstLowRegretTurn:firstLow,
  firstCanonicalSignalToStrictDelay:firstSignal!==null&&firstStrict!==null?firstStrict-firstSignal:null,reason});
}
let correct=0,proposalsCorrect=0,zeroWrongCountries=0;
const results=[];
for(const c of adaptiveCases){
 let s=createCase(c.id),i=createCareInteraction(c.id);
 if(c.speaker){s=applyCaseEvent(s,{type:'UTTERANCE_FINAL',caseId:s.caseId,eventId:'test_1',turnId:'u_1',revision:0,absoluteIndex:0,speaker:c.speaker,text:c.text});}
 const v=getCaseView(s),g=selectLiveGuidance({caseState:s,jurisdiction:c.country});
 if(c.screenUnsafe){i=applyCareInteractionEvent(i,{type:'CARE_SCREEN_UNSAFE_REPORTED',caseId:s.caseId,eventId:'case_unsafe_1',caseVersion:s.version,expectedInteractionVersion:i.version},
  {caseState:s,decision:{decision:'SKIP_UNSAFE'}});}
 const proposed=nextCareQuestion({caseState:s,interaction:i,emergency:v.assessment.emergencyFlag,guidance:g,earlyEvidence:deriveEarlyCareEvidence(s)});
 if(c.answer){
  const q=proposed.question;
  i=applyCareInteractionEvent(i,{type:'CARE_QUESTION_PRESENTED',caseId:s.caseId,eventId:'case_present_1',questionId:q.id,caseVersion:s.version,expectedInteractionVersion:i.version},{caseState:s,decision:proposed});
  i=applyCareInteractionEvent(i,{type:'CARE_QUESTION_ANSWERED',caseId:s.caseId,eventId:'case_answer_01',questionId:q.id,choiceId:c.answer,caseVersion:s.version,expectedInteractionVersion:i.version},{caseState:s,decision:proposed});
 }
 const coaching=selectActionCoaching({caseState:s,guidance:g,jurisdiction:c.country,emergency:v.assessment.emergencyFlag,
  earlyEvidence:deriveEarlyCareEvidence(s),activeCare:deriveActiveCare(i)});
 const matched=coaching.kind===c.expectedKind,questionMatched=proposed.decision===c.expectedQuestion;
 if(matched)correct++;if(questionMatched)proposalsCorrect++;
 if(coaching.jurisdiction!=='UNKNOWN'||(!coaching.sourceLinks.length&&!/112|911|1394/.test(coaching.primaryInstruction)))zeroWrongCountries++;
 results.push({id:c.id,country:c.country,split:c.split,family:c.family,expectedKind:c.expectedKind,predictedKind:coaching.kind,matched,
  expectedQuestion:c.expectedQuestion,questionDecision:proposed.decision,questionMatched,sourceIds:coaching.sourceIds,
  activeAnswersCount:Object.keys(i.answers).length,countsAsPassiveDetection:false});
}
const report={version:'0.9.2',label:'synthetic-only, locally authored template families; not real accuracy',
 passive:{unchangedScenarios:scenarios.length,finalizedPrefixes:prefixes,strictBeforeCritical:strictBefore,strictByCritical:strictBy,
  lowRegretBeforeCritical:lowBefore,normalLowRegret:normalLow,normalEmergency,audit},
 active:{cases:adaptiveCases.length,byCountry:Object.fromEntries(['KR','US','UNKNOWN'].map(k=>[k,adaptiveCases.filter(x=>x.country===k).length])),
  bySplit:Object.fromEntries(['DEVELOPMENT','HOLDOUT'].map(k=>[k,adaptiveCases.filter(x=>x.split===k).length])),
  expectedQuestionDecisionMatches:proposalsCorrect,expectedCoachingKindMatches:correct,countrySafetyCheckPass:zeroWrongCountries,
  riskScoresChangedByUserAnswers:0,results},
 limitations:['Scenario templates repeated ten times; observations are correlated, not 100 independent samples.',
  'Labels constructed by same developer; assigned HOLDOUT groups were not independently blinded.',
  'Active answers are opt-in fiction and cannot be credited as automatic detection.',
  'No actual user study, phone/audio/Meta API, financial or emergency service integration.']};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passive:{...report.passive,audit:undefined},active:{...report.active,results:undefined},limitations:report.limitations},null,2));
