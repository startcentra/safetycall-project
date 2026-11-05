import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {SCENARIOS} from '../demo/safety-challenge/scenarios.mjs';
import {classifyMessage,MESSAGE_FIXTURES} from '../src/modules/message-safety/index.ts';
import {createCase,applyCaseEvent,getCaseView} from '../src/modules/case/index.ts';
import {deriveTextAdvisory} from '../src/modules/text-benchmark/advisory.ts';
import {evaluateTextCorpus} from '../src/modules/text-benchmark/benchmark.ts';
import {MUTATIONS,mutateCases} from '../src/modules/text-benchmark/mutations.ts';
const corpus=JSON.parse(await readFile(new URL('../data/v137/text-corpus.json',import.meta.url),'utf8')).cases;
const stress=JSON.parse(await readFile(new URL('../data/v137/adversarial-holdout.json',import.meta.url),'utf8')).cases;

async function harness(scenarioId='txt_parcel_portal') {
 const app=createDemoServer({port:0});const {port}=await app.listen();const base=`http://127.0.0.1:${port}`;
 const create=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,mode:'verified'})});
 assert.equal(create.status,201);let state=await create.json();
 const parent={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.parentToken};
 const child={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.childToken};
 async function post(path,body,auth=parent){const r=await fetch(base+path,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(r.status===200&&value?.runId===state.runId)state=value;return {status:r.status,body:value};}
 async function cmd(path,extra={}){return post(path,{runId:state.runId,expectedVersion:state.version,...extra});}
 async function get(path,auth=parent){const r=await fetch(base+path,{headers:auth});return {status:r.status,body:await r.json()};}
 return {app,parent,child,post,cmd,get,base,get state(){return state},close:()=>app.close()};
}

