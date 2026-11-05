import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCase,applyCaseEvent} from '../src/modules/case/index.ts';
import {applyMockCardCommand,createMockCardState} from '../src/modules/mock-banking/mock-card-ledger.ts';
import {evaluateToolProposal} from '../src/modules/analysis/tool-proposals.ts';
import {applyFixtureUtterance} from '../src/modules/audio/evidence-fixture.ts';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
const cmd=(state,action='LOCK',id='card_1',extras={})=>({caseId:state.caseId,cardRef:'DEMO_CARD_1',action,id,expectedRevision:state.revision,userConfirmed:true,caseOpen:true,...extras});
test('v127 card ledger: lock/unlock independent, idempotent, stale/changed replay fail closed',()=>{
 let c=createMockCardState('case_card_1');const accepted=applyMockCardCommand(c,cmd(c));assert.equal(accepted.reason,'APPLIED');c=accepted.state;
 assert.equal(c.status,'LOCKED');assert.equal(c.revision,1);
 assert.equal(applyMockCardCommand(c,cmd(createMockCardState(c.caseId))).reason,'DUPLICATE');
 assert.equal(applyMockCardCommand(c,cmd(c,'UNLOCK','card_1')).reason,'CONFLICT');
 assert.equal(applyMockCardCommand(c,cmd(c,'UNLOCK','card_2',{expectedRevision:0})).reason,'STALE');
 assert.equal(applyMockCardCommand(c,cmd(c,'UNLOCK','card_2',{userConfirmed:false})).reason,'CONSENT_REQUIRED');
 assert.equal(applyMockCardCommand(c,cmd(c,'UNLOCK','card_2',{caseOpen:false})).reason,'CASE_ENDED');
 const unlock=applyMockCardCommand(c,cmd(c,'UNLOCK','card_2'));assert.equal(unlock.state.status,'ACTIVE');
 assert.equal(unlock.state.activity.length,2);
});
test('v127 tool: no arbitary URLs, cross-case, absent evidence, location prompt or emergency bypass',()=>{
 let c=createCase('case_tool_1');
 const proposal={kind:'OFFER_MOCK_CARD_LOCK',caseId:c.caseId,stateVersion:1,cardRef:'DEMO_CARD_1',evidenceIds:['turn_1']};
 assert.equal(evaluateToolProposal(proposal,c,1).reason,'EVIDENCE_INVALID');
 c=applyCaseEvent(c,{type:'UTTERANCE_FINAL',caseId:c.caseId,eventId:'ev_1',turnId:'turn_1',revision:0,absoluteIndex:0,speaker:'caller',text:'지금 당장 인증번호를 알려주세요. 다른 사람에게 말하지 마세요.'});
 const check={...proposal,stateVersion:1};
 assert.equal(evaluateToolProposal(check,c,1).reason,'CONTEXT_MISMATCH');
 assert.equal(evaluateToolProposal(check,c,1,{cardExposureReported:true}).accepted,true);
 assert.equal(evaluateToolProposal({...check,url:'https://untrusted.example'},c,1,{cardExposureReported:true}).reason,'INVALID_SCHEMA');
 assert.equal(evaluateToolProposal({...check,caseId:'case_other'},c,1).reason,'CASE_CHANGED');
 assert.equal(evaluateToolProposal({...check,evidenceIds:['fabricated']},c,1).reason,'EVIDENCE_INVALID');
 assert.equal(evaluateToolProposal({...check,kind:'execute_mock_card_lock'},c,1).reason,'INVALID_SCHEMA');
 const location={kind:'PROMPT_LOCATION_PERMISSION',caseId:c.caseId,stateVersion:1,evidenceIds:[],reasonCode:'USER_REQUESTED_MAP'};
 assert.equal(evaluateToolProposal(location,c,1).reason,'CONTEXT_MISMATCH');
});
test('v127 transcript fixture: partial/uncertain/unknown speaker ignored, final corrected and retracted',()=>{
 let c=createCase('case_voice_1');const event={source:'MOCK_ASR_FIXTURE',caseId:c.caseId,eventId:'a_0',turnId:'turn_1',index:0,revision:0,speaker:'caller',text:'인증번호를 지금 알려주세요.',final:false,quality:'OK'};
 assert.equal(applyFixtureUtterance(c,event),c);
 assert.equal(applyFixtureUtterance(c,{...event,final:true,quality:'LOW_QUALITY'}),c);
 assert.equal(applyFixtureUtterance(c,{...event,final:true,speaker:'unknown'}),c);
 c=applyFixtureUtterance(c,{...event,final:true});assert.equal(c.checkpoint.turns.length,1);
 c=applyFixtureUtterance(c,{...event,final:true,eventId:'a_1',revision:1,text:'인증번호를 알려주지 마세요.'});
 assert.equal(c.checkpoint.turns[0].revision,1);
 c=applyCaseEvent(c,{type:'UTTERANCE_RETRACT',caseId:c.caseId,eventId:'a_2',turnId:'turn_1',revision:2});
 assert.equal(c.checkpoint.turns[0].status,'RETRACTED');
});
async function harness(scenario='otp'){
 const app=createDemoServer({port:0});const a=await app.listen();const base=`http://127.0.0.1:${a.port}`;
 const raw=async(path,body,headers={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const init=await raw('/api/session/create',{scenarioId:scenario,mode:'verified'});assert.equal(init.status,201);
 const creds=init.data.sessionCredentials;const headers={'X-SafeCall-Session':creds.sessionId,'X-SafeCall-Token':creds.parentToken};
 return {app,raw,state:init.data,headers,post:(path,body)=>raw(path,body,headers)};
}
const at=s=>({runId:s.runId,expectedVersion:s.version});
test('v127 server: auth, lock/replay, HOLD isolation, reset and end gates',async()=>{
 const h=await harness();try{
  let s=h.state;assert.equal(s.mockCard.status,'ACTIVE');assert.equal(s.metaCalled,false);
  const command={...at(s),action:'LOCK',cardRef:'DEMO_CARD_1',commandId:'safe_card_1',expectedCardRevision:0,confirmed:true};
  assert.equal((await h.raw('/api/mock-card/command',command)).status,403);
  let r=await h.post('/api/mock-card/command',{...command,confirmed:false});assert.equal(r.status,409);
  r=await h.post('/api/mock-card/command',command);assert.equal(r.status,200);s=r.data;
  assert.equal(s.mockCard.status,'LOCKED');assert.equal(s.safeBank.status,'READY');
  r=await h.post('/api/mock-card/command',command);assert.equal(r.status,200);assert.equal(r.data.mockCard.activity.length,1);
  r=await h.post('/api/mock-card/command',{...command,action:'UNLOCK'});assert.equal(r.status,409);assert.equal(r.data.code,'COMMAND_REPLAY_CONFLICT');
  r=await h.post('/api/mock-card/command',{...at(s),action:'UNLOCK',cardRef:'DEMO_CARD_1',commandId:'safe_card_2',expectedCardRevision:1,confirmed:true});
  assert.equal(r.status,200);s=r.data;assert.equal(s.mockCard.status,'ACTIVE');
  r=await h.post('/api/end',at(s));assert.equal(r.status,200);s=r.data;
  r=await h.post('/api/mock-card/command',{...at(s),action:'LOCK',cardRef:'DEMO_CARD_1',commandId:'safe_card_3',expectedCardRevision:2,confirmed:true});assert.equal(r.status,409);assert.equal(r.data.code,'CASE_ENDED');
  r=await h.post('/api/reset',{...at(s),scenarioId:'benign',mode:'verified'});assert.equal(r.status,200);assert.notEqual(r.data.runId,s.runId);assert.equal(r.data.mockCard.status,'ACTIVE');
 }finally{await h.app.close();}
});
test('v127 server: AI tool proposal can never mutate card/bank, and untrusted fields rejected',async()=>{
 const h=await harness();try{
  let s=h.state;for(let i=0;i<3;i++){const r=await h.post('/api/advance',at(s));assert.equal(r.status,200);s=r.data;}
  let report=await h.post('/api/action',{...at(s),action:'CARD_EXPOSURE_REPORTED'});assert.equal(report.status,200);s=report.data;
  const p={kind:'OFFER_MOCK_CARD_LOCK',caseId:s.runId,stateVersion:s.version,evidenceIds:['turn_3'],cardRef:'DEMO_CARD_1'};
  let r=await h.post('/api/ai/tool/propose',{...at(s),proposal:p});assert.equal(r.status,200);s=r.data;
  assert.equal(s.toolProposals.length,1);assert.equal(s.cardExposureReported,true);assert.equal(s.mockCard.status,'ACTIVE');assert.equal(s.safeBank.status,'READY');
  r=await h.post('/api/ai/tool/propose',{...at(s),proposal:{...p,stateVersion:s.version,url:'https://unknown.invalid'}});assert.equal(r.status,409);
  r=await h.post('/api/ai/tool/propose',{...at(s),proposal:{...p,stateVersion:s.version,kind:'EXECUTE_MOCK_CARD_LOCK'}});assert.equal(r.status,409);
  assert.equal((await h.post('/api/mock-card/command',{...at(s),action:'LOCK',cardRef:'DEMO_CARD_1',commandId:'card_7',expectedCardRevision:0,confirmed:false})).status,409);
 }finally{await h.app.close();}
});
import {classifyBankProximity} from '../src/modules/bank-arrival/geo-context.ts';
import {deriveIntervention} from '../src/modules/policy/intervention.ts';
test('v127 geospatial fixtures: consent, freshness, accuracy, trusted POI and no arrival assertion',()=>{
 const base={userConsented:true,nowMs:1_000_000,observationAtMs:999_000,accuracyMeters:30,distanceToVerifiedPoiMeters:70,bankPoiSourceVerified:true};
 assert.equal(classifyBankProximity(base),'NEAR_POSSIBLE');
 assert.equal(classifyBankProximity({...base,userConsented:false}),'NO_CONSENT');
 assert.equal(classifyBankProximity({...base,observationAtMs:800_000}),'STALE');
 assert.equal(classifyBankProximity({...base,accuracyMeters:500}),'INACCURATE');
 assert.equal(classifyBankProximity({...base,bankPoiSourceVerified:false}),'POI_UNVERIFIED');
 assert.equal(classifyBankProximity({...base,distanceToVerifiedPoiMeters:235}),'UNCERTAIN');
 assert.equal(classifyBankProximity({...base,distanceToVerifiedPoiMeters:550}),'FAR');
});
test('v127 intervention policy: no future leak, separate payment rail, emergency takes priority',()=>{
 let c=createCase('test_policy_1');assert.equal(deriveIntervention(c).route,'NO_ALERT');
 assert.equal(deriveIntervention(c,{cardDetailsExposedByUser:true}).route,'CARD_RISK_REPORTED');
 c=applyCaseEvent(c,{type:'UTTERANCE_FINAL',caseId:c.caseId,eventId:'evt_1',turnId:'turn_1',revision:0,absoluteIndex:0,speaker:'caller',text:'지금 당장 돈을 송금하세요.'});
 assert.equal(deriveIntervention(c).route,'TRANSFER_PAUSE');
 assert.equal(deriveIntervention(c).canSuggestMockCardLock,false);
 c=applyCaseEvent(c,{type:'UTTERANCE_FINAL',caseId:c.caseId,eventId:'evt_2',turnId:'turn_2',revision:0,absoluteIndex:1,speaker:'caller',text:'당신 아들을 납치했습니다. 경찰에 알리면 아들을 해칠 겁니다.'});
 assert.equal(deriveIntervention(c,{cardDetailsExposedByUser:true}).route,'EMERGENCY_FIRST');
 assert.equal(deriveIntervention(c).automaticFinancialAction,false);
 assert.equal(deriveIntervention(c).automaticMockCardLock,true);
});
test('v127 server: local threat locks the fictional card and blocks unlock',async()=>{
 const h=await harness('kidnap');try{
  let s=h.state;assert.equal(s.mockCard.status,'ACTIVE');
  let r=await h.post('/api/advance',at(s));assert.equal(r.status,200);s=r.data;
  assert.equal(s.mockCard.status,'ACTIVE');
  r=await h.post('/api/advance',at(s));assert.equal(r.status,200);s=r.data;
  assert.equal(s.mockCard.status,'LOCKED');
  assert.equal(s.safeBank.status,'READY');
  r=await h.post('/api/mock-card/command',{...at(s),action:'UNLOCK',cardRef:'DEMO_CARD_1',commandId:'emergency_unlock',expectedCardRevision:s.mockCard.revision,confirmed:true});
  assert.equal(r.status,409);assert.equal(r.data.code,'EMERGENCY_LOCK');
  r=await h.post('/api/advance',at(s));assert.equal(r.status,200);assert.equal(r.data.mockCard.status,'LOCKED');
 }finally{await h.app.close();}
});
test('v127 server: high transfer demand locks the fictional card only near the bank',async()=>{
 const h=await harness('bail');try{
  let s=h.state;
  let r=await h.post('/api/advance',at(s));assert.equal(r.status,200);s=r.data;
  r=await h.post('/api/advance',at(s));assert.equal(r.status,200);s=r.data;
  assert.equal(s.risk.band,'HIGH');assert.equal(s.mockCard.status,'ACTIVE');assert.equal(s.risk.emergency,false);
  for(let step=0;step<9&&s.location.zone!=='NEAR_BANK'&&s.location.zone!=='AT_BANK';step++){
    r=await h.post('/api/location/fixture',{...at(s),routeId:'BANK_APPROACH_V1',step});
    assert.equal(r.status,200);s=r.data;
  }
  assert.equal(s.mockCard.status,'LOCKED');assert.equal(s.safeBank.status,'READY');assert.equal(s.protectionGate.blocked,true);assert.equal(s.protectionGate.actualBankBlocked,false);
  r=await h.post('/api/mock-card/command',{...at(s),action:'UNLOCK',cardRef:'DEMO_CARD_1',commandId:'proximity_unlock',expectedCardRevision:s.mockCard.revision,confirmed:true});
  assert.equal(r.status,409);assert.equal(r.data.code,'PROXIMITY_LOCK');
  r=await h.post('/api/advance',at(s));assert.equal(r.status,200);assert.equal(r.data.mockCard.status,'LOCKED');
 }finally{await h.app.close();}
});
test('v127 server: a normal call at the fictional bank does not lock the card',async()=>{
 const h=await harness('benign');try{
  let s=h.state;
  for(let i=0;i<4;i++){const r=await h.post('/api/advance',at(s));assert.equal(r.status,200);s=r.data;}
  for(let step=0;step<9;step++){const r=await h.post('/api/location/fixture',{...at(s),routeId:'BANK_APPROACH_V1',step});assert.equal(r.status,200);s=r.data;}
  assert.equal(s.location.zone,'AT_BANK');assert.equal(s.risk.band,'LOW');assert.equal(s.mockCard.status,'ACTIVE');assert.equal(s.protectionGate.blocked,false);
 }finally{await h.app.close();}
});
