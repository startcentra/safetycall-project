import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {LiveMetaProvider,MetaProviderError} from '../src/modules/analysis/meta-provider.ts';

const baseConfig={enabled:true,approved:true,killSwitch:false,apiKey:'test-secret-never-exposed',maxCallsPerRun:3,maxCallsPerProcess:10,timeoutMs:3000};
const nextTick=()=>new Promise(r=>setTimeout(r,15));
const result=(ctx,code='DO_NOT_SHARE_OTP')=>({analysisMode:'LIVE',model:'muse-spark-1.3',elapsedMs:7,usage:{inputTokens:43,outputTokens:38,totalTokens:81},analysis:{
  riskLevel:'CAUTION',riskIndex:23,manipulationIndex:10,detectedSignals:[],manipulationTechniques:[],requestedActions:[],
  evidenceUtteranceIds:ctx.input.turns.slice(-1).map(t=>t.turnId),normalConversationEvidence:[],uncertainty:'synthetic unverified caller',
  recommendedActionCodes:[code],emergencyFlag:false}});
async function harness({metaConfig=baseConfig,provider={analyze:async c=>result(c)},scenarioId='otp'}={}){
 const app=createDemoServer({port:0,metaConfig,metaProvider:provider});const {port}=await app.listen();
 const url=`http://127.0.0.1:${port}`;
 const raw=await fetch(url+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,mode:'verified'})});
 assert.equal(raw.status,201);let state=await raw.json();
 const parent={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.parentToken};
 const child={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.childToken};
 const read=async(auth=parent)=>{const r=await fetch(url+'/api/state',{headers:auth});return {status:r.status,data:await r.json()}};
 const cmd=async(p,extra={},auth=parent)=>{const r=await fetch(url+p,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({runId:state.runId,expectedVersion:state.version,...extra})});const body=await r.json();if(r.status===200&&auth===parent)state=body;return {status:r.status,body}};
 return {url,read,cmd,parent,child,get state(){return state},async close(){await app.close()}};
}

test('OFF by default: neither API consent nor scripted advance invokes Meta',async()=>{
 let calls=0;const h=await harness({metaConfig:{},provider:{analyze:async()=>{calls++;throw Error('not allowed')}}});try{
  assert.equal(h.state.metaReview.status,'DISABLED');
  assert.equal((await h.cmd('/api/meta/consent',{consented:true})).status,503);
  assert.equal((await h.cmd('/api/advance')).status,200);await nextTick();
  assert.equal(calls,0);assert.equal((await h.read()).data.metaCalled,false);
 }finally{await h.close()}
});

test('all three server flags required, without configured key or provider LIVE is blocked',async()=>{
 for(const cfg of [{...baseConfig,enabled:false},{...baseConfig,approved:false},{...baseConfig,killSwitch:true}]){
  const h=await harness({metaConfig:cfg});try{assert.equal(h.state.modelReadiness.enabled,false);assert.equal((await h.cmd('/api/meta/consent',{consented:true})).status,503);}finally{await h.close()}
 }
 const h=await harness({metaConfig:{...baseConfig,apiKey:''},provider:null});try{assert.equal(h.state.modelReadiness.enabled,false);}finally{await h.close()}
});

test('no consent: no outgoing model requests and child cannot authorize',async()=>{
 const seen=[];const h=await harness({provider:{analyze:async c=>{seen.push(c);return result(c)}}});try{
  assert.equal((await h.cmd('/api/advance')).status,200);await nextTick();assert.equal(seen.length,0);
  assert.equal((await h.cmd('/api/meta/consent',{consented:true},h.child)).status,403);
  assert.equal((await h.cmd('/api/meta/consent',{consented:false})).status,400);
  assert.equal((await h.cmd('/api/meta/consent',{consented:true,model:'evil'})).status,400);
  assert.equal((await h.cmd('/api/meta/consent',{consented:true})).status,200);
  await nextTick();assert.equal(seen.length,1);
  assert.equal((await h.cmd('/api/meta/consent',{consented:true})).status,409);
  assert.equal((await h.read(h.child)).data.metaReview,undefined);
 }finally{await h.close()}
});

