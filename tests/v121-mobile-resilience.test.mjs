import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, ApiError, classifyHttp, isCaseState, delayForRetry } from '../demo/safety-challenge/public/mobile-client.js';
import { createDemoServer } from '../demo/safety-challenge/server.mjs';
let demo, base;
before(async()=>{demo=createDemoServer({port:0,allowLegacyShared:true});const addr=await demo.listen();base=`http://127.0.0.1:${addr.port}`;});
after(async()=>{await demo.close();});
const mockResponse=(status, value, contentType='application/json; charset=utf-8')=>({status,ok:status>=200&&status<300,headers:{get:()=>contentType},json:async()=>value});
const expectCode=async (promise, code)=>assert.rejects(promise,e=>e instanceof ApiError && e.code===code);
test('v121 client classifies server, auth, version conflict and rate limit errors',async()=>{
 assert.equal(classifyHttp(401),'AUTH_REQUIRED');assert.equal(classifyHttp(403),'FORBIDDEN');assert.equal(classifyHttp(409),'VERSION_CONFLICT');assert.equal(classifyHttp(429),'RATE_LIMITED');assert.equal(classifyHttp(500),'SERVER_ERROR');
 await expectCode(requestJson('/api/advance',{fetchImpl:async()=>mockResponse(409,{error:'사건 버전 충돌'})}),'VERSION_CONFLICT');
 await expectCode(requestJson('/api/advance',{fetchImpl:async()=>mockResponse(401,{error:'세션 오류'})}),'AUTH_REQUIRED');
});
test('v121 client rejects HTML, malformed JSON, invalid snapshot, and non-same-origin routes',async()=>{
 await expectCode(requestJson('/api/state',{fetchImpl:async()=>mockResponse(200,{},'text/html')}),'INVALID_RESPONSE');
 await expectCode(requestJson('/api/state',{fetchImpl:async()=>({...mockResponse(200,{}),json:async()=>{throw new SyntaxError('bad')}})}),'INVALID_RESPONSE');
 await expectCode(requestJson('/api/state',{fetchImpl:async()=>mockResponse(200,{ok:true}),validate:isCaseState}),'INVALID_RESPONSE');
 await expectCode(requestJson('https://attacker.test/api/state'),'VALIDATION_ERROR');
});
test('v121 network errors and timeouts are explicit; commands are not automatically retried',async()=>{
 let calls=0;
 await expectCode(requestJson('/api/safebank/command',{method:'POST',body:{commandId:'x'},fetchImpl:async()=>{calls++;throw Error('disconnect')}}),'NETWORK_ERROR');
 assert.equal(calls,1);
 await expectCode(requestJson('/api/state',{timeoutMs:12,fetchImpl:(_path,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('abort'),{name:'AbortError'}))))}),'TIMEOUT');
 assert.ok(delayForRetry(50)<=12000);
});
test('v121 server serves shared client with strict CSP, and legacy remains available',async()=>{
 for(const path of ['/mobile','/mobile.css','/mobile.js','/mobile-client.js','/']){
  const r=await fetch(base+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-security-policy')||'',/default-src 'self'/);assert.match(r.headers.get('content-security-policy')||'',/frame-src https:\/\/www\.openstreetmap\.org/);
 }
 const js=await (await fetch(base+'/mobile.js')).text();const html=await (await fetch(base+'/mobile')).text();
 assert.match(js,/if\(!result\.ok\)return;toast\('가상 송금 시도가 서버 사건에 기록/);
 for(const id of ['mobile-skeleton','mobile-error','error-retry','error-new','connection-retry','theme-toggle'])assert.ok(html.includes(`id="${id}"`),id);
});
