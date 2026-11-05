/** Transparent v0.9 offline synthetic prefix evaluation; NOT real protective effectiveness. */
import {writeFileSync} from 'node:fs';
import {scenarios} from '../src/modules/evaluation/index.ts';
import {createCase,applyCaseEvent,getCaseView} from '../src/modules/case/index.ts';
import {selectLiveGuidance} from '../src/modules/playbook/select.ts';
import {deriveCarePlan,deriveEarlyCareEvidence} from '../demo/safety-challenge/care-plan.mjs';
const strictCards=new Set(['DO_NOT_TRANSFER','EMERGENCY_CONTACT_GUIDANCE','DO_NOT_DISCLOSE_PERSONAL_DATA']);
let prefixes=0,scenariosWithCritical=0,strictBefore=0,strictBy=0,normalEmergency=0;
let lowRegretBefore=0,normalLowRegret=0,observationalBefore=0,observationalNormal=0;
const cases=[];
for(const scenario of scenarios){
 let state=createCase(scenario.scenarioId),firstStrict=null,firstLowRegret=null,firstObservedHint=null;
 for(const [i,turn] of scenario.turns.entries()){
  state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:`c_${i}`,turnId:turn.turnId,revision:0,absoluteIndex:i,speaker:turn.speaker,text:turn.text});
  const guidance=selectLiveGuidance({caseState:state,jurisdiction:'KR'});
  const view=getCaseView(state);
  const care=deriveCarePlan({mode:'guidance',guidance,verification:null,concern:null,actions:[],
    risk:{emergency:view.assessment.emergencyFlag},earlyEvidence:deriveEarlyCareEvidence(state)});
  const current=i+1;prefixes++;
  if(firstStrict===null&&strictCards.has(guidance.primary.id))firstStrict=current;
  if(firstLowRegret===null && (guidance.primary.id!=='UNCERTAIN_NO_HARD_WARNING'||care.phase==='EARLY_OBSERVATION'))firstLowRegret=current;
  if(firstObservedHint===null && care.phase==='EARLY_OBSERVATION')firstObservedHint=current;
  if(scenario.category==='NORMAL'&&guidance.primary.id==='EMERGENCY_CONTACT_GUIDANCE')normalEmergency++;
 }
 const critical=scenario.groundTruth.expectedCriticalTurn;
 if(['TRADITIONAL','EVOLVED'].includes(scenario.category)&&typeof critical==='number'){
  scenariosWithCritical++;
  if(firstStrict!==null&&firstStrict<critical)strictBefore++;
  if(firstStrict!==null&&firstStrict<=critical)strictBy++;
  if(firstLowRegret!==null&&firstLowRegret<critical)lowRegretBefore++;
  if(firstObservedHint!==null&&firstObservedHint<critical)observationalBefore++;
 }
 if(scenario.category==='NORMAL'){
  if(firstLowRegret!==null)normalLowRegret++;
  if(firstObservedHint!==null)observationalNormal++;
 }
 cases.push({id:scenario.scenarioId,category:scenario.category,criticalTurn:critical,
   firstStrictPreventiveTurn:firstStrict,firstLowRegretGuidanceTurn:firstLowRegret,firstObservationalHintTurn:firstObservedHint});
}
const report={version:'0.9.0',dataset:'60 unchanged locally authored synthetic scenarios; finalized-prefix-only',
 scenarios:scenarios.length,observedUtterancePrefixes:prefixes,criticalScenarios:scenariosWithCritical,
 originalStrictDefinition:['DO_NOT_TRANSFER','EMERGENCY_CONTACT_GUIDANCE','DO_NOT_DISCLOSE_PERSONAL_DATA'],
 strictPreventiveBeforeCritical:strictBefore,strictPreventiveByCritical:strictBy,
 lowRegretAutomaticGuidanceBeforeCritical:lowRegretBefore,observationalHintBeforeCritical:observationalBefore,
 normalEmergencyCards:normalEmergency,normalLowRegretGuidanceScenarios:normalLowRegret,
 normalObservationalHintScenarios:observationalNormal,userInitiatedCheckInsCreditedAsAutomatic:0,
 warningModeCareEnabled:false,
 caveats:['Strict metric preserved from v0.8 baseline and NOT reclassified as improved',
 'Low-regret informational cues are NOT equivalent to preventing a financial action',
 'User-initiated check-ins excluded from automatic metrics',
 'Labels and future turns never used by runtime selection',
 'Synthetic dataset is not unseen validation; no real-world effectiveness, sensitivity or specificity claim',
 'No telephone/Meta/financial/emergency integrations'],cases};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,cases:undefined},null,2));