test('v137 primary corpus: 32 synthetic cases, 18 risk patterns, 10 negatives, 4 undecidable',()=>{
 assert.equal(corpus.length,32);
 const result=evaluateTextCorpus(corpus);assert.equal(result.summary.cases,32);
 assert.equal(result.summary.positives,18);assert.equal(result.summary.negatives,10);assert.equal(result.summary.ambiguous,4);
 assert.equal(result.summary.tp,18);assert.equal(result.summary.fp,0);
 assert.equal(result.modelCalled,false);assert.equal(result.noAutomaticFinancialAction,true);
 assert.equal(result.rows.every(x=>x.timeline.every(y=>y.automaticFinancialAction===false)),true);
});
test('v137 adversarial suite is honest: retains known Unicode obfuscation miss, no negative alarms',()=>{
 const r=evaluateTextCorpus(stress);assert.equal(r.summary.cases,23);assert.equal(r.summary.positives,12);
 assert.equal(r.summary.tp,11);assert.equal(r.summary.fn,1);assert.equal(r.summary.fp,0);
 assert.equal(r.rows.find(x=>x.id==='txt_held_unicode_spacing').status,'GAP');
});
test('v137 scenario labels do not enter production detector: identical prefixes yield identical outputs',()=>{
 const original=corpus[0];let state=createCase('test_prefix');
 for(const [i,t] of original.turns.slice(0,2).entries())state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:'evt_'+i,turnId:'turn_'+i,revision:0,absoluteIndex:i,speaker:t.speaker,text:t.text});
 const prefix=original.turns.slice(0,2).map((x,i)=>({...x,turnId:'turn_'+i}));
 const a=deriveTextAdvisory(prefix);const b=deriveTextAdvisory(prefix);assert.deepEqual(a,b);assert.equal(a.level,'NONE');
 assert.equal(getCaseView(state).assessment.riskBand,'LOW');
 assert.equal(a.probability,null);assert.equal(a.modelCalled,false);
});
test('v137 quoted educational advice, negative requests, and user-only claims do not trigger added advisory',()=>{
 const scripts=[
  [{speaker:'caller',text:'피싱 예방 교육에서 범인은 인증번호를 알려주세요라고 했다는 사례입니다.'}],
  [{speaker:'caller',text:'비밀번호를 전화로 알려주지 마세요. 공식 경로로 확인하세요.'}],
  [{speaker:'user',text:'나는 가족에게 급히 상품권 코드를 보내라고 사기 연락을 받았어요.'}],
  [{speaker:'caller',text:'정상 택배 안내이며 링크는 클릭하지 마세요.'}],
 ];
 for(const [i,ts] of scripts.entries()){
  const a=deriveTextAdvisory(ts.map((x,k)=>({...x,turnId:`turn_${k}`})));
  assert.equal(a.level,'NONE',`counterexample ${i}`);
 }
});
test('v137 mixed negation and later positive request cannot bypass canonical risk',()=>{
 const text='송금하지 마세요. 대신 지금 새 계좌로 즉시 송금하세요.';
 const state=applyCaseEvent(createCase('mixed_repair'),{type:'UTTERANCE_FINAL',caseId:'mixed_repair',eventId:'ev1',turnId:'x1',revision:0,absoluteIndex:0,speaker:'caller',text});
 assert.notEqual(deriveTextAdvisory([{turnId:'x1',speaker:'caller',text}]).level,'NONE');
 assert.ok(getCaseView(state).assessment.riskIndex>0);
});
test('v137 revision/retraction removes prior advisory when active transcript changes',()=>{
 const before=[{turnId:'a',speaker:'caller',text:'검찰 수사관이라고 합니다.'},{turnId:'b',speaker:'caller',text:'당신 명의가 대포통장 범죄에 연루됐습니다.'}];
 assert.notEqual(deriveTextAdvisory(before).level,'NONE');
 const after=[before[0],{turnId:'b',speaker:'caller',text:'공식 문의 번호는 직접 찾으세요.'}];
 assert.equal(deriveTextAdvisory(after).level,'NONE');
 assert.equal(deriveTextAdvisory([before[0]]).level,'NONE');
});
test('v137 plain-text and obfuscated whitespace preserve evidence without network calls',()=>{
 const ts=[{turnId:'x',speaker:'caller',text:'검찰 수사관입니다.'},{turnId:'y',speaker:'caller',text:'당신 명의가 대포통장 범죄에 연루됐습니다.'}];
 const a=deriveTextAdvisory(ts);const b=deriveTextAdvisory(ts.map(t=>({...t,text:t.text.replaceAll(' ','​ ')})));
 assert.equal(a.level,'VERIFY');assert.equal(b.level,'VERIFY');assert.deepEqual(a.evidence.map(e=>e.code),b.evidence.map(e=>e.code));
});
test('v137 all fixture scripts have bounded locally synthetic content and known source tags',()=>{
 for(const c of corpus){
  assert.equal(SCENARIOS[c.id].turns.length,c.turns.length);assert.ok(c.turns.length<=8);
  for(const t of c.turns){assert.ok(t.text.length<600);assert.ok(['caller','user'].includes(t.speaker));assert.doesNotMatch(t.text,/https?:\/\/|@[a-z]+\./i);}
  assert.ok(/^txt_/.test(c.id));assert.ok(c.sourceId);
 }
 assert.equal(Object.keys(SCENARIOS).length,38);
});
test('v137 HTTP: real Case ID, stepwise transcript, advisory, no automatic money movement',async()=>{
 const h=await harness('txt_parcel_portal');try{
  assert.equal(h.state.provider,'TEXT_ONLY_SYNTHETIC_FIXTURE');assert.equal(h.state.textAdvisory.level,'NONE');
  const id=h.state.runId;for(let i=0;i<4;i++){const x=await h.cmd('/api/advance');assert.equal(x.status,200);assert.equal(x.body.runId,id);assert.equal(x.body.step,i+1);}
  assert.equal(h.state.textAdvisory.level,'VERIFY');assert.ok(h.state.textAdvisory.evidence.some(e=>e.code==='WEB_IDENTITY_FUNNEL'));
  assert.ok(h.state.textAdvisory.evidence.every(e=>e.turnIds.every(id=>/^turn_/.test(id))));
  assert.equal(h.state.externalActionPerformed,false);assert.equal(h.state.safeBank.status,'READY');assert.equal(h.state.mockCard.status,'ACTIVE');
 }finally{await h.close()}
});
test('v137 HTTP: corpus evaluation is authenticated read-only and records synthetic metrics',async()=>{
 const h=await harness();try{
  assert.ok([401,403].includes((await h.get('/api/text/benchmark',{})).status));
  const r=await h.get('/api/text/benchmark');assert.equal(r.status,200);assert.equal(r.body.summary.cases,32);
  assert.equal(r.body.modelCalled,false);assert.equal(r.body.actualStt,false);
  assert.equal(r.body.noAutomaticFinancialAction,true);
  assert.equal(h.state.version,(await h.get('/api/state')).body.version);
  assert.equal((await h.get('/api/text/benchmark',h.child)).status,403);
 }finally{await h.close()}
});
test('v137 text-only cases reject audio fixture mixing at server boundary',async()=>{
 const h=await harness('txt_parcel_portal');try{
  const r=await h.cmd('/api/voice/fixture',{event:{source:'MOCK_ASR_FIXTURE',consented:true,operation:'FINAL',turnId:'test_line_01',revision:0,speaker:'caller',text:'송금하세요',quality:'FINAL'}});
  assert.equal(r.status,409);assert.equal(r.body.code,'POLICY_DENIED');
  assert.equal(h.state.step,0);assert.equal(h.state.textAdvisory.level,'NONE');
  assert.equal((await h.cmd('/api/advance')).status,200);
 }finally{await h.close()}
});
test('v137 HTTP: unknown arbitrary user-supplied scenario content is not accepted',async()=>{
 const h=await harness();try{
  const bogus={runId:h.state.runId,expectedVersion:h.state.version,scenarioId:'txt_untrusted_new',text:'http://malicious.invalid'};
  const r=await h.post('/api/reset',bogus);assert.notEqual(r.status,200);
  const s=await h.get('/api/state');assert.equal(s.body.runId,h.state.runId);
 }finally{await h.close()}
});
test('v137 HTTP: normal counterexample stays LOW; post-call follow-up remains available',async()=>{
 const h=await harness('txt_bank_fraud_education');try{
  for(let i=0;i<3;i++)assert.equal((await h.cmd('/api/advance')).status,200);
  assert.equal(h.state.risk.band,'LOW');assert.equal(h.state.textAdvisory.level,'NONE');
  assert.equal((await h.cmd('/api/action',{action:'END_CALL'})).status,200);
  assert.ok(h.state.callEndedAt);assert.ok(h.state.postCall);
  assert.equal((await h.cmd('/api/advance')).status,409);
  assert.equal(h.state.externalActionPerformed,false);
 }finally{await h.close()}
});
test('v137 HTTP: message quarantine still holds in new text-only case',async()=>{
 const h=await harness('txt_prosecutor_case');try{
  for(let i=0;i<3;i++)assert.equal((await h.cmd('/api/advance')).status,200);
  assert.equal((await h.cmd('/api/messages/mock-receive',{fixtureId:'prosecutor-bait',consented:true})).status,200);
  const m=h.state.messages.entries[0];assert.equal(m.verdict,'QUARANTINED');
  assert.equal((await h.cmd('/api/messages/link-attempt',{messageId:m.id,attemptId:'msg_attempt_v137test0001'})).status,200);
  assert.equal(h.state.messages.lastAttempt.blocked,true);assert.equal(h.state.externalActionPerformed,false);
 }finally{await h.close()}
});
test('v137 deterministic 5-way mutations run 275 additional text simulations without side effects',()=>{
 assert.equal(MUTATIONS.length,5);
 for(const mode of MUTATIONS){
  const rows=mutateCases([...corpus,...stress],mode);
  assert.equal(rows.length,55);
  const r=evaluateTextCorpus(rows);
  assert.equal(r.summary.cases,55);
  assert.equal(r.noAutomaticFinancialAction,true);
  assert.equal(r.rows.every(x=>x.timeline.every(y=>y.automaticFinancialAction===false)),true);
 }
});
test('v137 legacy list retains six stable IDs, new text list has 32 IDs',async()=>{
 const h=await harness();try{
  const old=await h.get('/api/scenarios');assert.equal(old.status,200);
  assert.deepEqual(new Set(old.body.scenarios.map(x=>x.id)),new Set(['kidnap','bail','benign','otp','remote','uncertain']));
  const newer=await h.get('/api/text/scenarios');assert.equal(newer.status,200);
  assert.equal(newer.body.scenarios.length,32);
  assert.equal(newer.body.mockOnly,true);assert.equal(newer.body.metaCalled,false);
 }finally{await h.close()}
});
test('v137 UI: static scenario options, text advisory, synthetic-only benchmark controls exist',async()=>{
 const html=await readFile(new URL('../demo/safety-challenge/public/mobile.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../demo/safety-challenge/public/mobile.js',import.meta.url),'utf8');
 for(const id of ['txt_parcel_portal','txt_bank_fraud_education','txt_job_reply_yes','text-benchmark-run','text-advisory-status'])assert.match(html,new RegExp(id));
 assert.match(js,/textAdvisory/);assert.match(js,/text\/benchmark/);
 assert.doesNotMatch(js,/innerHTML\s*=\s*s\.textAdvisory/);
});