test('explicit consent + each finalized synthetic turn => validated live advice with no score/bank mutation',async()=>{
 const seen=[];const h=await harness({provider:{analyze:async c=>{seen.push(c);return result(c)}}});try{
  assert.equal((await h.cmd('/api/meta/consent',{consented:true})).status,200);
  const before=h.state;assert.equal(before.risk.index,0);
  assert.equal((await h.cmd('/api/advance')).status,200);await nextTick();
  const after=(await h.read()).data;
  assert.equal(after.metaReview.status,'LIVE_VERIFIED');assert.equal(after.metaCalled,true);
  assert.deepEqual(after.metaReview.review.evidenceTurnIds,['turn_1']);
  assert.equal(after.safeBank.status,'READY');assert.equal(after.mockCard.status,'ACTIVE');
  assert.equal(after.externalActionPerformed,false);
  assert.equal(after.risk.index,h.state.risk.index);assert.equal(seen[0].input.turns.length,1);
  assert.equal(JSON.stringify(after).includes('test-secret-never-exposed'),false);
  assert.equal((await h.cmd('/api/advance')).status,200);await nextTick();
  assert.equal(seen[1].input.turns.length,2);
  assert.equal(seen[1].input.turns[1].turnId,'turn_2');
  assert.ok((await h.read()).data.metaReview.review.evidenceTurnIds.every(id=>['turn_1','turn_2'].includes(id)));
 }finally{await h.close()}
});

