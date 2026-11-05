/** SafeCall v1.37; wholly offline synthetic scenario evaluation. No AI calls. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {evaluateTextCorpus} from '../src/modules/text-benchmark/benchmark.ts';
import {MUTATIONS,mutateCases} from '../src/modules/text-benchmark/mutations.ts';
const primary=JSON.parse(await readFile(new URL('../data/v137/text-corpus.json',import.meta.url),'utf8')).cases;
const stress=JSON.parse(await readFile(new URL('../data/v137/adversarial-holdout.json',import.meta.url),'utf8')).cases;
const surprise=JSON.parse(await readFile(new URL('../data/v137/surprise-probe.json',import.meta.url),'utf8')).cases;
const result={version:'v137',testMode:'OFFLINE_SYNTHETIC_MOCK',runAt:new Date().toISOString(),
 caveats:['합성 정답으로 튜닝한 뒤 같은 데이터에 재평가함. 실제 정확도 아님','adversarial stress suite도 튜닝에 활용됐으므로 독립 holdout 아님','STT/Meta LIVE/OS SMS/실제 금융 실행 없음'],
 primary:evaluateTextCorpus(primary),adversarial:evaluateTextCorpus(stress),surprise:evaluateTextCorpus(surprise),
 metamorphic:MUTATIONS.map(mode=>({mode,...evaluateTextCorpus(mutateCases([...primary,...stress],mode)).summary}))};
const output=process.argv[2];
if(output){const full=path.resolve(output);if(!full.startsWith('/mnt/data/')&& !full.startsWith('/tmp/'))throw new Error('EVAL_OUTPUT_MUST_BE_OUTSIDE_SOURCE');await mkdir(path.dirname(full),{recursive:true});await writeFile(full,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});}
console.log(JSON.stringify({version:'v137',primary:result.primary.summary,adversarial:result.adversarial.summary,surprise:result.surprise.summary,surpriseGaps:result.surprise.rows.filter(r=>r.status==='GAP').map(r=>r.id),remainingGaps:result.adversarial.rows.filter(r=>r.status==='GAP').map(r=>r.id),mutationSummaries:result.metamorphic,modelCalled:false,realWorldPerformance:'NOT_VERIFIED'},null,2));