test('v137: added four smishing variants quarantined and normal bank education preserved',()=>{
 for(const id of ['toll-fee-bait','task-job-bait','wedding-qr-bait','loan-fee-bait']){
  const m=classifyMessage(id);assert.equal(m.verdict,'QUARANTINED',id);
  assert.equal(m.externalNavigation,false);assert.match(MESSAGE_FIXTURES[id].link,/example\.invalid/);
 }
 assert.equal(classifyMessage('bank-education-normal').verdict,'REVIEW_ONLY');
 assert.equal(Object.keys(MESSAGE_FIXTURES).length,11);
});
test('v137 HTTP: new smishing variants cannot launch an external link',async()=>{
 const h=await harness('txt_parcel_portal');try{
  for(const fixtureId of ['toll-fee-bait','task-job-bait']){
   const recv=await h.cmd('/api/messages/mock-receive',{fixtureId,consented:true});assert.equal(recv.status,200);
   const msg=h.state.messages.entries.at(-1);assert.equal(msg.verdict,'QUARANTINED');
   const attempt=await h.cmd('/api/messages/link-attempt',{messageId:msg.id,attemptId:'msg_attempt_v137_'+fixtureId});
   assert.equal(attempt.status,200);assert.equal(h.state.messages.lastAttempt.blocked,true);
   assert.equal(h.state.externalActionPerformed,false);
  }
 }finally{await h.close()}
});

test('v137 surprise probe: 18 new cases execute without AI calls or financial actions; no accuracy target hard-coded',async()=>{
 const x=JSON.parse(await readFile(new URL('../data/v137/surprise-probe.json',import.meta.url),'utf8')).cases;
 assert.equal(x.length,18);
 const r=evaluateTextCorpus(x);
 assert.equal(r.summary.positives,10);assert.equal(r.summary.negatives,6);assert.equal(r.summary.ambiguous,2);
 assert.equal(r.modelCalled,false);assert.equal(r.noAutomaticFinancialAction,true);
 assert.equal(r.rows.every(row=>row.timeline.every(turn=>turn.automaticFinancialAction===false)),true);
});