test('replayed payment/tool action is never executed by model output',async()=>{
 const h=await harness({provider:{analyze:async c=>result(c,'CONTACT_BANK_AND_112')}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  const s=(await h.read()).data;
  assert.equal(s.safeBank.status,'READY');assert.equal(s.mockCard.status,'ACTIVE');assert.equal(s.toolProposals.length,0);
  assert.equal(s.metaReview.review.actionCodes[0],'CONTACT_BANK_AND_112');
  assert.equal(s.metaReview.review.advisories.length,1);
 }finally{await h.close()}
});

test('late model output cannot override subsequent input; old response is discarded',async()=>{
 let firstResolve;let firstContext;let n=0;
 const h=await harness({provider:{analyze:async c=>{n++;if(n===1){firstContext=c;return new Promise(r=>firstResolve=r)}return result(c)}}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  assert.equal((await h.read()).data.metaReview.status,'PENDING');
  await h.cmd('/api/advance');await nextTick();
  assert.equal(n,1);assert.equal((await h.read()).data.metaReview.status,'WAITING_LATEST');
  firstResolve(result(firstContext));await nextTick();
  const s=(await h.read()).data;
  assert.equal(s.metaReview.status,'LIVE_VERIFIED');assert.deepEqual(s.metaReview.review.evidenceTurnIds,['turn_2']);
  assert.equal(s.metaReview.callCount,2);
 }finally{await h.close()}
});

test('run reset cancels in-flight model analysis and consent does not carry over',async()=>{
 let resolve;let input;
 const h=await harness({provider:{analyze:async c=>{input=c;return new Promise(r=>resolve=r)}}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  const previous=h.state.runId;
  await h.cmd('/api/reset',{scenarioId:'benign',mode:'verified'});assert.notEqual(h.state.runId,previous);
  resolve(result(input));await nextTick();
  const state=(await h.read()).data;assert.equal(state.metaCalled,false);assert.equal(state.metaReview.status,'AWAITING_CONSENT');
 }finally{await h.close()}
});

test('per-case budget prevents excess calls and later turns retain local rule results',async()=>{
 let n=0;const h=await harness({metaConfig:{...baseConfig,maxCallsPerRun:1},provider:{analyze:async c=>{n++;return result(c)}}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  await h.cmd('/api/advance');await nextTick();
  assert.equal(n,1);assert.equal((await h.read()).data.metaReview.callCount,1);
  assert.equal((await h.read()).data.metaReview.status,'BUDGET_EXHAUSTED');
 }finally{await h.close()}
});

test('provider errors do not block local rule results, no false LIVE verified label',async()=>{
 const h=await harness({provider:{analyze:async()=>{throw new MetaProviderError('RATE_LIMIT','secret upstream error')}}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  const s=(await h.read()).data;assert.equal(s.metaReview.status,'ERROR');assert.equal(s.metaReview.errorCode,'RATE_LIMIT');
  assert.equal(s.metaReview.review,null);assert.equal(s.risk.band,'LOW');
 }finally{await h.close()}
});

test('invalid model evidence is rejected and never creates canonical evidence',async()=>{
 const h=await harness({provider:{analyze:async c=>({...result(c),analysis:{...result(c).analysis,evidenceUtteranceIds:['turn_999']}})}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  const s=(await h.read()).data;assert.equal(s.metaReview.status,'ERROR');assert.equal(s.metaReview.errorCode,'INVALID_RESPONSE');
  assert.equal(s.canonicalEvents.length,1);
 }finally{await h.close()}
});

test('real adapter prepares official Meta endpoint request with server bearer and strict JSON, without actual network',async()=>{
 let seen;
 const valid={riskLevel:'CAUTION',riskIndex:28,manipulationIndex:0,detectedSignals:[],manipulationTechniques:[],
  requestedActions:[],evidenceUtteranceIds:['turn_1'],normalConversationEvidence:[],uncertainty:'Unverified synthetic sample',
  recommendedActionCodes:['VERIFY_OFFICIAL_CHANNEL'],emergencyFlag:false};
 const fetchFn=async(url,options)=>{seen={url,options};return {ok:true,status:200,json:async()=>({id:'call_fake',choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}],usage:{prompt_tokens:100,completion_tokens:60,total_tokens:160}})}};
 const provider=new LiveMetaProvider({apiKey:'test-only-key',fetchFn,timeoutMs:1000});
 const input={turns:[{turnId:'turn_1',speaker:'caller',text:'가상 테스트 통화입니다.'}]};
 const out=await provider.analyze({input,triage:null});
 assert.equal(seen.url,'https://api.meta.ai/v1/chat/completions');
 assert.equal(seen.options.headers.Authorization,'Bearer test-only-key');
 const body=JSON.parse(seen.options.body);assert.equal(body.model,'muse-spark-1.3');assert.equal(body.response_format.json_schema.strict,true);
 assert.equal(body.messages[1].content.includes('가상 테스트 통화입니다.'),true);
 assert.equal(out.analysisMode,'LIVE');assert.equal(out.usage.totalTokens,160);
});

test('calling END_CALL cancels in-flight review; late paid response is ignored',async()=>{
 let resolve;let ctx;
 const h=await harness({provider:{analyze:async c=>{ctx=c;return new Promise(r=>resolve=r)}}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  assert.equal((await h.read()).data.metaReview.status,'PENDING');
  await h.cmd('/api/action',{action:'END_CALL'});
  assert.equal((await h.read()).data.metaReview.status,'CANCELLED_ON_END');
  resolve(result(ctx));await nextTick();
  const s=(await h.read()).data;assert.equal(s.metaReview.review,null);assert.equal(s.postCall.status,'ACTIVE');
 }finally{await h.close()}
});

test('model response with valid evidence but unsupported action cannot be displayed',async()=>{
 const h=await harness({provider:{analyze:async c=>result(c,'LOCK_REAL_BANK_CARD')}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  const s=(await h.read()).data;assert.equal(s.metaReview.status,'ERROR');assert.equal(s.metaReview.errorCode,'INVALID_RESPONSE');
  assert.equal(s.mockCard.status,'ACTIVE');assert.equal(s.safeBank.status,'READY');
 }finally{await h.close()}
});

test('SSE event publishes Meta PENDING and LIVE_VERIFIED for same case without changing canonical version',async()=>{
 let resolveReview;let saved;
 const h=await harness({provider:{analyze:async c=>{saved=c;return new Promise(r=>resolveReview=r)}}});
 const controller=new AbortController();try{
  const r=await fetch(h.url+'/api/events',{headers:h.parent,signal:controller.signal});assert.equal(r.status,200);
  const reader=r.body.getReader();const decoder=new TextDecoder();let buffer='';
  const readEvent=async()=>{while(!buffer.includes('\n\n')){const {value,done}=await reader.read();if(done)throw Error('SSE closed');buffer+=decoder.decode(value,{stream:true})}const idx=buffer.indexOf('\n\n'),event=buffer.slice(0,idx);buffer=buffer.slice(idx+2);const json=event.match(/data: (.+)/);return json?JSON.parse(json[1]):null};
  const initial=await readEvent();assert.equal(initial.metaReview.status,'AWAITING_CONSENT');
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  let pending=null;for(let i=0;i<6;i++){const x=await readEvent();if(x?.metaReview?.status==='PENDING'){pending=x;break}}
  assert.ok(pending);const version=pending.version;
  resolveReview(result(saved));await nextTick();
  let live=null;for(let i=0;i<6;i++){const x=await readEvent();if(x?.metaReview?.status==='LIVE_VERIFIED'){live=x;break}}
  assert.ok(live);assert.equal(live.version,version);assert.equal(live.runId,pending.runId);
  assert.equal(live.metaReview.review.usage.totalTokens,81);
 }finally{controller.abort();await h.close()}
});

test('independent canonical user-action version change invalidates a pending model response',async()=>{
 let resolve;let input;
 const h=await harness({provider:{analyze:async c=>{input=c;return new Promise(r=>resolve=r)}}});try{
  await h.cmd('/api/meta/consent',{consented:true});await h.cmd('/api/advance');await nextTick();
  await h.cmd('/api/action',{action:'SIMULATED_TRANSFER'});
  resolve(result(input));await nextTick();
  const s=(await h.read()).data;assert.equal(s.metaReview.status,'STALE_DISCARDED');assert.equal(s.metaReview.review,null);
  assert.equal(s.safeBank.status,'READY');assert.equal(s.externalActionPerformed,false);
 }finally{await h.close()}
});
