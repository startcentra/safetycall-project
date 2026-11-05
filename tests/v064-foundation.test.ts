import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessTriage} from '../src/modules/risk-triage/index.ts';
import {CostGuard} from '../src/modules/cost/guard.ts';
import {LiveMetaProvider,MetaProviderError,buildContext} from '../src/modules/analysis/meta-provider.ts';
import {issueSparkSessionTicket,verifySparkSessionTicket} from '../src/modules/security/live-auth.ts';

const dangerous=[{speaker:'caller' as const,text:'당신 아들을 해칠 겁니다.'},...Array.from({length:10},(_,i)=>({speaker:'caller' as const,text:'평범한 대화입니다 '+i}))];
test('old threatening evidence survives more than eight benign turns',()=>{
 const assessment=assessTriage({turns:dangerous});
 assert.equal(assessment.emergencyFlag,true);
 assert.ok(assessment.signals.some(s=>s.code==='DIRECT_THREAT'&&s.turn===0));
});
test('long utterance tail is not skipped',()=>{
 const assessment=assessTriage({turns:[{speaker:'caller',text:'안녕하세요 '.repeat(200)+'지금 당장 송금하세요'}]});
 assert.ok(assessment.signals.some(s=>s.code==='MONEY_REQUEST'&&s.evidence.includes('송금하세요')));
});
test('signed SPARK ticket keeps the same cost session for repeated requests and expires',()=>{
 const a='access_secret_that_is_long_enough_24',k='hmac_secret_that_is_long_enough_24';
 const t=issueSparkSessionTicket(a,a,k,1000);
 assert.equal(verifySparkSessionTicket(t,k,2000).sid,verifySparkSessionTicket(t,k,3000).sid);
 assert.throws(()=>verifySparkSessionTicket(t,k,601002));
});
test('over-reservation settlement persists actual usage and blocks further billed reservations',()=>{
 const dir=mkdtempSync(join(tmpdir(),'safecall-v064-'));
 try{
  const config={file:join(dir,'ledger.json'),totalUsd:5,initialApprovedUsd:5,dailyUsd:5,sessionUsd:5,maxConcurrent:1,killSwitch:false,liveEnabled:true,spendApproved:true};
  const guard=new CostGuard(config);const id=guard.reserve('SPARK',0.01,'same-call');
  guard.settle(id,2);
  assert.equal(guard.stats().measuredUsageUsd,2);
  assert.equal(guard.stats().liveAllowed,false);
  assert.throws(()=>guard.reserve('SPARK',0.01,'same-call'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
const input={turns:[{turnId:'T1',speaker:'caller' as const,text:'당신 가족을 해치겠습니다. 지금 송금하세요.'}]};
const validAnalysis={riskLevel:'HIGH',riskIndex:80,manipulationIndex:70,detectedSignals:['DIRECT_THREAT','MONEY_REQUEST'],manipulationTechniques:['FEAR_INDUCTION'],requestedActions:[],evidenceUtteranceIds:['T1'],normalConversationEvidence:[],uncertainty:'사실 검증 불가',recommendedActionCodes:['CONTACT_112'],emergencyFlag:true};
test('SPARK request has bounded output tokens and rejects length finish reason',async()=>{
 let sent: {max_completion_tokens:number}={max_completion_tokens:0};
 const fake=async(_url:string|URL|Request,init?:RequestInit)=>{sent=JSON.parse(String(init?.body)) as {max_completion_tokens:number};return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:JSON.stringify(validAnalysis)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}),{status:200});};
 await assert.rejects(()=>new LiveMetaProvider({apiKey:'FAKE',fetchFn:fake as typeof fetch}).analyze(buildContext(input)),(e:unknown)=>e instanceof MetaProviderError&&e.kind==='INVALID_RESPONSE');
 assert.ok(Number.isSafeInteger(sent.max_completion_tokens) && sent.max_completion_tokens>0 && sent.max_completion_tokens<=1200);
});
import {emptyRiskCheckpoint,upsertFinalEvidence,retractFinalEvidence,assessWithCheckpoint} from '../src/modules/conversation/risk-checkpoint.ts';
test('risk checkpoint retains threat and supports an explicit higher-revision correction',()=>{
 let c=emptyRiskCheckpoint('case-1');
 c=upsertFinalEvidence(c,{callId:'case-1',turnId:'a',revision:0,absoluteIndex:0,speaker:'caller',text:'당신 아들을 해칠 겁니다.'});
 const v=c.version;
 c=upsertFinalEvidence(c,{callId:'case-1',turnId:'a',revision:0,absoluteIndex:0,speaker:'caller',text:'변조'});
 assert.equal(c.version,v);
 assert.equal(assessWithCheckpoint(c,Array.from({length:12},()=>({speaker:'caller',text:'평범한 대화'}))).emergencyFlag,true);
 c=upsertFinalEvidence(c,{callId:'case-1',turnId:'a',revision:1,absoluteIndex:0,speaker:'caller',text:'안녕하세요'});
 assert.equal(assessWithCheckpoint(c).emergencyFlag,false);
 c=retractFinalEvidence(c,{callId:'case-1',turnId:'a',revision:2});
 assert.equal(c.turns[0].status,'RETRACTED');
 assert.throws(()=>upsertFinalEvidence(c,{callId:'other',turnId:'b',revision:0,absoluteIndex:1,speaker:'caller',text:'위험'}));
});
test('uncertain speaker cannot be silently promoted into attacker evidence',()=>{
 const c=upsertFinalEvidence(emptyRiskCheckpoint('call1'),{callId:'call1',turnId:'T1',revision:0,absoluteIndex:0,speaker:'unknown',text:'아들을 해치겠다'});
 assert.equal(assessWithCheckpoint(c).emergencyFlag,false);
});

import {applyVoiceEvent,emptyVoiceState} from '../src/modules/audio/transcript.ts';
import {validateMetaInput,MetaValidationError} from '../src/modules/analysis/meta-validation.ts';
import {getSparkOutputCap} from '../src/modules/analysis/meta-settings.ts';
test('explicit transcript correction updates finalized turn; duplicate or old revision cannot revert it',()=>{
 let a=applyVoiceEvent(emptyVoiceState(),{type:'speechComplete',turnId:1,transcript:'송금하세요'});
 a=applyVoiceEvent(a,{type:'speechCorrection',turnId:1,revision:1,transcript:'송금하지 마세요'});
 a=applyVoiceEvent(a,{type:'speechCorrection',turnId:1,revision:1,transcript:'송금하세요'});
 assert.equal(a.finalized[0].text,'송금하지 마세요');
 assert.equal(a.finalized[0].speaker,'unknown');
});
test('explicit Meta 8x800 limits and uncertain speaker are validated (no truncation)',()=>{
 const unknown=validateMetaInput({turns:[{turnId:'unknown1',speaker:'unknown',text:'지금 송금하세요'}]});
 assert.equal(unknown.turns[0].speaker,'unknown');
 assert.throws(()=>validateMetaInput({turns:[{turnId:'x',speaker:'caller',text:'x'.repeat(801)}]}),MetaValidationError);
 assert.throws(()=>validateMetaInput({turns:Array.from({length:9},(_,i)=>({turnId:`T${i}`,speaker:'caller',text:'hi'}))}),MetaValidationError);
});
test('invalid output cap configuration fails closed, not silently unlimited',()=>{
 assert.equal(getSparkOutputCap({} as NodeJS.ProcessEnv),1200);
 for(const v of ['NaN','', '0','1234567', '-4'])assert.equal(getSparkOutputCap({...process.env,META_MAX_OUTPUT_TOKENS:v}),0);
});
test('same call SPARK reservations share the same session cap',()=>{
 const dir=mkdtempSync(join(tmpdir(),'safecall-callcap-'));
 try{
  const g=new CostGuard({file:join(dir,'ledger.json'),totalUsd:5,initialApprovedUsd:5,dailyUsd:5,sessionUsd:0.05,maxConcurrent:1,killSwitch:false,liveEnabled:true,spendApproved:true});
  const r1=g.reserve('SPARK',0.02,'spark_same');g.settle(r1,0.02);
  const r2=g.reserve('SPARK',0.02,'spark_same');g.settle(r2,0.02);
  assert.throws(()=>g.reserve('SPARK',0.02,'spark_same'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
import {readCappedJson,RequestBodyError} from '../src/modules/security/request-size.ts';
test('API request body is bounded by bytes even without content-length',async()=>{
 const req=new Request('http://localhost:3000/api/triage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'가'.repeat(100)})});
 await assert.rejects(()=>readCappedJson(req,100),(e:unknown)=>e instanceof RequestBodyError&&e.status===413);
 const valid=new Request('http://localhost:3000/api/triage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hello:1})});
 assert.deepEqual(await readCappedJson(valid,64),{hello:1});
});
