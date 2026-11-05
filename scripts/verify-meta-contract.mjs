/** Offline request/response contract evidence. Uses fake injected fetch ONLY.
 * Does not contact Meta, and the LiveMetaProvider's LIVE output from this fake
 * response must never be represented as real Meta model inference.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {LiveMetaProvider,buildContext} from '../src/modules/analysis/meta-provider.ts';
const turns=[{turnId:'T1',speaker:'caller',text:'지금 돈을 송금해 주세요.'}];
const output={riskLevel:'CAUTION',riskIndex:45,manipulationIndex:28,detectedSignals:['MONEY_REQUEST'],manipulationTechniques:[],
  requestedActions:['송금'],evidenceUtteranceIds:['T1'],normalConversationEvidence:[],
  uncertainty:'발신자의 신원과 실제 사기 여부는 확인되지 않았습니다.',recommendedActionCodes:['DO_NOT_TRANSFER'],emergencyFlag:false};
const envelope=data=>({id:'FAKE_FETCH_RESPONSE_NOT_META',choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}],usage:{prompt_tokens:12,completion_tokens:20,total_tokens:32}});
let request=null,callCount=0;
const fakeFetch=async (url,init)=>{
  callCount++;
  request={url:String(url),body:JSON.parse(init.body),auth:new Headers(init.headers).get('Authorization')};
  return new Response(JSON.stringify(envelope(output)),{status:200,headers:{'content-type':'application/json'}});
};
const fakeKey='OFFLINE_TEST_ONLY_NOT_REAL';
const provider=new LiveMetaProvider({apiKey:fakeKey,fetchFn:fakeFetch});
const answer=await provider.analyze(buildContext({turns}));
assert.equal(callCount,1);
assert.equal(request.url,'https://api.meta.ai/v1/chat/completions');
assert.equal(request.body.model,'muse-spark-1.3');
assert.equal(request.auth,`Bearer ${fakeKey}`);
assert.equal(request.body.store,false);
assert.equal(request.body.response_format?.type,'json_schema');
assert.equal(request.body.messages[1].role,'user');
const payload=JSON.parse(request.body.messages[1].content);
assert.deepEqual(payload.utterances,turns.map(x=>({turnId:x.turnId,speaker:x.speaker,text:x.text})));
assert.ok(!JSON.stringify(request.body).includes('groundTruth'));
assert.equal(answer.analysis.evidenceUtteranceIds[0],'T1');
let invalidRejected=false;
const bad=new LiveMetaProvider({apiKey:fakeKey,fetchFn:async()=>new Response(JSON.stringify(envelope({...output,evidenceUtteranceIds:['MADE_UP']})),{status:200})});
try{await bad.analyze(buildContext({turns}));}catch(e){invalidRejected=e.kind==='INVALID_RESPONSE';}
assert.equal(invalidRejected,true);
const result={generatedAt:new Date().toISOString(),proofType:'OFFLINE_INJECTED_HTTP_STUB',
  actualMetaAPICall:false,actualMetaResponse:false,metaLiveVerified:false,
  modelAdapter:'muse-spark-1.3',fakeRequests:callCount,
  assertions:{targetURL:true,requestSchema:true,storageDisabled:true,leastDataTurns:true,neverSentGroundTruth:true,
    evidenceValidation:true,inventedEvidenceRejected:invalidRejected},
  note:'LiveMetaProvider return value is from a fake HTTP transport and is NOT actual Meta inference. No external API was contacted.'};
await mkdir('artifacts/evaluations',{recursive:true});
await writeFile('artifacts/evaluations/v100_meta_stub_contract.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
