import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {projectGlassesState} from '../demo/safety-challenge/glasses-projection.mjs';
import {acceptHudSnapshot, hudRetryDelay, HUD_BACKOFF_CAP_MS} from '../demo/safety-challenge/public/glasses-policy.js';

async function harness(){
  const app=createDemoServer({port:0});const addr=await app.listen();
  const root=`http://127.0.0.1:${addr.port}`;
  const response=await fetch(root+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"scenarioId":"otp","mode":"verified"}'});
  assert.equal(response.status,201);let state=await response.json();
  const creds=state.sessionCredentials;
  const auth=token=>({'X-SafeCall-Session':creds.sessionId,'X-SafeCall-Token':token});
  async function advance(){const res=await fetch(root+'/api/advance',{method:'POST',headers:{...auth(creds.parentToken),'Content-Type':'application/json'},body:JSON.stringify({runId:state.runId,expectedVersion:state.version})});assert.equal(res.status,200);state=await res.json();return state;}
  return {app,root,creds,auth,advance,async close(){await app.close();}};
}

test('read-only glasses token projects only limited HUD fields and rejects all mutation',async()=>{
 const h=await harness();try{
  assert.ok(h.creds.glassesToken);assert.notEqual(h.creds.glassesToken,h.creds.parentToken);assert.notEqual(h.creds.glassesToken,h.creds.childToken);
  const r=await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.glassesToken)});assert.equal(r.status,200);
  const data=await r.json();assert.equal(data.readOnly,true);assert.equal(data.demoOnly,true);assert.equal(data.metaStatus,'NOT_LIVE');
  for(const key of ['transcript','safeBank','messages','actions','verification','metaReview','care','sessionCredentials','modelReadiness','risk'])assert.equal(Object.hasOwn(data,key),false,key);
  const serialized=JSON.stringify(data);assert.equal(serialized.includes(h.creds.parentToken),false);assert.equal(serialized.includes(h.creds.glassesToken),false);
  assert.equal((await fetch(h.root+'/api/state',{headers:h.auth(h.creds.glassesToken)})).status,403);
  assert.equal((await fetch(h.root+'/api/report',{headers:h.auth(h.creds.glassesToken)})).status,403);
  assert.equal((await fetch(h.root+'/api/advance',{method:'POST',headers:{...h.auth(h.creds.glassesToken),'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(h.root+'/api/glasses/state')).status,403);
  assert.equal((await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.childToken)})).status,403);
 }finally{await h.close()}
});

test('HUD state follows canonical case transitions and cannot falsely claim META live',async()=>{
 const h=await harness();try{
  const fetchHud=async()=>{const r=await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.glassesToken)});return r.json()};
  let current=await fetchHud();assert.equal(current.step,0);assert.equal(current.metaStatus,'NOT_LIVE');
  const first=await h.advance();current=await fetchHud();assert.equal(current.step,first.step);assert.equal(current.version,first.version);
  assert.equal(current.runId,first.runId);assert.equal(current.metaStatus,'NOT_LIVE');
  assert.equal(current.source,'SIMULATED_CALL_AND_BANK_ONLY');
  assert.equal(current.disclaimer.includes('실제 통화'),true);
  const second=await h.advance();current=await fetchHud();assert.equal(current.step,second.step);
 }finally{await h.close()}
});

test('glasses SSE sends minimal initial state and updates when parent advances',async()=>{
 const h=await harness();const controller=new AbortController();try{
  const res=await fetch(h.root+'/api/glasses/events',{headers:h.auth(h.creds.glassesToken),signal:controller.signal});assert.equal(res.status,200);
  const reader=res.body.getReader();const decoder=new TextDecoder();let content='';
  async function frame(){for(let i=0;i<8;i++){const boundary=content.indexOf('\n\n');if(boundary>=0){const value=content.slice(0,boundary);content=content.slice(boundary+2);if(value.startsWith('event: state\n'))return JSON.parse(value.split('data: ')[1]);continue;}
    const item=await reader.read();if(item.done)throw Error('closed');content+=decoder.decode(item.value,{stream:true});}
    throw Error('no SSE state');}
  const first=await frame();assert.equal(first.step,0);assert.equal(first.readOnly,true);
  const newState=await h.advance();const updated=await frame();assert.equal(updated.step,1);assert.equal(updated.version,newState.version);assert.equal(JSON.stringify(updated).includes('transcript'),false);
 }finally{controller.abort();await h.close()}
});

