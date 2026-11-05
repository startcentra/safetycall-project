import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {createSessionRepository} from '../demo/safety-challenge/session-repository.mjs';
import {projectForRole} from '../demo/safety-challenge/role-projection.mjs';
import {dispatchCaseCommand} from '../demo/safety-challenge/command-router.mjs';

const harness=async()=>{
  const app=createDemoServer({port:0});const {port}=await app.listen();
  const root=`http://127.0.0.1:${port}`;
  const post=async(path,body={},auth)=>{
    const response=await fetch(root+path,{method:'POST',headers:{'content-type':'application/json',...auth?{'x-safecall-session':auth.sessionId,'x-safecall-token':auth.token}:{}},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  const get=async(path,auth)=>{
    const response=await fetch(root+path,{headers:auth?{'x-safecall-session':auth.sessionId,'x-safecall-token':auth.token}:{}});
    return {status:response.status,data:await response.json()};
  };
  const create=async()=>{
    const result=await post('/api/session/create',{scenarioId:'benign',mode:'verified'});
    assert.equal(result.status,201);
    const c=result.data.sessionCredentials;
    return {state:result.data,parent:{sessionId:c.sessionId,token:c.parentToken},child:{sessionId:c.sessionId,token:c.childToken}};
  };
  return {app,root,post,get,create};
};
test('explicit session repository keeps isolated context ownership',()=>{
  const repo=createSessionRepository({max:2});
  repo.set('a',{run:{id:'a'}});repo.set('b',{run:{id:'b'}});
  assert.equal(repo.get('a').run.id,'a');assert.equal(repo.get('b').run.id,'b');
  assert.throws(()=>repo.set('c',{}),/full/);
  assert.equal(repo.delete('a'),true);repo.set('c',{});assert.equal(repo.size,2);
});
test('command router rejects missing context and unauthorized role even without HTTP layer',()=>{
  const service={advance(){return 'ok'},verificationResponse(){return 'child-ok'}};
  assert.throws(()=>dispatchCaseCommand(service,'/api/advance',{},null),e=>e.status===403);
  assert.throws(()=>dispatchCaseCommand(service,'/api/advance',{}, {role:'child',sessionId:'s'}),e=>e.status===403);
  assert.throws(()=>dispatchCaseCommand(service,'/api/verification/respond',{}, {role:'parent',sessionId:'s'}),e=>e.status===403);
  assert.equal(dispatchCaseCommand(service,'/api/advance',{}, {role:'parent',sessionId:'s'}),'ok');
  assert.throws(()=>dispatchCaseCommand(service,'/api/unknown',{}, {role:'parent',sessionId:'s'}),e=>e.status===404);
});
test('child role projection removes parent transcript, financial recovery, risk and sources',()=>{
  const state={runId:'c',version:4,endedAt:null,verification:{requestId:'r',status:'REQUESTED',note:'private'},transcript:[{text:'secret'}],recovery:{bank:'private'},risk:{index:99},care:{sourceLinks:['private']},actions:['private']};
  const view=projectForRole(state,'child');
  assert.deepEqual(Object.keys(view).sort(),['demoOnly','endedAt','externalActionPerformed','metaCalled','provider','realMoneySent','runId','verification','version'].sort());
  assert.deepEqual(view.verification,{requestId:'r',status:'REQUESTED'});
  assert.equal(view.transcript,undefined);
  assert.equal(projectForRole(state,'parent'),state);
});
test('SSE rejects long-lived bearer credentials in URL even when valid',async()=>{
  const h=await harness();try{
    const a=await h.create();
    const url=`${h.root}/api/events?session=${encodeURIComponent(a.parent.sessionId)}&token=${encodeURIComponent(a.parent.token)}`;
    const response=await fetch(url);
    assert.equal(response.status,403);
  }finally{await h.app.close();}
});
test('child GET and child SSE contain only safe projection, parent receives full snapshot',async()=>{
  const h=await harness();try{
    const a=await h.create();
    const before=(await h.get('/api/state',a.child)).data;
    assert.equal(before.runId,a.state.runId);
    assert.equal(before.transcript,undefined);
    assert.equal(before.guided,undefined);
    assert.equal(before.risk,undefined);
    assert.equal((await h.get('/api/state',a.parent)).data.scenario.id,'benign');
    const controller=new AbortController();
    const response=await fetch(h.root+'/api/events',{signal:controller.signal,headers:{'x-safecall-session':a.child.sessionId,'x-safecall-token':a.child.token}});
    assert.equal(response.status,200);
    const reader=response.body.getReader();
    let first=new TextDecoder().decode((await reader.read()).value);
    assert.match(first,/event: state/);assert.doesNotMatch(first,/transcript|risk|sourceLinks|recovery/);
    const p=await h.post('/api/verification/request',{runId:a.state.runId,expectedVersion:a.state.version},a.parent);
    assert.equal(p.status,200);
    const second=new TextDecoder().decode((await reader.read()).value);
    assert.match(second,/REQUESTED/);assert.doesNotMatch(second,/transcript|risk|sourceLinks|recovery/);
    controller.abort();await reader.cancel().catch(()=>{});
  }finally{await h.app.close();}
});
test('two sessions receive isolated operations and stale version cannot overwrite state',async()=>{
  const h=await harness();try{
    const [a,b]=await Promise.all([h.create(),h.create()]);
    const [step,denied]=await Promise.all([
      h.post('/api/advance',{runId:a.state.runId,expectedVersion:a.state.version},a.parent),
      h.post('/api/advance',{runId:b.state.runId,expectedVersion:999},b.parent)
    ]);
    assert.equal(step.status,200);assert.equal(denied.status,409);
    assert.equal((await h.get('/api/state',a.parent)).data.step,1);
    assert.equal((await h.get('/api/state',b.parent)).data.step,0);
  }finally{await h.app.close();}
});

test('header-auth SSE remains live beyond ordinary request idle timeout', {timeout:10000},async()=>{
  const h=await harness();try{
    const a=await h.create();
    const controller=new AbortController();
    const r=await fetch(h.root+'/api/events',{signal:controller.signal,headers:{'x-safecall-session':a.parent.sessionId,'x-safecall-token':a.parent.token}});
    assert.equal(r.status,200);const reader=r.body.getReader();
    await reader.read();
    await new Promise(resolve=>setTimeout(resolve,5400));
    const step=await h.post('/api/advance',{runId:a.state.runId,expectedVersion:a.state.version},a.parent);
    assert.equal(step.status,200);
    const event=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('SSE stopped responding')),1800))]);
    assert.match(new TextDecoder().decode(event.value),/event: state/);
    controller.abort();await reader.cancel().catch(()=>{});
  }finally{await h.app.close();}
});
