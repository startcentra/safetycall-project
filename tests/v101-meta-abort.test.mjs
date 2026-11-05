import {test} from 'node:test';import assert from 'node:assert/strict';
import {LiveMetaProvider,MetaProviderError,buildContext} from '../src/modules/analysis/meta-provider.ts';
const ctx=buildContext({turns:[{turnId:'T1',speaker:'caller',text:'지금 인증번호를 알려주세요.'}]});
const hangingFetch=(_url,{signal})=>new Promise((_,reject)=>{
  if(signal.aborted){reject(new Error('aborted'));return;}
  signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
});
test('explicit stop aborts an in-flight mocked HTTP request once',async()=>{
 const controller=new AbortController();let count=0;
 const provider=new LiveMetaProvider({apiKey:'FAKE_LOCAL_TEST',signal:controller.signal,timeoutMs:1000,fetchFn:(...args)=>{count++;return hangingFetch(...args);}});
 const promise=provider.analyze(ctx);setTimeout(()=>controller.abort(),15);
 await assert.rejects(promise,e=>e instanceof MetaProviderError&&e.kind==='CANCELLED');
 assert.equal(count,1);
});
test('provider timeout aborts fake transport; never silently retries',async()=>{
 let count=0;const provider=new LiveMetaProvider({apiKey:'FAKE_LOCAL_TEST',timeoutMs:20,fetchFn:(...args)=>{count++;return hangingFetch(...args);}});
 await assert.rejects(provider.analyze(ctx),e=>e instanceof MetaProviderError&&e.kind==='TIMEOUT');
 assert.equal(count,1);
});
test('vendor 429 remains a single upstream request, not an infinite retry loop',async()=>{
 let count=0;const provider=new LiveMetaProvider({apiKey:'FAKE_LOCAL_TEST',timeoutMs:100,fetchFn:async()=>{count++;return {status:429,ok:false};}});
 await assert.rejects(provider.analyze(ctx),e=>e instanceof MetaProviderError&&e.kind==='RATE_LIMIT');
 assert.equal(count,1);
});
