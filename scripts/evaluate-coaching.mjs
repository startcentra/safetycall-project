/** Synthetic offline evaluation, no prompt/model calls, no future conversation leakage. */
import {writeFileSync} from 'node:fs';
import {coachingCases} from '../src/modules/evaluation/coaching-cases.mjs';
import {createCase,applyCaseEvent,getCaseView} from '../src/modules/case/index.ts';
import {selectLiveGuidance} from '../src/modules/playbook/select.ts';
import {deriveEarlyCareEvidence} from '../demo/safety-challenge/care-plan.mjs';
import {selectActionCoaching} from '../demo/safety-challenge/coaching-policy.mjs';
import {sourceById} from '../src/modules/playbook/sources.ts';
const result=[];
for(const row of coachingCases){
 let state=createCase(row.id);
 state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:'observed_1',turnId:'u_1',revision:0,absoluteIndex:0,speaker:row.speaker,text:row.text});
 const view=getCaseView(state),guidance=selectLiveGuidance({caseState:state,jurisdiction:row.country});
 const advice=selectActionCoaching({caseState:state,guidance,jurisdiction:row.country,emergency:view.assessment.emergencyFlag,earlyEvidence:deriveEarlyCareEvidence(state)});
 result.push({id:row.id,country:row.country,category:row.category,split:row.split,expected:row.expectedKind,actual:advice.kind,
  correct:row.expectedKind===advice.kind,emergency:view.assessment.emergencyFlag,
  sourceCountryMismatch:advice.sourceIds.some(id=>sourceById(id)?.jurisdiction!==row.country),sourceIds:advice.sourceIds,actionId:advice.actionId});
}
const summarize=(subset)=>({count:subset.length,exactMatches:subset.filter(x=>x.correct).length,
 falsePositiveNormal:subset.filter(x=>x.category==='normal'&&x.actual!=='OBSERVE').length,
 missedRiskActions:subset.filter(x=>x.category==='risk'&&x.actual==='OBSERVE').length,
 emergencyMisses:subset.filter(x=>x.expected==='EMERGENCY'&&x.actual!=='EMERGENCY').length,
 emergencyFalseAlarms:subset.filter(x=>x.expected!=='EMERGENCY'&&x.actual==='EMERGENCY').length});
const breakdown=Object.fromEntries(['KR','US'].map(c=>[c,{all:summarize(result.filter(x=>x.country===c)),
 development:summarize(result.filter(x=>x.country===c&&x.split==='DEVELOPMENT')),
 holdout:summarize(result.filter(x=>x.country===c&&x.split==='HOLDOUT'))}]));
const report={version:'v0.9.1',scope:'Synthetic, developer-authored, NOT independent real-world evidence. Holdout labels are fixed but not blinded to authors.',
 approach:'One finalized caller turn per scenario. No future turns/labels are passed to decision code. 60 new scenarios: 30 KR, 30 US. Not comparable to 60-prefix original historical cohort.',
 summary:summarize(result),breakdown,countrySourceMismatch:result.filter(x=>x.sourceCountryMismatch).length,cases:result,
 limitations:['Expected action is a manually assigned synthetic label, not factual fraud ground truth.','Development and holdout are author-created; holdout is not independent external blind validation.','No measured user outcomes, no phone access, no Meta model calls, no real security decisions.']};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,cases:undefined},null,2));
