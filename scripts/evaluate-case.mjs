import {scenarios,replayScenario,evaluateDataset} from '../src/modules/evaluation/index.ts';
import {buildCaseTimeline,getCaseView} from '../src/modules/case/index.ts';
let comparable=0,diverged=0,earlyTimelineWarnings=0;
const firstExamples=[];
for(const s of scenarios){
 const baseline=replayScenario(s);
 const timeline=buildCaseTimeline(s.scenarioId,s.turns.map(({turnId,speaker,text})=>({turnId,speaker,text})));
 for(const [i,state] of timeline.entries()){
  const current=getCaseView(state).assessment;
  comparable++;
  if(current.riskIndex!==baseline[i].assessment.riskIndex || current.emergencyFlag!==baseline[i].assessment.emergencyFlag){
   diverged++;
   if(firstExamples.length<10)firstExamples.push(`${s.scenarioId} @ ${i+1}`);
  }
 }
 if(timeline.some(s=>getCaseView(s).assessment.riskBand!=='LOW'))earlyTimelineWarnings++;
}
console.log(JSON.stringify({note:'v0.6.5 experimental case timeline (OFFLINE rule scores, not Meta AI). Baseline remains unchanged',scenarios:scenarios.length,comparedPrefixSteps:comparable,prefixDifferences:diverged,firstExamples,warningCases:earlyTimelineWarnings,legacy:evaluateDataset().canonical.matrix},null,2));
