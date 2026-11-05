import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canonicalizeText,extractTextSemantics,deriveUnifiedTextAdvisory,disabledTextSemanticPort,localMockTextSemanticPort} from '../src/modules/text-benchmark/semantic-v138.ts';
import {evaluateSemanticCorpus} from '../src/modules/text-benchmark/evaluate-v138.ts';
import {evaluateTextCorpus} from '../src/modules/text-benchmark/benchmark.ts';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
const stress=JSON.parse(await readFile(new URL('../data/v137/adversarial-holdout.json',import.meta.url),'utf8')).cases;
const surprise=JSON.parse(await readFile(new URL('../data/v137/surprise-probe.json',import.meta.url),'utf8')).cases;
const frozenBytes=await readFile(new URL('../data/v138/frozen-probe.json',import.meta.url));
const frozen=JSON.parse(frozenBytes.toString('utf8')).cases;
const caseBy=id=>[...stress,...surprise].find(x=>x.id===id);
const prefixOf=({turns},count=turns.length)=>turns.slice(0,count).map((x,i)=>({turnId:'line_'+i,speaker:x.speaker,text:x.text}));
const advisoryOf=(id,count)=>deriveUnifiedTextAdvisory(prefixOf(caseBy(id),count));

test('v138 normalization composes compatibility jamo BEFORE NFKC and preserves original input',()=>{
 const input='지금 ㅅㅗㅇㄱㅡㅁ 하세요';
 const result=canonicalizeText(input);assert.match(result.text,/송금/);
 assert.ok(result.steps.includes('COMPAT_JAMO'));assert.equal(input,'지금 ㅅㅗㅇㄱㅡㅁ 하세요');
 assert.match(canonicalizeText('ＱＲ\u200b코드').text,/qr코드/);
 assert.equal(canonicalizeText('검챨에서 송끔').text,'검찰에서 송금');
 assert.equal(canonicalizeText('ㄱㄱ').text.length>0,true);
});
test('v138 known misses: English tax, QR invitation, Hangul jamo, Unicode spacing',()=>{
 for(const [id,expected] of [['txt_probe_english_irs','ENGLISH_VERIFICATION_TRANSFER'],['txt_probe_qr_invitation','QR_IDENTITY_COLLECTION'],['txt_probe_jamo_camouflage','OBFUSCATED_PAYMENT_DIRECTIVE'],['txt_held_unicode_spacing','OBFUSCATED_PAYMENT_DIRECTIVE']]){
  const a=advisoryOf(id);
  assert.ok(a.evidence.some(e=>e.code===expected),`${id} expected ${expected}`);
  assert.notEqual(a.level,'NONE',id);
  assert.equal(a.modelCalled,false);
  assert.equal(a.automaticFinancialAction,false);
 }
});
test('v138 no look-ahead: risk cues only after observed prefix',()=>{
 const a=advisoryOf('txt_probe_qr_invitation',1);
 const b=advisoryOf('txt_probe_qr_invitation',2);
 assert.equal(a.level,'NONE');assert.ok(b.evidence.some(e=>e.code==='QR_IDENTITY_COLLECTION'));
 assert.ok(b.evidence.every(e=>e.turnIds.every(t=>['line_0','line_1'].includes(t))));
});
test('v138 quotation, negation, and speaker boundary protect from added intent alarms',()=>{
 const samples=[
  [{turnId:'a',speaker:'caller',text:'사기 예방 교육에서 QR에 주민등록번호를 작성하라고 말했다는 사례입니다.'}],
  [{turnId:'a',speaker:'caller',text:'QR로 들어가 주민등록번호를 작성하지 마세요.'}],
  [{turnId:'a',speaker:'caller',text:'은행 안내: 인증번호는 알려주지 마세요. 검찰을 사칭한 사람을 조심하세요.'}],
  [{turnId:'a',speaker:'user',text:'사진 QR로 주민등록번호를 작성하세요.'}],
  [{turnId:'a',speaker:'caller',text:'보이스피싱 뉴스입니다. 범인은 자금을 verification wallet으로 transfer했다고 보도했습니다.'}],
 ];
 for(const [i,turns] of samples.entries()){
  assert.equal(extractTextSemantics(turns).observations.length,0,`case ${i}`);
 }
});
test('v138 mixed negation must retain later positive request, without invented evidence',()=>{
 const turns=[{turnId:'one',speaker:'caller',text:'송금하지 마세요. 대신 새 계좌로 송금해 주세요.'}];
 const a=deriveUnifiedTextAdvisory(turns);
 assert.notEqual(a.level,'NONE');assert.ok(a.evidence.every(e=>e.turnIds.every(id=>id==='one')));
});
test('v138 revision/retraction removes semantic advisory from projected active transcript',()=>{
 const before=[{turnId:'a',speaker:'caller',text:'결혼식 초대장입니다.'},{turnId:'b',speaker:'caller',text:'사진의 QR로 이동해서 주민등록번호를 작성하세요.'}];
 const after=[before[0],{turnId:'b',speaker:'caller',text:'공식 웹사이트에서 행사 시간만 확인해 주세요.'}];
 assert.notEqual(deriveUnifiedTextAdvisory(before).level,'NONE');
 assert.equal(deriveUnifiedTextAdvisory(after).level,'NONE');
 assert.equal(deriveUnifiedTextAdvisory([before[0]]).level,'NONE');
});
test('v138 disabled AI port is genuinely disabled; local mock is deterministic read only',async()=>{
 const t=[{turnId:'x',speaker:'caller',text:'지금 ㅅㅗㅇㄱㅡㅁ 하셔야 합니다.'}];
 const disabled=await disabledTextSemanticPort.analyze(t);assert.equal(disabled.mode,'DISABLED');assert.deepEqual(disabled.observations,[]);
 const mock=await localMockTextSemanticPort.analyze(t);
 assert.equal(mock.modelCalled,false);assert.equal(mock.financialExecutionAllowed,false);assert.equal(mock.probability,null);
 assert.deepEqual(mock,await localMockTextSemanticPort.analyze(t));
});
test('v138 evaluate known v137 gap cases without modifying historic v137 baseline outputs',()=>{
 assert.equal(evaluateTextCorpus(stress).summary.fn,1);
 assert.equal(evaluateTextCorpus(surprise).summary.fn,3);
 assert.equal(evaluateSemanticCorpus(stress).summary.fn,0);
 assert.equal(evaluateSemanticCorpus(surprise).summary.fn,0);
});
test('v138 frozen evaluation corpus SHA was sealed preimplementation; do not tune after evaluation',async()=>{
 const sha=createHash('sha256').update(frozenBytes).digest('hex');
 const expected=(await readFile(new URL('../data/v138/frozen-probe.sha256',import.meta.url),'utf8')).trim().split(' ')[0];
 assert.equal(sha,expected);assert.equal(frozen.length,20);
 const result=evaluateSemanticCorpus(frozen);
 assert.equal(result.mode,'OFFLINE_SYNTHETIC_TEXT_SEMANTIC_V138');
 assert.equal(result.summary.positives,10);assert.equal(result.summary.negatives,8);assert.equal(result.summary.ambiguous,2);
 assert.equal(result.noAutomaticFinancialAction,true);assert.equal(result.modelCalled,false);
 assert.ok(result.rows.every(row=>row.timeline.every(t=>t.financialAction===false&&t.modelCalled===false)));
});
test('v138 HTTP authenticated read-only benchmark; sensitive policy state unchanged',async()=>{
 const app=createDemoServer({port:0}),{port}=await app.listen();const base=`http://127.0.0.1:${port}`;
 try{
  const c=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:'txt_wedding_qr',mode:'verified'})});assert.equal(c.status,201);
  const session=await c.json();const auth={'X-SafeCall-Session':session.sessionCredentials.sessionId,'X-SafeCall-Token':session.sessionCredentials.parentToken};
  assert.ok([401,403].includes((await fetch(base+'/api/text/benchmark/v138')).status));
  const r=await fetch(base+'/api/text/benchmark/v138',{headers:auth});assert.equal(r.status,200);
  const report=await r.json();assert.equal(report.summary.cases,20);assert.equal(report.modelCalled,false);
  const before=await (await fetch(base+'/api/state',{headers:auth})).json();
  assert.equal(before.version,session.version);assert.equal(before.externalActionPerformed,false);
  assert.equal(before.safeBank.status,'READY');
  assert.equal((await fetch(base+'/api/text/benchmark/v138',{headers:auth,method:'POST'})).status!==200,true);
 }finally{await app.close();}
});
test('v138 HTTP script scene reflects unified advisory without changing canonical scoring',async()=>{
 const app=createDemoServer({port:0}),{port}=await app.listen();const base=`http://127.0.0.1:${port}`;
 try{
  const c=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:'txt_wedding_qr',mode:'verified'})});const created=await c.json();
  const auth={'X-SafeCall-Session':created.sessionCredentials.sessionId,'X-SafeCall-Token':created.sessionCredentials.parentToken,'Content-Type':'application/json'};
  let version=created.version,last=created;
  for(let i=0;i<3;i++){const r=await fetch(base+'/api/advance',{method:'POST',headers:auth,body:JSON.stringify({runId:created.runId,expectedVersion:version})});assert.equal(r.status,200);last=await r.json();version=last.version;}
  assert.equal(last.runId,created.runId);
  assert.equal(last.textAdvisory.modelCalled,false);
  assert.ok(last.textAdvisory.evidence.every(e=>e.turnIds.every(id=>last.transcript.some(t=>t.turnId===id))));
  assert.equal(last.externalActionPerformed,false);
 }finally{await app.close();}
});
test('v138 UI is explicit about synthetic mode, legacy baseline and sealed evaluation',async()=>{
 const html=await readFile(new URL('../demo/safety-challenge/public/mobile.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../demo/safety-challenge/public/mobile.js',import.meta.url),'utf8');
 assert.match(html,/v138-benchmark-run/);assert.match(js,/PROVISIONAL_TEXT_REVIEW/);
 assert.match(js,/\/api\/text\/benchmark\/v138/);
 assert.doesNotMatch(js,/innerHTML\s*=\s*s\.textAdvisory/);
});

test('v138 2026 public-pattern probe remains locked; uncovered false negatives are reported instead of retuned',async()=>{
 const bytes=await readFile(new URL('../data/v138/public-pattern-probe.json',import.meta.url));
 const digest=createHash('sha256').update(bytes).digest('hex');
 const expected=(await readFile(new URL('../data/v138/public-pattern-probe.sha256',import.meta.url),'utf8')).trim().split(' ')[0];
 assert.equal(digest,expected);
 const probe=JSON.parse(bytes.toString('utf8')).cases;
 assert.equal(probe.length,12);
 const result=evaluateSemanticCorpus(probe);
 assert.equal(result.summary.positives,7);
 assert.equal(result.summary.negatives,4);
 assert.equal(result.summary.ambiguous,1);
 assert.equal(result.modelCalled,false);
 assert.ok(result.rows.every(r=>r.timeline.every(t=>t.financialAction===false)));
});