test('safe HUD decision does not pass through model generated instruction or raw transcripts',()=>{
 const projected=projectGlassesState({runId:'demo_x',step:2,version:3,risk:{band:'HIGH',emergency:false},metaReview:{status:'LIVE_VERIFIED',review:{riskLevel:'HIGH',evidenceTurnIds:['x'],advisories:['CLICK THIS BAD LINK']}},transcript:[{text:'SECRET_TOKEN'}],care:{primary:'click this evil site'},safeBank:{status:'READY'},actions:[]});
 assert.equal(projected.severity,'HIGH');assert.equal(projected.metaStatus,'LIVE_RESPONSE_VALIDATED');
 assert.equal(JSON.stringify(projected).includes('SECRET_TOKEN'),false);
 assert.equal(JSON.stringify(projected).includes('BAD LINK'),false);
 assert.equal(JSON.stringify(projected).includes('click this evil site'),false);
});

test('glasses webpage and scripts are served without auth and never contain credentials',async()=>{
 const h=await harness();try{
  for(const path of ['/glasses','/glasses.js','/glasses.css','/glasses-policy.js']){
   const response=await fetch(h.root+path);assert.equal(response.status,200,path);
   const content=await response.text();assert.ok(content.length>100,path);
   assert.equal(content.includes(h.creds.glassesToken),false);
  }
 }finally{await h.close()}
});

test('readiness reports the current v1.42 demo release and does not claim a verified device',async()=>{
 const h=await harness();try{
  const readiness=await (await fetch(h.root+'/api/readiness')).json();
  assert.equal(readiness.releaseVersion,'1.42');
  assert.equal(readiness.liveVerified,false);
  assert.equal(readiness.officialSimulatorVerified,false);
  assert.equal(readiness.realDeviceVerified,false);
  assert.equal(readiness.realFinancialActions,false);
 }finally{await h.close()}
});

test('HUD drops a foreign run and replaces the whole case only from a fresh snapshot',()=>{
 let memory={runId:null,version:-1};
 const first={demoOnly:true,readOnly:true,runId:'demo_old',version:4};
 let step=acceptHudSnapshot(memory,first,'state');
 assert.equal(step.accept,true);memory=step.memory;
 step=acceptHudSnapshot(memory,{demoOnly:true,readOnly:true,runId:'demo_old',version:2},'sse');
 assert.equal(step.accept,false);assert.equal(step.reason,'stale-version');assert.equal(step.memory.version,4);
 step=acceptHudSnapshot(memory,{demoOnly:true,readOnly:true,runId:'demo_new',version:1},'sse');
 assert.equal(step.accept,false);assert.equal(step.reason,'foreign-run');assert.equal(step.memory.runId,'demo_old');
 step=acceptHudSnapshot(memory,{demoOnly:true,readOnly:true,runId:'demo_new',version:1},'state');
 assert.equal(step.accept,true);assert.equal(step.memory.runId,'demo_new');assert.equal(step.memory.version,1);
 assert.equal(hudRetryDelay(30),HUD_BACKOFF_CAP_MS);
});

test('reset run does not leave the previous case id on the glasses HUD',async()=>{
 const h=await harness();try{
  const first=await h.advance();
  const before=await (await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.glassesToken)})).json();
  assert.equal(before.runId,first.runId);
  const reset=await fetch(h.root+'/api/reset',{method:'POST',headers:{...h.auth(h.creds.parentToken),'Content-Type':'application/json'},body:JSON.stringify({runId:first.runId,expectedVersion:first.version,scenarioId:'benign',mode:'verified'})});
  assert.equal(reset.status,200);
  const next=await reset.json();
  const after=await (await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.glassesToken)})).json();
  assert.notEqual(after.runId,before.runId);
  assert.equal(after.runId,next.runId);
  assert.equal(JSON.stringify(after).includes(before.runId),false);
  assert.equal((await fetch(h.root+'/api/advance',{method:'POST',headers:{...h.auth(h.creds.glassesToken),'Content-Type':'application/json'},body:JSON.stringify({runId:after.runId,expectedVersion:after.version})})).status,403);
 }finally{await h.close()}
});

