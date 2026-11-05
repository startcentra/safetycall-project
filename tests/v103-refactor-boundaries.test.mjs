import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {readJsonObject, readBoundedBody, assertSameOrigin, requireJsonContentType} from '../demo/safety-challenge/http-utils.mjs';
import {GUIDE_PATHS as reexportPaths, guidedSteps as reexportSteps} from '../demo/safety-challenge/guided-actions.mjs';
import {GUIDE_PATHS as policyPaths, guidedSteps as policySteps} from '../demo/safety-challenge/guided-playbooks.mjs';

function request(chunks, headers={}) {
  return Object.assign(Readable.from(chunks), {headers});
}

test('refactor: public action playbook exports remain identical references', () => {
  assert.equal(reexportPaths, policyPaths);
  assert.equal(reexportSteps, policySteps);
  assert.equal(reexportSteps('PAYMENT','US',{paymentMethod:'CARD',actionStatus:'DONE'})[1].instruction,
    policySteps('PAYMENT','US',{paymentMethod:'CARD',actionStatus:'DONE'})[1].instruction);
});

test('HTTP boundary: fragmented UTF-8 JSON is decoded after complete byte assembly', async () => {
  const source=Buffer.from(JSON.stringify({message:'안전 확인',requested:'송금 보류'}));
  const chunks=[source.subarray(0,2), source.subarray(2,11), source.subarray(11)];
  assert.deepEqual(await readJsonObject(request(chunks),{maxBytes:source.length}),{message:'안전 확인',requested:'송금 보류'});
});

test('HTTP boundary: exact byte limit accepted and 1 additional byte rejected', async () => {
  assert.equal((await readBoundedBody(request([Buffer.from('abc')]),{maxBytes:3})).toString(),'abc');
  await assert.rejects(readBoundedBody(request([Buffer.from('ab'),Buffer.from('cd')]),{maxBytes:3}), e=>e.status===413);
});

test('HTTP boundary: invalid JSON and non-object payloads fail closed', async () => {
  await assert.rejects(readJsonObject(request(['{"foo":'])),e=>e.status===400 && /JSON/.test(e.message));
  await assert.rejects(readJsonObject(request(['[]'])),e=>e.status===400 && /객체/.test(e.message));
  await assert.rejects(readJsonObject(request(['null'])),e=>e.status===400 && /객체/.test(e.message));
  assert.deepEqual(await readJsonObject(request([])),{});
});

test('HTTP boundary: invalid limit does not process body', async () => {
  await assert.rejects(readBoundedBody(request(['abc']),{maxBytes:-1}),TypeError);
});

test('HTTP boundary: local origin / content-type rules remain enforced', () => {
  assert.doesNotThrow(()=>assertSameOrigin({headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173'}}));
  assert.throws(()=>assertSameOrigin({headers:{host:'127.0.0.1:4173',origin:'https://other.example'}}),e=>e.status===403);
  assert.doesNotThrow(()=>requireJsonContentType({headers:{'content-type':'application/json; charset=utf-8'}}));
  assert.throws(()=>requireJsonContentType({headers:{'content-type':'text/plain'}}),e=>e.status===415);
});

test('HTTP API: malformed create, oversized body, foreign origin are rejected before any session is created',async()=>{
  const app=createDemoServer({port:0});
  const {port}=await app.listen();
  const root=`http://127.0.0.1:${port}`;
  try {
    const requestBody=(payload,extra={})=>fetch(`${root}/api/session/create`,{
      method:'POST',headers:{'Content-Type':'application/json',...extra},body:payload});
    let response=await requestBody('{bad');
    assert.equal(response.status,400);
    response=await requestBody(JSON.stringify({scenarioId:'kidnap',mode:'verified'}).repeat(400));
    assert.equal(response.status,413);
    response=await requestBody('{}',{'Origin':'http://untrusted.example'});
    assert.equal(response.status,403);
    response=await requestBody('{}');
    assert.equal(response.status,201);
    const created=await response.json();
    assert.equal(created.metaCalled,false);
    assert.equal(created.externalActionPerformed,false);
    assert.ok(created.sessionCredentials.parentToken);
  } finally {
    await app.close();
  }
});

test('refactor: read-only snapshots retain stable versions and guided completion claims',async()=>{
  const app=createDemoServer({port:0});
  const {port}=await app.listen();
  const root=`http://127.0.0.1:${port}`;
  try {
    const created=await fetch(`${root}/api/session/create`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
    const headers={'X-SafeCall-Session':created.sessionCredentials.sessionId,'X-SafeCall-Token':created.sessionCredentials.parentToken};
    const first=await fetch(`${root}/api/state`,{headers}).then(r=>r.json());
    const second=await fetch(`${root}/api/state`,{headers}).then(r=>r.json());
    assert.deepEqual(second,first);
    assert.equal(second.guided.externalActionPerformed,false);
    assert.equal(second.guided.verifiedExternalCompletion,false);
    assert.equal(second.modelReadiness.liveVerified,false);
  } finally {
    await app.close();
  }
});
