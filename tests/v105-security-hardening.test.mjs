import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';

async function harness(){
  const app=createDemoServer({port:0});const {port}=await app.listen();
  const url=`http://127.0.0.1:${port}`;
  async function post(path,body={},auth){
    const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{'X-SafeCall-Session':auth.sessionId,'X-SafeCall-Token':auth.token}:{})},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }
  async function create(){
    const r=await post('/api/session/create',{scenarioId:'benign',mode:'verified'});
    assert.equal(r.status,201);const c=r.data.sessionCredentials;
    return {state:r.data,parent:{sessionId:c.sessionId,token:c.parentToken}};
  }
  return {app,url,post,create};
}
const at=s=>({runId:s.runId,expectedVersion:s.version});

test('invalid Host headers and invalid request targets return 400 without taking down server',async()=>{
  const h=await harness();try{
    async function raw(target,host){
      return await new Promise((resolve,reject)=>{
        const request=http.request(h.url,{method:'GET',path:target,headers:{Host:host},agent:false},response=>{
          response.resume();response.on('end',()=>resolve(response.statusCode));
        });request.once('error',reject);request.end();
      });
    }
    for(const bad of ['[invalid','attacker.example','127.0.0.1:bad'])assert.equal(await raw('/api/readiness',bad),400);
    assert.equal(await raw('/api/readiness','127.0.0.1'),200);
    assert.equal((await fetch(h.url+'/api/readiness')).status,200);
  }finally{await h.app.close();}
});
test('reset requires current runId and version in isolated session',async()=>{
  const h=await harness();try{
    const a=await h.create();
    const stepped=await h.post('/api/advance',at(a.state),a.parent);assert.equal(stepped.status,200);
    for(const attempt of [
      {scenarioId:'benign',mode:'verified'},
      {...at(a.state),scenarioId:'benign',mode:'verified'},
      {runId:'old',expectedVersion:-1,scenarioId:'benign',mode:'verified'}
    ])assert.equal((await h.post('/api/reset',attempt,a.parent)).status,409);
    const valid=await h.post('/api/reset',{...at(stepped.data),scenarioId:'otp',mode:'verified'},a.parent);
    assert.equal(valid.status,200);assert.equal(valid.data.scenario.id,'otp');
  }finally{await h.app.close();}
});
test('duplicate STOP_TRANSFER on same transcript turn does not grow actions or version',async()=>{
  const h=await harness();try{
    const a=await h.create();let s=a.state;
    for(let i=0;i<120;i++){
      const result=await h.post('/api/action',{...at(s),action:'STOP_TRANSFER'},a.parent);
      assert.equal(result.status,200);s=result.data;
    }
    assert.equal(s.actions.length,1);assert.equal(s.version,a.state.version+1);
    assert.equal(s.review.stoppedTransfer,true);
  }finally{await h.app.close();}
});
test('session creation rate and active capacity are bounded with explicit rejection',async()=>{
  const h=await harness();try{
    // Creating and immediately deleting sessions tests the rate limit independently of the 32 active-session cap.
    for(let i=0;i<48;i++){
      const a=await h.create();
      assert.equal((await h.post('/api/session/close',{},a.parent)).status,200);
    }
    const denied=await h.post('/api/session/create',{});assert.equal(denied.status,429);
    assert.match(denied.data.error,/요청/);
  }finally{await h.app.close();}
});
test('SSE connections per case have an upper bound',async()=>{
  const h=await harness();const controllers=[];const readers=[];
  try{
    const a=await h.create();
    for(let i=0;i<4;i++){
      const controller=new AbortController();controllers.push(controller);
      const response=await fetch(h.url+'/api/events',{headers:{'X-SafeCall-Session':a.parent.sessionId,'X-SafeCall-Token':a.parent.token},signal:controller.signal});
      assert.equal(response.status,200);
      const reader=response.body.getReader();readers.push(reader);await reader.read();
    }
    const r=await fetch(h.url+'/api/events',{headers:{'X-SafeCall-Session':a.parent.sessionId,'X-SafeCall-Token':a.parent.token}});
    assert.equal(r.status,429);await r.arrayBuffer();
  }finally{for(const c of controllers)c.abort();for(const r of readers)await r.cancel().catch(()=>{});await h.app.close();}
});
test('Next.js event handler uses capped streaming reader instead of trusting content-length',async()=>{
  const source=await readFile(new URL('../src/app/api/simulations/[id]/events/route.ts',import.meta.url),'utf8');
  assert.match(source,/readCappedJson\(request,2048\)/);
  assert.doesNotMatch(source,/await request\.json\(\)/);
});
