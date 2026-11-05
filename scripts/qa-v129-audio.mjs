/** Browserless v1.29 local QA: synthetic tone digest → pre-written fixture → canonical risk. */
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
const app=createDemoServer({port:0});
let base,auth,state;
async function post(path,body,withAuth=true){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(withAuth?auth:{})},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(path+': HTTP '+r.status+' '+data.code);return data;}
async function get(path){const r=await fetch(base+path,{headers:auth});if(!r.ok)throw new Error(path+' HTTP '+r.status);return r.json();}
try{
 const addr=await app.listen();base=`http://127.0.0.1:${addr.port}`;
 state=await post('/api/session/create',{scenarioId:'benign',mode:'verified'},false);
 auth={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.parentToken};
 const capabilities=await get('/api/voice/stt/capabilities');
 if(capabilities.actualStt||capabilities.metaCalled||capabilities.realAudioUpload)throw new Error('Capability boundary failed');
 state=await post('/api/voice/stt/fixture',{runId:state.runId,expectedVersion:state.version,fixtureId:'otp',consented:true});
 const review=await get('/api/voice/review');
 if(review.status!=='REVIEWED'||review.analysisMode!=='MOCK'||review.metaCalled||review.actualStt||review.analysis.riskLevel!=='HIGH'||state.mockCard.status!=='ACTIVE'||state.safeBank.status!=='READY')throw new Error('Case/tool safety invariant failed');
 console.log(JSON.stringify({result:'PASS',version:'1.29',adapter:'DIGEST_MAPPED_FIXTURE',realVoice:false,actualStt:false,metaCalled:false,externalSttCalls:0,financialCalls:0,caseRiskBand:state.risk.band,card:state.mockCard.status,transfer:state.safeBank.status,knownEvidenceIds:review.analysis.evidenceUtteranceIds.length}));
}catch(e){console.error(JSON.stringify({result:'FAIL',reason:e.message}));process.exitCode=1;}finally{await app.close();}
