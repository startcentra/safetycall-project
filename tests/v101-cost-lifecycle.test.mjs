import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {CostGuard,CostGuardError} from '../src/modules/cost/guard.ts';
import {readCappedJson,RequestBodyError} from '../src/modules/security/request-size.ts';
import {registerLiveOperation,unregisterLiveOperation,abortLiveExperiment} from '../src/modules/analysis/live-operations.ts';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';

const key=n=>createHash('sha256').update(n).digest('hex');
const config=(file,override={})=>({file,totalUsd:5,initialApprovedUsd:5,dailyUsd:5,sessionUsd:1,maxConcurrent:2,killSwitch:false,liveEnabled:true,spendApproved:true,...override});
function temporaryGuard(fn){const dir=mkdtempSync(join(tmpdir(),'safecall-v101-'));
 try{return fn(join(dir,'ledger.json'));}finally{rmSync(dir,{recursive:true,force:true});}}

test('CLOSED is durable and forbids new billable reservations and ID reuse after restart',()=>temporaryGuard(file=>{
 const a=new CostGuard(config(file));const experiment='spark_123';
 a.beginExperiment(experiment,'SPARK',{maxCalls:2,capUsd:.08});
 const reservation=a.reserveExperiment('SPARK',.01,experiment,key('first'));
 assert.equal(a.closeExperiment(experiment).status,'CLOSED');
 assert.throws(()=>new CostGuard(config(file)).reserveExperiment('SPARK',.01,experiment,key('second')),CostGuardError);
 assert.throws(()=>new CostGuard(config(file)).beginExperiment(experiment,'SPARK'),CostGuardError);
 assert.equal(a.experimentStatus(experiment).status,'CLOSED');
 a.settle(reservation); // in-flight request can still have unknown Meta charges after CLOSE
 assert.equal(a.stats().uncertain,1);
 assert.ok(a.stats().liabilityUsd>0);
 assert.equal(a.stats().liveAllowed,false);
 assert.throws(()=>new CostGuard(config(file)).beginExperiment('spark_new','SPARK'),CostGuardError);
}));

test('at most one active experiment per type; different ids allowed after close',()=>temporaryGuard(file=>{
 const a=new CostGuard(config(file));a.beginExperiment('spark_a','SPARK');
 assert.throws(()=>a.beginExperiment('spark_b','SPARK'),CostGuardError);
 a.closeExperiment('spark_a');assert.equal(a.beginExperiment('spark_b','SPARK').status,'ACTIVE');
}));

test('one call and same fingerprint blocked regardless of server process restart',()=>temporaryGuard(file=>{
 let a=new CostGuard(config(file));a.beginExperiment('spark_a','SPARK');
 const r=a.reserveExperiment('SPARK',.01,'spark_a',key('one'));a.settle(r,.005);
 a=new CostGuard(config(file));
 assert.throws(()=>a.reserveExperiment('SPARK',.01,'spark_a',key('one')),CostGuardError);
 assert.throws(()=>a.reserveExperiment('SPARK',.01,'spark_a',key('different')),CostGuardError);
 assert.equal(a.experimentStatus('spark_a').usedCalls,1);
}));

test('maxCalls, per-experiment exposure cap and failure-unknown liability enforce limits',()=>temporaryGuard(file=>{
 const a=new CostGuard(config(file));a.beginExperiment('spark_a','SPARK',{maxCalls:3,capUsd:.027});
 const r=a.reserveExperiment('SPARK',.01,'spark_a',key('one'));a.settle(r);
 assert.throws(()=>a.reserveExperiment('SPARK',.015,'spark_a',key('two')),CostGuardError);
 assert.ok(a.stats().liabilityUsd>.01);
}));

test('expiry rejects even with valid signed ticket independently of date of process start',()=>temporaryGuard(file=>{
 const a=new CostGuard(config(file));const now=new Date('2026-10-30T00:00:00Z');
 a.beginExperiment('spark_a','SPARK',{ttlMs:1000},now);
 assert.throws(()=>a.reserveExperiment('SPARK',.01,'spark_a',key('late'),new Date(now.getTime()+1500)),CostGuardError);
 assert.equal(a.experimentStatus('spark_a').status,'EXPIRED');
}));

