/** SafeCall v1.27 developer QA tool. Local ephemeral MOCK server only. No backdoor. */
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
const allowed=['list','card','otp','emergency','all'];
const command=process.argv[2]||'all';
if(!allowed.includes(command)){console.error('Usage: npm run qa:v127 -- [list|card|otp|emergency|all]');process.exit(2);}
const app=createDemoServer({host:'127.0.0.1',port:0});let base,auth,state;
async function post(path,body,authorized=true){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?auth:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
const at=()=>({runId:state.runId,expectedVersion:state.version});
async function create(scenarioId){const r=await post('/api/session/create',{scenarioId,mode:'verified'},false);if(r.status!==201)throw new Error('QA fixture setup failed');state=r.data;auth={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.parentToken};}
async function apply(path,body){const r=await post(path,{...at(),...body});if(r.status!==200)throw new Error(`QA: ${path} returned ${r.status} (${r.data.code})`);state=r.data;return state;}
function ensure(ok,message){if(!ok)throw new Error('Invariant failed: '+message);}
async function scenario(name){
 await create(name==='emergency'?'kidnap':name==='otp'?'otp':'benign');
 if(name==='card'){
  const id='qa_lock_1';const request={action:'LOCK',cardRef:'DEMO_CARD_1',confirmed:true,commandId:id,expectedCardRevision:state.mockCard.revision};
  await apply('/api/mock-card/command',request);
  ensure(state.mockCard.status==='LOCKED','mock card not locked');
  ensure(state.safeBank.status==='READY','card lock changed transfer state');
  const repeat=await post('/api/mock-card/command',{...at(),...request});ensure(repeat.status===200,'idempotent replay rejected');
  ensure(repeat.data.mockCard.activity.length===1,'duplicate card command');
 }else {
  const total=name==='emergency'?3:4;
  for(let i=0;i<total;i++)await apply('/api/advance',{});
  ensure(state.risk.band!=='LOW','risk evidence not detected');
  if(name==='emergency'){
   const rejected=await post('/api/safebank/command',{...at(),type:'ASSIST_CONSENT',confirmed:true,commandId:'qa_denied',expectedBankRevision:state.safeBank.revision});
   ensure(rejected.status===409,'emergency assistance policy not enforced');
  }else{
   await apply('/api/safebank/command',{type:'ARRIVAL_CONFIRM',confirmed:true,commandId:'qa_arr',expectedBankRevision:state.safeBank.revision});
   await apply('/api/safebank/command',{type:'ASSIST_CONSENT',confirmed:true,commandId:'qa_con',expectedBankRevision:state.safeBank.revision});
   await apply('/api/safebank/command',{type:'HOLD',confirmed:true,commandId:'qa_hold',expectedBankRevision:state.safeBank.revision});
   ensure(state.safeBank.status==='HELD','policy approved hold was not applied');
   ensure(state.mockCard.status==='ACTIVE','transfer hold changed card state');
  }
 }
 ensure(state.metaCalled===false&&state.realMoneySent===false&&state.externalActionPerformed===false,'MOCK isolation');
 console.log(JSON.stringify({scenario:name,result:'PASS',provider:'SCRIPTED_MOCK',realFinancialAction:false,caseVersion:state.version}));
}
try{
 const addr=await app.listen();base=`http://127.0.0.1:${addr.port}`;
 if(command==='list'){const r=await fetch(base+'/api/scenarios');console.log(JSON.stringify({result:'PASS',ids:(await r.json()).scenarios.map(s=>s.id)}));}
 else for(const name of command==='all'?['card','otp','emergency']:[command])await scenario(name);
}catch(e){console.error(JSON.stringify({result:'FAIL',reason:e.message}));process.exitCode=1;}finally{await app.close();}
