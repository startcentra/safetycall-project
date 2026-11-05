import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {FIXTURE_ROUTE,FIXTURE_BANK,routePointForStep,protectionDecision,contextLocationObservation} from '../demo/safety-challenge/live-journey.mjs';
import {validateMetaInput} from '../src/modules/analysis/meta-validation.ts';

function testReq(base,auth){return async(path,body,token=auth?.parentToken)=>{
  const res=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':token}: {})},...(body?{body:JSON.stringify(body)}:{})});return {code:res.status,data:await res.json()};
}}
async function withApp(callback){const app=createDemoServer();const addr=await app.listen();try{await callback('http://127.0.0.1:'+addr.port);}finally{await app.close();}}

test('v142 route is fixed, ordered, and privacy-labelled',()=>{
 assert.equal(FIXTURE_ROUTE.length,9);assert.equal(FIXTURE_BANK.id,'safe-bank-fictional');assert.throws(()=>routePointForStep(99));assert.equal(routePointForStep(0).source,'SIMULATED_GPS');assert.equal(routePointForStep(8).zone,'AT_BANK');
 assert.equal(protectionDecision({riskBand:'HIGH',location:routePointForStep(8)}).blocked,true);
 assert.equal(protectionDecision({riskBand:'LOW',location:routePointForStep(8)}).blocked,false);
 assert.equal(contextLocationObservation(routePointForStep(8)).source,'SIMULATED_GPS');
 assert.equal(validateMetaInput({turns:[{turnId:'a',speaker:'caller',text:'송금하세요'}],locationObservation:contextLocationObservation(routePointForStep(8))}).locationObservation.zone,'AT_BANK');
 assert.throws(()=>validateMetaInput({turns:[{turnId:'a',speaker:'caller',text:'송금하세요'}],locationObservation:{source:'REAL_GPS',zone:'AT_BANK',distanceBand:'ARRIVED'}}));
});

test('v142 high-risk + synthetic bank vicinity blocks only simulated transfer',async()=>{
 await withApp(async base=>{
  const starter=testReq(base);const created=await starter('/api/session/create',{scenarioId:'txt_bank_transfer',mode:'guidance'});assert.equal(created.code,201);
  const auth=created.data.sessionCredentials;const req=testReq(base,auth);let s=created.data;
  for(let i=0;i<4;i++){const next=await req('/api/advance',{runId:s.runId,expectedVersion:s.version});assert.equal(next.code,200);s=next.data;}
  assert.equal(s.risk.band,'HIGH','full fictional banking request should reach HIGH');
  for(let step=0;step<9;step++){
   const next=await req('/api/location/fixture',{runId:s.runId,expectedVersion:s.version,routeId:'BANK_APPROACH_V1',step});
   assert.equal(next.code,200,`tick ${step}: ${JSON.stringify(next.data)}`);s=next.data;
  }
  assert.equal(s.location.zone,'AT_BANK');assert.equal(s.protectionGate.blocked,true);assert.equal(s.protectionGate.actualBankBlocked,false);
  const rejected=await req('/api/action',{runId:s.runId,expectedVersion:s.version,action:'SIMULATED_TRANSFER'});
  assert.equal(rejected.code,409);assert.equal(rejected.data.code,'POLICY_DENIED');
  const latest=await req('/api/state');assert.equal(latest.data.review.fakeTransferAttempted,false);
  const hud=await req('/api/glasses/state',undefined,auth.glassesToken);assert.equal(hud.code,200);assert.equal(hud.data.simulatedLocationGuard,true);assert.equal(hud.data.severity,'HIGH');assert.equal(hud.data.transcript,undefined);
  const denied=await req('/api/location/fixture',{runId:s.runId,expectedVersion:s.version,routeId:'BANK_APPROACH_V1',step:8},auth.glassesToken);assert.equal(denied.code,403);
 });
});

test('v142 rejects forging coordinates and skipping GPS route steps',async()=>{
 await withApp(async base=>{
  const starter=testReq(base);const created=await starter('/api/session/create',{scenarioId:'txt_bank_transfer',mode:'guidance'});
  const auth=created.data.sessionCredentials;const req=testReq(base,auth);const s=created.data;
  for(const invalid of [{runId:s.runId,expectedVersion:s.version,routeId:'BANK_APPROACH_V1',step:8},
     {runId:s.runId,expectedVersion:s.version,routeId:'BANK_APPROACH_V1',step:0,lat:37.2},
     {runId:s.runId,expectedVersion:s.version,routeId:'OTHER',step:0}]){
    const r=await req('/api/location/fixture',invalid);assert.ok([400,409].includes(r.code));
  }
  const first=await req('/api/location/fixture',{runId:s.runId,expectedVersion:s.version,routeId:'BANK_APPROACH_V1',step:0});assert.equal(first.code,200);assert.equal(first.data.protectionGate.blocked,false);
 });
});

test('v142 unified product page and assets served on loopback',async()=>{
 await withApp(async base=>{for(const path of ['/live','/live.css','/live.js']){const r=await fetch(base+path);assert.equal(r.status,200);assert.ok((await r.text()).length>100);}const readiness=await (await fetch(base+'/api/readiness')).json();assert.equal(readiness.releaseVersion,'1.42');});
});