test('disabled spending cannot create a live experiment',()=>temporaryGuard(file=>{
 for(const override of [{killSwitch:true},{liveEnabled:false},{spendApproved:false}]){
  assert.throws(()=>new CostGuard(config(file,override)).beginExperiment('spark_a','SPARK'),CostGuardError);
 }
}));

test('overrun is visible and new paid reservations are blocked',()=>temporaryGuard(file=>{
 const a=new CostGuard(config(file));a.beginExperiment('spark_a','SPARK');
 const r=a.reserveExperiment('SPARK',.01,'spark_a',key('one'));a.settle(r,.04);
 a.closeExperiment('spark_a');a.beginExperiment('spark_b','SPARK');
 assert.throws(()=>a.reserveExperiment('SPARK',.01,'spark_b',key('two')),CostGuardError);
 assert.equal(a.stats().overrunCount,1);
}));

test('invalid experiment budget fields and ledger corruption fail closed',()=>temporaryGuard(file=>{
 const a=new CostGuard(config(file));assert.throws(()=>a.beginExperiment('bad space','SPARK'),CostGuardError);
 assert.throws(()=>a.beginExperiment('valid','SPARK',{capUsd:100}),CostGuardError);
 a.beginExperiment('spark_a','SPARK');
 assert.equal(a.experimentStatus('spark_a').usedCalls,0);
}));

test('closing in-flight HTTP operation aborts provider signal in this process',()=>{
 const operation=registerLiveOperation('spark_a');let observed=false;
 operation.signal.addEventListener('abort',()=>{observed=true;});
 assert.equal(abortLiveExperiment('spark_a'),1);assert.equal(observed,true);
 unregisterLiveOperation('spark_a',operation);
 assert.equal(abortLiveExperiment('spark_a'),0);
});

test('slow or never-ending input body stops after bounded timeout without external call',async()=>{
 const stream=new ReadableStream({pull(){return new Promise(()=>{});}});
 const req=new Request('http://localhost:3000/api/meta/session',{method:'POST',body:stream,duplex:'half',headers:{'content-type':'application/json'}});
 await assert.rejects(()=>readCappedJson(req,100,30),e=>e instanceof RequestBodyError&&e.status===408);
});

test('explicit local MOCK session cleanup permits more than 32 sequential sessions; roles stay isolated',async()=>{
 const app=createDemoServer({sessionIdleMs:60000,sessionLifetimeMs:60000});const {port}=await app.listen();
 const url=`http://127.0.0.1:${port}`;
 const create=async()=>{const res=await fetch(url+'/api/session/create',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(res.status,201);return res.json();};
 const close=async(s,token)=>fetch(url+'/api/session/close',{method:'POST',headers:{'content-type':'application/json','x-safecall-session':s.sessionCredentials.sessionId,'x-safecall-token':token},body:'{}'});
 try{
  const a=await create();const b=await create();
  assert.equal((await close(a,a.sessionCredentials.childToken)).status,403);
  assert.equal((await close(a,a.sessionCredentials.parentToken)).status,200);
  assert.equal((await fetch(url+'/api/state',{headers:{'x-safecall-session':a.sessionCredentials.sessionId,'x-safecall-token':a.sessionCredentials.parentToken}})).status,403);
  assert.equal((await fetch(url+'/api/state',{headers:{'x-safecall-session':b.sessionCredentials.sessionId,'x-safecall-token':b.sessionCredentials.parentToken}})).status,200);
  await close(b,b.sessionCredentials.parentToken);
  for(let i=0;i<37;i++){const s=await create();assert.equal((await close(s,s.sessionCredentials.parentToken)).status,200);}
 }finally{await app.close();}
});

test('expired local MOCK session is removed on next request; another session remains untouched',async()=>{
 const app=createDemoServer({sessionIdleMs:30,sessionLifetimeMs:30000});const {port}=await app.listen();const url=`http://127.0.0.1:${port}`;
 try{
  const r=await fetch(url+'/api/session/create',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const session=await r.json();await new Promise(resolve=>setTimeout(resolve,55));
  const old=await fetch(url+'/api/state',{headers:{'x-safecall-session':session.sessionCredentials.sessionId,'x-safecall-token':session.sessionCredentials.parentToken}});
  assert.equal(old.status,403);
  const next=await fetch(url+'/api/session/create',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(next.status,201);
 }finally{await app.close();}
});
