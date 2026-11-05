import test from "node:test";
import assert from "node:assert/strict";
import { assessTriage } from "../src/modules/risk-triage/index.ts";
import { validateMetaInput,validateModelOutput,MetaValidationError } from "../src/modules/analysis/meta-validation.ts";
import { buildContext, LiveMetaProvider, MockMetaProvider, MetaProviderError } from "../src/modules/analysis/meta-provider.ts";
import { LiveRequestGate } from "../src/modules/analysis/meta-gate.ts";
import { buildReplayMetaInput } from "../src/modules/analysis/replay-input.ts";
import { scenarios } from "../src/modules/evaluation/index.ts";
import { selectAssistedCoaching } from "../src/modules/coaching/assisted.ts";
import type { ModelAssessment, MetaAnalysisInput } from "../src/modules/analysis/meta-contract.ts";

const validInput:MetaAnalysisInput = {turns:[
  {turnId:"T1",speaker:"caller",text:"금융감독원입니다. 확인해 주세요."},
  {turnId:"T2",speaker:"caller",text:"지금 당장 80만 원을 송금하세요."},
]};
const validOutput:ModelAssessment = {
  riskLevel:"HIGH",riskIndex:84,manipulationIndex:64,
  detectedSignals:["MONEY_REQUEST","URGENCY"], manipulationTechniques:["URGENCY_PRESSURE"],
  requestedActions:["송금"],evidenceUtteranceIds:["T2"],normalConversationEvidence:[],
  uncertainty:"호출자의 신원은 독립 검증되지 않았습니다.",recommendedActionCodes:["DO_NOT_TRANSFER"],emergencyFlag:false,
};
const mockedFetch=(status:number,body:unknown)=>async ()=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const responseEnvelope=(content:unknown)=>({id:"test-call",choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:60,total_tokens:160}});

test("strict input: no scenario groundTruth, no future text, no duplicate turn IDs",()=>{
  const sc=scenarios[17];
  const input=buildReplayMetaInput(sc,2);
  assert.equal(input.turns.length,2);
  assert.equal(input.turns[1].text,sc.turns[1].text);
  assert.ok(!JSON.stringify(input).includes("groundTruth"));
  assert.ok(!JSON.stringify(input).includes(sc.turns.at(-1)!.text));
  assert.throws(()=>validateMetaInput({turns:[...validInput.turns,validInput.turns[0]]}),MetaValidationError);
  assert.throws(()=>validateMetaInput({...validInput,groundTruth:{scenarioLabel:"SCAM"}}),MetaValidationError);
});
test("mock provider is NOT live Meta; no network calls",async()=>{
  const ctx=buildContext(validInput);
  const res=await new MockMetaProvider().analyze(ctx);
  assert.equal(res.analysisMode,"MOCK");
  assert.notEqual(res.model,"muse-spark-1.3");
  assert.equal(res.usage.totalTokens,null);
  assert.ok(res.analysis.evidenceUtteranceIds.every(id=>validInput.turns.some(t=>t.turnId===id)));
});
test("accept valid model output and reject unsupported enum, invented evidence, unsafe action, excessive scores",()=>{
  assert.deepEqual(validateModelOutput(validOutput,validInput.turns),validOutput);
  assert.throws(()=>validateModelOutput({...validOutput,riskIndex:101},validInput.turns),MetaValidationError);
  assert.throws(()=>validateModelOutput({...validOutput,evidenceUtteranceIds:["T99"]},validInput.turns),MetaValidationError);
  assert.throws(()=>validateModelOutput({...validOutput,recommendedActionCodes:["TRANSFER_MONEY"]},validInput.turns),MetaValidationError);
  assert.throws(()=>validateModelOutput({...validOutput,unexpected:true},validInput.turns),MetaValidationError);
});
test("live provider uses official endpoint and JSON schema, with fake injected HTTP only",async()=>{
  let seenUrl=""; let auth=""; let sent:Record<string,unknown>={};
  const fake=async(url:RequestInfo|URL,init?:RequestInit)=>{
    seenUrl=String(url);auth=new Headers(init?.headers).get("Authorization")??"";
    sent=JSON.parse(init?.body as string);
    return new Response(JSON.stringify(responseEnvelope(validOutput)),{status:200});
  };
  const result=await new LiveMetaProvider({apiKey:"FAKE_TEST_KEY",fetchFn:fake as typeof fetch}).analyze(buildContext(validInput));
  assert.equal(seenUrl,"https://api.meta.ai/v1/chat/completions");
  assert.equal(auth,"Bearer FAKE_TEST_KEY");
  assert.equal(sent.model,"muse-spark-1.3");
  assert.ok(JSON.stringify(sent.response_format).includes("json_schema"));
  assert.equal(result.analysisMode,"LIVE");
  assert.equal(result.usage.totalTokens,160);
  assert.ok(!JSON.stringify(sent).includes("scenarioLabel"));
});
test("401 403 429 500 are errors; mocked API is never mislabeled LIVE",async()=>{
  for(const [status,kind] of [[401,"UNAUTHORIZED"],[403,"UNAUTHORIZED"],[429,"RATE_LIMIT"],[500,"UPSTREAM"]] as const) {
    await assert.rejects(()=>new LiveMetaProvider({apiKey:"fake",fetchFn:mockedFetch(status,{error:{message:"some secret"}}) as typeof fetch}).analyze(buildContext(validInput)),(error:unknown)=>error instanceof MetaProviderError&&error.kind===kind);
  }
});
test("bad JSON or unknown evidence is rejected despite structured-output request",async()=>{
  for(const content of [{...validOutput,evidenceUtteranceIds:["T99"]},{...validOutput,riskIndex:"99"}]){
    await assert.rejects(()=>new LiveMetaProvider({apiKey:"fake",fetchFn:mockedFetch(200,responseEnvelope(content)) as typeof fetch}).analyze(buildContext(validInput)),(error:unknown)=>error instanceof MetaProviderError&&error.kind==="INVALID_RESPONSE");
  }
});
test("in-process live quota and exact duplicate prevent repeated billed requests",()=>{
  const gate=new LiveRequestGate(2);
  gate.reserve("a");assert.throws(()=>gate.reserve("a"));gate.finish("a");
  assert.throws(()=>gate.reserve("a"));
  gate.reserve("b");gate.finish("b");
  assert.throws(()=>gate.reserve("c"));
  assert.equal(gate.stats.used,2);
});
test("critical or locally detected threat cannot be downgraded by model",()=>{
  const triage=assessTriage({turns:[{speaker:"caller",text:"당신 가족을 납치해 죽이겠습니다."}]});
  const msg=selectAssistedCoaching(triage,{...validOutput,riskLevel:"LOW",emergencyFlag:false,recommendedActionCodes:["NO_IMMEDIATE_ACTION"]});
  assert.match(msg,/112/);
});
test("valid fixed template is selected; arbitrary model prose not displayed as advice",()=>{
  const triage=assessTriage({turns:validInput.turns});
  const msg=selectAssistedCoaching(triage,validOutput);
  assert.match(msg,/송금/);
  assert.ok(!msg.includes(validOutput.uncertainty));
});