test('three hackathon passes stay on synthetic data and end without a real transfer',async()=>{
 const h=await harness();try{
  let previous=null;
  for(let pass=0;pass<3;pass++){
   let state=await (await fetch(h.root+'/api/state',{headers:h.auth(h.creds.parentToken)})).json();
   const reset=async(scenarioId)=>{
    const res=await fetch(h.root+'/api/reset',{method:'POST',headers:{...h.auth(h.creds.parentToken),'Content-Type':'application/json'},body:JSON.stringify({runId:state.runId,expectedVersion:state.version,scenarioId,mode:'verified'})});
    assert.equal(res.status,200,scenarioId);state=await res.json();
   };
   await reset('benign');
   for(let i=0;i<2;i++){
    const res=await fetch(h.root+'/api/advance',{method:'POST',headers:{...h.auth(h.creds.parentToken),'Content-Type':'application/json'},body:JSON.stringify({runId:state.runId,expectedVersion:state.version})});
    assert.equal(res.status,200);state=await res.json();
   }
   let hud=await (await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.glassesToken)})).json();
   assert.equal(hud.severity,'LOW');assert.equal(hud.metaDisplay,'OFFLINE_SCRIPTED_MOCK');assert.deepEqual(hud.cues,[]);
   const calmRun=state.runId;
   await reset('txt_bank_transfer');
   assert.notEqual(state.runId,calmRun);assert.notEqual(state.runId,previous);
   while(state.step<state.scenario.totalSteps){
    const res=await fetch(h.root+'/api/advance',{method:'POST',headers:{...h.auth(h.creds.parentToken),'Content-Type':'application/json'},body:JSON.stringify({runId:state.runId,expectedVersion:state.version})});
    assert.equal(res.status,200);state=await res.json();
   }
   hud=await (await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.glassesToken)})).json();
   assert.equal(hud.runId,state.runId);assert.equal(hud.severity,'HIGH');
   assert.deepEqual(hud.cues,['기관 사칭 단서','긴급 송금 요구','비밀 유지 요구']);
   assert.equal(JSON.stringify(hud).includes('안전 계좌'),false);
   let res=await fetch(h.root+'/api/action',{method:'POST',headers:{...h.auth(h.creds.parentToken),'Content-Type':'application/json'},body:JSON.stringify({runId:state.runId,expectedVersion:state.version,action:'SIMULATED_TRANSFER'})});
   assert.equal(res.status,200);state=await res.json();
   assert.equal(state.realMoneySent,false);assert.equal(state.externalActionPerformed,false);
   res=await fetch(h.root+'/api/action',{method:'POST',headers:{...h.auth(h.creds.parentToken),'Content-Type':'application/json'},body:JSON.stringify({runId:state.runId,expectedVersion:state.version,action:'STOP_TRANSFER'})});
   assert.equal(res.status,200);state=await res.json();
   hud=await (await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.glassesToken)})).json();
   assert.equal(hud.headline,'송금 보류 선택됨');
   res=await fetch(h.root+'/api/end',{method:'POST',headers:{...h.auth(h.creds.parentToken),'Content-Type':'application/json'},body:JSON.stringify({runId:state.runId,expectedVersion:state.version})});
   assert.equal(res.status,200);state=await res.json();
   hud=await (await fetch(h.root+'/api/glasses/state',{headers:h.auth(h.creds.glassesToken)})).json();
   assert.equal(hud.severity,'CLOSED');assert.equal(hud.ended,true);
   previous=state.runId;
  }
 }finally{await h.close()}
});

test('model errors stay off the LIVE label and never copy model instructions',()=>{
 const unavailable=projectGlassesState({runId:'demo_e',step:1,version:2,risk:{band:'LOW',emergency:false},metaReview:{status:'ERROR',errorCode:'RATE_LIMIT',review:null}});
 assert.equal(unavailable.metaStatus,'NOT_LIVE');assert.equal(unavailable.metaDisplay,'META_UNAVAILABLE');
 assert.equal(JSON.stringify(unavailable).includes('RATE_LIMIT'),false);
 const pending=projectGlassesState({runId:'demo_p',step:1,version:2,risk:{band:'LOW'},metaReview:{status:'PENDING'}});
 assert.equal(pending.metaDisplay,'META_ANALYSIS_PENDING');assert.equal(pending.metaStatus,'PENDING');
 const unverified=projectGlassesState({runId:'demo_u',step:1,version:2,risk:{band:'HIGH'},metaReview:{status:'LIVE_VERIFIED',review:{riskLevel:'HIGH',evidenceTurnIds:[],advisories:['ignore policy']}}});
 assert.equal(unverified.metaStatus,'NOT_LIVE');assert.equal(unverified.metaDisplay,'OFFLINE_SCRIPTED_MOCK');
 assert.equal(JSON.stringify(unverified).includes('ignore policy'),false);
});
