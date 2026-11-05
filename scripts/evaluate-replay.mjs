import { writeFileSync, mkdirSync } from 'node:fs';
import { evaluateDataset, validateDataset } from '../src/modules/evaluation/index.ts';
const errors = validateDataset();
if (errors.length) throw Error(`Dataset invalid: ${errors.join('; ')}`);
const report = evaluateDataset();
const fmt = n => n === null ? 'N/A' : (n * 100).toFixed(1) + '%';
console.log('SafeCall v0.4 - synthetic, offline benchmark (NOT real-world accuracy)');
console.log(`Scenarios ${report.sampleSize}; binary ${report.binaryEvaluated}; ambiguous ${report.ambiguousExcluded}`);
for (const [name, r] of [['Keyword-only comparator',report.baseline],['assessTriage',report.canonical]]) {
  console.log(`${name}: TP=${r.matrix.TP} FP=${r.matrix.FP} TN=${r.matrix.TN} FN=${r.matrix.FN}; Precision=${fmt(r.precision)} Recall=${fmt(r.recall)} F1=${fmt(r.f1)} FPR=${fmt(r.falsePositiveRate)}`);
}
console.log(`Trigger recall on synthetic scams: ${fmt(report.triggerRecall)}; first warning BEFORE critical: ${report.warningBeforeCriticalCount}/${report.criticalScenarioCount}; BY critical: ${report.warningByCriticalCount}/${report.criticalScenarioCount}`);
console.log('By category:', JSON.stringify(report.perCategory));
const misses=report.cases.filter(x => x.label==='SCAM' && !x.warning);
const falseAlerts=report.cases.filter(x => x.label==='NORMAL' && x.warning);
console.log('Misses:', JSON.stringify(misses.map(x=>x.id)));
console.log('False alerts:', JSON.stringify(falseAlerts.map(x=>x.id)));
mkdirSync('reports', {recursive:true});
writeFileSync('reports/replay-results.json',JSON.stringify({...report,generatedAt:new Date().toISOString(),analysisMode:'OFFLINE_RULE_EXPERIMENT'},null,2)+'\n');
console.log('Saved: reports/replay-results.json');
