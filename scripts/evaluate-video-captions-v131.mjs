/** Zero-dependency, no raw audio/YouTube download, no API requests. */
import {readFile} from 'node:fs/promises';
import {evaluateCaptionTimeline} from '../src/modules/voice-benchmark/index.ts';
const dataset=JSON.parse(await readFile(new URL('../data/v131/video-caption-observations.json',import.meta.url),'utf8'));
const reports=[];
for(const c of dataset.cases){
 const checkpoints=evaluateCaptionTimeline(c,5000,110000);
 const first=e=>checkpoints.find(c=>e(c))?.atMs??null;
 reports.push({caseId:c.id,mode:'SPARSE_CAPTION_OBSERVATION_NOT_STT',observations:c.observations.length,
  observedWindowMs:[0,110000],firstExistingRuleWarningMs:first(c=>c.riskBand!=='LOW'),
  firstSupplementaryContextMs:first(c=>c.contextEvidence.length>0),
  firstGuidanceMs:first(c=>c.protection==='VERIFY_OFFICIAL_CHANNEL'),
  checkpoints:checkpoints.map(c=>({atMs:c.atMs,observations:c.observationCount,riskIndex:c.riskIndex,riskBand:c.riskBand,contextSignals:[...new Set(c.contextEvidence.map(x=>x.code))]}))});
}
console.log(JSON.stringify({status:'CAPTION_ONLY_BENCHMARK',actualStt:false,independentSttMetrics:'NOT_VERIFIED',realTimeDetection:'NOT_VERIFIED',modelExternalCalls:0,reports},null,2));
