/** v0.6.6 synthetic guidance audit: sequential final-only inputs, no future labels in selection. */
import { writeFileSync } from 'node:fs';
import {scenarios} from '../src/modules/evaluation/index.ts';
import {createCase,applyCaseEvent} from '../src/modules/case/index.ts';
import {selectLiveGuidance} from '../src/modules/playbook/select.ts';
let observed=0,normalHardWarns=0,preCritical=0,byCritical=0,criticalScenarios=0;
const byCategory={};
const rows=[];
for(const scenario of scenarios){
 let caseState=createCase(scenario.scenarioId);
 const selected=[];
 let firstGuidanceTurn=null;
 let firstPreventiveTurn=null;
 for(const [index,turn] of scenario.turns.entries()){
   // Labels are deliberately never passed into this event or the guidance selection.
   caseState=applyCaseEvent(caseState,{type:'UTTERANCE_FINAL',caseId:caseState.caseId,eventId:`g_${index}`,turnId:turn.turnId,revision:0,absoluteIndex:index,speaker:turn.speaker,text:turn.text});
   const guidance=selectLiveGuidance({caseState,jurisdiction:'KR'});
   observed++;
   selected.push(guidance.primary.id);
   if(guidance.primary.id!=='UNCERTAIN_NO_HARD_WARNING'&&firstGuidanceTurn===null)firstGuidanceTurn=index+1;
   if(['DO_NOT_TRANSFER','EMERGENCY_CONTACT_GUIDANCE','DO_NOT_DISCLOSE_PERSONAL_DATA'].includes(guidance.primary.id)&&firstPreventiveTurn===null)firstPreventiveTurn=index+1;
   if(scenario.category==='NORMAL'&&guidance.primary.id==='EMERGENCY_CONTACT_GUIDANCE')normalHardWarns++;
 }
 const criticalTurn=scenario.groundTruth.expectedCriticalTurn;
 if(scenario.category==='TRADITIONAL'||scenario.category==='EVOLVED'){
   if(typeof criticalTurn==='number'){
     criticalScenarios++;
     if(firstPreventiveTurn!==null&&firstPreventiveTurn<criticalTurn)preCritical++;
     if(firstPreventiveTurn!==null&&firstPreventiveTurn<=criticalTurn)byCritical++;
   }
 }
 byCategory[scenario.category]??={scenarios:0,guided:0};
 byCategory[scenario.category].scenarios++;
 byCategory[scenario.category].guided+=Number(firstGuidanceTurn!==null);
 rows.push({id:scenario.scenarioId,category:scenario.category,firstGuidanceTurn,firstPreventiveTurn,criticalTurn,finalCard:selected.at(-1)});
}
const report={version:'0.6.6',input:'60 locally authored synthetic scenarios / finalized-only prefixes',scenarios:scenarios.length,observedUtterancePrefixes:observed,
  normalEmergencyCards:normalHardWarns,criticalScenarios,preventiveBeforeCritical:preCritical,preventiveByCritical:byCritical,byCategory,
  limitations:['NOT actual Meta performance','NOT real-world sensitivity/specificity','Counterfactual prevention is not proven','Guidance is rule-based and in-memory','No real phone/bank/emergency integrations'],cases:rows};
const output=process.argv[2];if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,cases:undefined},null,2));
