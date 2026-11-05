/** Integration flow demonstration with an injected fake Meta adapter.
 * NO Meta API key, internet access, or real model inference. */
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {SCENARIOS} from '../demo/safety-challenge/scenarios.mjs';
import {writeFile} from 'node:fs/promises';
const mockProvider={analyze:async({input})=>{
 const last=input.turns.at(-1);const hasRequest=/인증번호|개인정보를 입력|계좌로 송금|송금해/i.test(last?.text||'');
 return {analysisMode:'LIVE',model:'UNIT_TEST_FAKE_ONLY',elapsedMs:8,usage:{inputTokens:0,outputTokens:0,totalTokens:0},
 analysis:{riskLevel:hasRequest?'CAUTION':'LOW',riskIndex:hasRequest?20:0,manipulationIndex:0,detectedSignals:[],manipulationTechniques:[],
 requestedActions:[],evidenceUtteranceIds:hasRequest?[last.turnId]:[],normalConversationEvidence:[],uncertainty:'FAKE_PROVIDER_NOT_REAL_META',
 recommendedActionCodes:hasRequest?['VERIFY_OFFICIAL_CHANNEL']:['NO_IMMEDIATE_ACTION'],emergencyFlag:false}};
}};
const rows=[];
for(const scenarioId of ['otp','txt_wedding_qr','benign']){
 const app=createDemoServer({port:0,metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:'FAKE_TEST_ONLY',maxCallsPerRun:4},metaProvider:mockProvider});
 const {port}=await app.listen();const base=`http://127.0.0.1:${port}`;
 try{
  const created=await (await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,mode:'verified'})})).json();
  const headers={'Content-Type':'application/json','X-SafeCall-Session':created.sessionCredentials.sessionId,'X-SafeCall-Token':created.sessionCredentials.parentToken};
  let s=created;
  const command=async(path,extra={})=>{const resp=await fetch(base+'/api/'+path,{method:'POST',headers,body:JSON.stringify({runId:s.runId,expectedVersion:s.version,...extra})});if(!resp.ok)throw new Error(`${path} status=${resp.status}`);s=await resp.json();return s;};
  await command('meta/consent',{consented:true});
  for(let i=0;i<SCENARIOS[scenarioId].turns.length;i++){
   await command('advance');
   await new Promise(resolve=>setTimeout(resolve,15));
   s=await (await fetch(base+'/api/state',{headers})).json();
   rows.push({scenarioId,caseId:s.runId,step:s.step,riskBand:s.risk.band,riskIndex:s.risk.index,
    metaStatus:s.metaReview.status,metaAdvisory:s.metaReview.review?.advisories??[],
    metaEvidenceIds:s.metaReview.review?.evidenceTurnIds??[],
    mockCard:s.mockCard.status,safeBank:s.safeBank.status,externalActionPerformed:s.externalActionPerformed});
  }
 }finally{await app.close()}
}
const output={mode:'FAKE_META_INJECTION_ONLY',actualMetaCalls:0,actualModelInferences:0,actualFinancialActions:0,rows};
const dest=process.argv[2];if(dest)await writeFile(dest,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({mode:output.mode,scenarios:3,steps:rows.length,allBankReady:rows.every(x=>x.safeBank==='READY'),allCardActive:rows.every(x=>x.mockCard==='ACTIVE'),allNoFinancialExecution:rows.every(x=>!x.externalActionPerformed),final:rows.filter(x=>x.step===SCENARIOS[x.scenarioId].turns.length).map(x=>({scenario:x.scenarioId,localRisk:x.riskBand,metaStatus:x.metaStatus,metaEvidenceIds:x.metaEvidenceIds}))},null,2));
