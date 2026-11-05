/** Local-only browserless integration demo (not actual audio/STT or Meta LIVE). */
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
const app=createDemoServer({port:0,host:'127.0.0.1'});
let base,auth,s;
async function post(endpoint,data,session=true){const r=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(session?auth:{})},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw new Error(`request ${endpoint} failed: ${r.status}/${body.code}`);return body;}
try{
 const addr=await app.listen();base=`http://127.0.0.1:${addr.port}`;
 s=await post('/api/session/create',{scenarioId:'benign',mode:'verified'},false);
 auth={'X-SafeCall-Session':s.sessionCredentials.sessionId,'X-SafeCall-Token':s.sessionCredentials.parentToken};
 const input={source:'MOCK_ASR_FIXTURE',consented:true,operation:'FINAL',turnId:'voice_qa_1',revision:0,speaker:'caller',text:'지금 당장 돈을 송금하세요.',quality:'OK'};
 s=await post('/api/voice/fixture',{runId:s.runId,expectedVersion:s.version,event:input});
 const r=await fetch(base+'/api/voice/review',{headers:auth});if(!r.ok)throw new Error('MOCK review failed');const analysis=await r.json();
 if(analysis.analysisMode!=='MOCK'||analysis.metaCalled||analysis.actualStt!==false||analysis.analysis.riskLevel!=='HIGH'||s.safeBank.status!=='READY'||s.mockCard.status!=='ACTIVE')throw new Error('unsafe or inconsistent review');
 console.log(JSON.stringify({result:'PASS',source:'MOCK_ASR_FIXTURE',actualAudio:false,actualStt:false,metaCalled:false,riskBand:s.risk.band,riskIndex:s.risk.index,evidenceTurnIds:analysis.analysis.evidenceUtteranceIds,proposalOnly:true,card:s.mockCard.status,transfer:s.safeBank.status}));
}catch(err){console.error(JSON.stringify({result:'FAIL',reason:err.message}));process.exitCode=1;}finally{await app.close();}
