/** Offline only. No Meta credentials, voice, phone access, or real financial actions. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {evaluateSemanticCorpus} from '../src/modules/text-benchmark/evaluate-v138.ts';
import {evaluateTextCorpus} from '../src/modules/text-benchmark/benchmark.ts';
import {MUTATIONS,mutateCases} from '../src/modules/text-benchmark/mutations.ts';
const root=new URL('../data/',import.meta.url);
const load=async name=>JSON.parse(await readFile(new URL(name,root),'utf8')).cases;
const primary=await load('v137/text-corpus.json');
const stress=await load('v137/adversarial-holdout.json');
const surprise=await load('v137/surprise-probe.json');
const frozenPath=new URL('v138/frozen-probe.json',root);
const frozenBytes=await readFile(frozenPath);
const frozenDigest=createHash('sha256').update(frozenBytes).digest('hex');
const expected=(await readFile(new URL('v138/frozen-probe.sha256',root),'utf8')).trim().split(' ')[0];
if(expected!==frozenDigest)throw new Error('FROZEN_EVALUATION_CORPUS_CHANGED');
const frozen=JSON.parse(frozenBytes.toString('utf8')).cases;
const publicPath=new URL('v138/public-pattern-probe.json',root);
const publicBytes=await readFile(publicPath);
const publicDigest=createHash('sha256').update(publicBytes).digest('hex');
const publicExpected=(await readFile(new URL('v138/public-pattern-probe.sha256',root),'utf8')).trim().split(' ')[0];
if(publicDigest!==publicExpected)throw new Error('PUBLIC_EVALUATION_CORPUS_CHANGED');
const publicProbe=JSON.parse(publicBytes.toString('utf8')).cases;
const result={version:'v138',evaluationKind:'SELF_AUTHORED_SYNTHETIC_NO_LIVE_MODEL',frozenDigest,
 caution:'Frozen before implementation, but same-developer synthetic. Early frozen suite was consulted during debugging and is no longer a blind holdout. Public-pattern probe was first evaluated after the implementation was fixed; no detector retuning after its result.',
 baselines:{v137Primary:evaluateTextCorpus(primary).summary,v137Stress:evaluateTextCorpus(stress).summary,v137Surprise:evaluateTextCorpus(surprise).summary},
 v138Known:{primary:evaluateSemanticCorpus(primary).summary,stress:evaluateSemanticCorpus(stress).summary,surprise:evaluateSemanticCorpus(surprise).summary},
 frozen:evaluateSemanticCorpus(frozen),publicPattern:{digest:publicDigest,...evaluateSemanticCorpus(publicProbe)},
 mutationChecks:MUTATIONS.map(mode=>({mode,...evaluateSemanticCorpus(mutateCases([...primary,...stress],mode)).summary})),
 modelCalled:false,realStt:false,liveSmsBlock:false,bankActionCount:0,realWorldAccuracy:'NOT_VERIFIED'};
const dest=process.argv[2];
if(dest){const full=path.resolve(dest);
 if(!full.startsWith('/mnt/data/')&&!full.startsWith('/tmp/'))throw new Error('OUTSIDE_ONLY_OUTPUT');
 await mkdir(path.dirname(full),{recursive:true});await writeFile(full,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});}
console.log(JSON.stringify({frozenDigest,known:result.v138Known,frozen:result.frozen.summary,frozenGaps:result.frozen.rows.filter(r=>r.status==='GAP').map(r=>r.id),publicPattern:result.publicPattern.summary,publicPatternGaps:result.publicPattern.rows.filter(r=>r.status==='GAP').map(r=>r.id),mutations:result.mutationChecks,bankActionCount:0,modelCalled:false},null,2));
