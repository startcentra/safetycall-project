/** Deterministic MOCK workload (no Meta calls); measured numbers depend on host scheduling. */
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const target=resolve(process.argv[2]||'demo/safety-challenge/server.mjs');
const iterations=Number(process.argv[3]||60);
if(!Number.isSafeInteger(iterations)||iterations<1||iterations>500)throw new Error('iterations must be 1..500');
const {createDemoServer}=await import(pathToFileURL(target).href);
const server=createDemoServer({port:0});
const {port}=await server.listen();
const root=`http://127.0.0.1:${port}`;
const measurements=[];
let errors=0;
async function request(path,body,auth){
  const started=performance.now();
  const response=await fetch(root+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(auth?{'x-safecall-session':auth.sessionId,'x-safecall-token':auth.token}:{})},body:body?JSON.stringify(body):undefined});
  if(!response.ok){errors++;throw new Error(`status ${response.status} on ${path}`);}
  const data=await response.json();measurements.push(performance.now()-started);return data;
}
try{
  for(let i=0;i<iterations;i++){
    const state=await request('/api/session/create',{scenarioId:'benign',mode:'guidance'});
    const auth={sessionId:state.sessionCredentials.sessionId,token:state.sessionCredentials.parentToken};
    await request('/api/state',null,auth);
    await request('/api/advance',{runId:state.runId,expectedVersion:state.version},auth);
    await request('/api/session/close',{},auth);
  }
}finally{await server.close();}
measurements.sort((a,b)=>a-b);
const pct=p=>Math.round(measurements[Math.min(measurements.length-1,Math.floor((measurements.length-1)*p))]*1000)/1000;
console.log(JSON.stringify({target,iterations,requests:measurements.length,errors,p50Ms:pct(.5),p95Ms:pct(.95),p99Ms:pct(.99),avgMs:Math.round(measurements.reduce((a,b)=>a+b,0)/measurements.length*1000)/1000,node:process.version},null,2));
