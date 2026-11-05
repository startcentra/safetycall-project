import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {classifyMessage,evaluateMessageContent,derivePostCallPlan,projectMessages,MESSAGE_FIXTURES} from '../src/modules/message-safety/index.ts';

async function harness(scenarioId='benign'){
 const app=createDemoServer({port:0});const {port}=await app.listen();
 const base=`http://127.0.0.1:${port}`;
 const response=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,mode:'verified'})});
 assert.equal(response.status,201);let state=await response.json();
 const parent={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.parentToken};
 const child={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.childToken};
 async function post(path,body,auth=parent){const res=await fetch(base+path,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};}
 async function cmd(path,extra={}){const r=await post(path,{runId:state.runId,expectedVersion:state.version,...extra});if(r.status===200)state=r.body;return r;}
 async function read(auth=parent){const res=await fetch(base+'/api/state',{headers:auth});return {status:res.status,body:await res.json()};}
 return {get state(){return state;},parent,child,post,cmd,read,async close(){await app.close()}};
}

test('v135 policy: phishing motifs quarantined; benign parcels and normal family not overblocked',()=>{
 for(const id of ['parcel-bait','prosecutor-bait','otp-bait'])assert.equal(classifyMessage(id).verdict,'QUARANTINED');
 assert.equal(classifyMessage('family-normal').verdict,'NO_LINK');
 assert.equal(classifyMessage('parcel-normal').verdict,'REVIEW_ONLY');
 assert.equal(classifyMessage('unknown-link').verdict,'REVIEW_ONLY');
 assert.equal(classifyMessage('unknown-link',{caseRiskBand:'HIGH'}).verdict,'QUARANTINED');
 assert.equal(classifyMessage('parcel-normal',{caseRiskBand:'HIGH'}).verdict,'QUARANTINED');
 assert.equal(classifyMessage('family-normal',{caseRiskBand:'HIGH'}).verdict,'NO_LINK');
 for(const fixture of Object.values(MESSAGE_FIXTURES))assert.equal(fixture.link==null||fixture.link.includes('example.'),true);
});
test('v135 offline policy recognizes education/negation, unsafe schemes and untrusted URL contexts',()=>{
 const url='https://example.org/verify';
 assert.equal(evaluateMessageContent('보이스피싱 예방: 검찰 사건이라며 즉시 비밀번호를 입력하라고 하는 링크는 누르지 마세요.',url).verdict,'REVIEW_ONLY');
 assert.equal(evaluateMessageContent('등기 배송 추적 안내: 공식 쇼핑몰의 주문을 확인하세요.',url).verdict,'REVIEW_ONLY');
 assert.equal(evaluateMessageContent('검찰입니다. 즉시 개인정보를 입력하세요.',url).verdict,'QUARANTINED');
 assert.equal(evaluateMessageContent('사진 확인', 'javascript:alert(1)').reasonCode,'UNSAFE_LINK_FORMAT');
 assert.equal(evaluateMessageContent('사진 확인', 'http://192.168.1.1/login').reasonCode,'UNSAFE_LINK_FORMAT');
 assert.equal(evaluateMessageContent('사진 확인', 'https://user:pass@example.org/').reasonCode,'UNSAFE_LINK_FORMAT');
 assert.equal(evaluateMessageContent('사진 확인', 'https://example.org/a').verdict,'REVIEW_ONLY');
 assert.equal(evaluateMessageContent('사진 확인', 'https://example.org/a',{caseRiskBand:'HIGH'}).verdict,'QUARANTINED');
 assert.equal(evaluateMessageContent('가족 안부','', {caseRiskBand:'HIGH'}).verdict,'NO_LINK');
});
test('v135 explicit consent required; body is fixture-only; no arbitrary URL, message cap and duplicate',async()=>{
 const h=await harness();try{
  assert.equal((await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-bait'})).status,400);
  assert.equal((await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-bait',consented:false})).status,400);
  assert.equal((await h.cmd('/api/messages/mock-receive',{fixtureId:'evil',consented:true,url:'javascript:alert(1)'})).status,400);
  assert.equal((await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-bait',consented:true,url:'https://evil.invalid'})).status,400);
  const ok=await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-bait',consented:true});assert.equal(ok.status,200);
  assert.equal(ok.body.messages.entries.length,1);assert.equal(ok.body.messages.entries[0].verdict,'QUARANTINED');
  assert.equal((await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-bait',consented:true})).status,409);
  assert.equal((await h.read()).body.messages.entries.length,1);
 }finally{await h.close()}
});
test('v135 server policy blocks direct bypass, no external URL request and auditable blocked attempt',async()=>{
 const h=await harness();try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'prosecutor-bait',consented:true});const m=h.state.messages.entries[0];
  const id='msg_attempt_12345678';
  const r=await h.cmd('/api/messages/link-attempt',{messageId:m.id,attemptId:id});
  assert.equal(r.status,200);assert.equal(r.body.messages.lastAttempt.blocked,true);
  assert.equal(r.body.messages.lastAttempt.reason,'SUSPICIOUS_MESSAGE_CONTENT');assert.equal(r.body.messages.totalAttempts,1);
  assert.equal(r.body.externalActionPerformed,false);
  // Identical replay is idempotent even with stale main version.
  const old=r.body.version;const retry=await h.post('/api/messages/link-attempt',{runId:h.state.runId,expectedVersion:old-1,messageId:m.id,attemptId:id});
  assert.equal(retry.status,200);assert.equal(retry.body.version,old);assert.equal(retry.body.messages.totalAttempts,1);
  assert.equal((await h.post('/api/messages/link-attempt',{runId:h.state.runId,expectedVersion:old-1,messageId:'different',attemptId:id})).status,409);
  assert.equal((await h.cmd('/api/messages/link-attempt',{messageId:'unknown',attemptId:'msg_attempt_abcdefgh'})).status,404);
  assert.equal((await h.cmd('/api/messages/link-attempt',{messageId:m.id,attemptId:'evil'})).status,400);
  assert.equal((await h.read(h.child)).body.messages,undefined);
  assert.equal((await h.post('/api/messages/link-attempt',{runId:h.state.runId,expectedVersion:h.state.version,messageId:m.id,attemptId:'msg_attempt_abcd1234'},h.child)).status,403);
 }finally{await h.close()}
});
test('v135 benign link is only a MOCK preview; no active browser navigation',async()=>{
 const h=await harness();try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-normal',consented:true});const m=h.state.messages.entries[0];
  assert.equal(m.verdict,'REVIEW_ONLY');
  await h.cmd('/api/messages/link-attempt',{messageId:m.id,attemptId:'msg_attempt_bbbbbbbb'});
  assert.equal(h.state.messages.lastAttempt.blocked,false);assert.equal(h.state.messages.externalLinksOpened,false);
  assert.equal((await h.read()).body.externalActionPerformed,false);
 }finally{await h.close()}
});
test('v135 risk context: high risk call temporarily quarantines otherwise undecided unknown links',async()=>{
 const h=await harness('otp');try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'unknown-link',consented:true});
  assert.equal(h.state.messages.entries[0].verdict,'REVIEW_ONLY');
  for(let i=0;i<4;i++){const next=await h.cmd('/api/advance');assert.equal(next.status,200)}
  assert.equal(h.state.risk.band,'HIGH');assert.equal(h.state.messages.entries[0].verdict,'QUARANTINED');
  const id=h.state.messages.entries[0].id;
  await h.cmd('/api/messages/link-attempt',{messageId:id,attemptId:'msg_attempt_cccccccc'});
  assert.equal(h.state.messages.lastAttempt.reason,'CALL_RISK_CONTEXT');
 }finally{await h.close()}
});
test('v135 postcall cannot start before call end; call end is separate from case close',async()=>{
 const h=await harness('otp');try{
  assert.equal((await h.cmd('/api/postcall/answer',{question:'codeShared',answer:'YES'})).status,409);
  assert.equal(h.state.postCall.status,'WAITING_FOR_CALL_END');
  assert.equal((await h.cmd('/api/action',{action:'END_CALL'})).status,200);
  assert.equal(h.state.postCall.status,'ACTIVE');assert.equal(h.state.endedAt,null);
  assert.equal((await h.cmd('/api/advance')).status,409);
  assert.equal((await h.cmd('/api/voice/benchmark/advance',{fixtureId:'registered-mail',consented:true})).status,409);
  assert.equal((await h.cmd('/api/voice/fixture',{event:{}})).status,409);
  assert.equal((await h.cmd('/api/voice/replay/enable',{consented:true,mode:'EXTENDED_120S'})).status,409);
  assert.equal((await h.cmd('/api/action',{action:'END_CALL'})).status,409);
  assert.equal((await h.cmd('/api/postcall/answer',{question:'codeShared',answer:'YES'})).status,200);
  assert.equal(h.state.postCall.needsImmediateAttention,true);
  assert.equal(h.state.postCall.steps.some(x=>x.id==='CONTACT_FINANCIAL_PROVIDER'),true);
  assert.equal(h.state.postCall.steps.some(x=>x.id==='SECURE_ACCOUNTS'),true);
  assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
 }finally{await h.close()}
});
test('v135 context-driven postcall playbook for link, remote install, money, uncertain and emergency',()=>{
 const inputs=[
  [{linkOpened:'YES'},['DEVICE_REVIEW']],
  [{remoteInstalled:'YES'},['DEVICE_REVIEW']],
  [{moneySent:'YES'},['CONTACT_FINANCIAL_PROVIDER','REPORT_FRAUD']],
  [{identityShared:'UNSURE'},['SECURE_ACCOUNTS','REPORT_FRAUD']],
  [{codeShared:'NO'},[]],
 ];
 for(const [answers,must] of inputs){const plan=derivePostCallPlan({callEndedAt:'now',endedAt:null,riskBand:'LOW',emergency:false,answers});
  for(const id of must)assert.equal(plan.steps.some(t=>t.id===id),true,JSON.stringify(answers));
 }
 const card=derivePostCallPlan({callEndedAt:'now',endedAt:null,riskBand:'LOW',emergency:false,cardExposureReported:true});
 assert.equal(card.steps.some(x=>x.id==='CONTACT_FINANCIAL_PROVIDER'),true);
 const benign=derivePostCallPlan({callEndedAt:'now',endedAt:null,riskBand:'LOW',emergency:false});
 assert.deepEqual(benign.steps.map(x=>x.id),['OPTIONAL_REVIEW']);
 assert.equal(benign.needsImmediateAttention,false);
 const critical=derivePostCallPlan({callEndedAt:'now',endedAt:null,riskBand:'HIGH',emergency:true});
 assert.equal(critical.steps[0].id,'EMERGENCY_SAFETY');
});
test('v135 tasks: user-reported only, idempotent event and stale-version/conflicting replay protections',async()=>{
 const h=await harness();try{
  await h.cmd('/api/action',{action:'END_CALL'});
  const id='pc_aaaaaaaa';const r=await h.cmd('/api/postcall/task',{eventId:id,taskId:'OPTIONAL_REVIEW',status:'DONE'});
  assert.equal(r.status,200);assert.equal(h.state.postCall.completed,1);
  const same=await h.post('/api/postcall/task',{runId:h.state.runId,expectedVersion:h.state.version-1,eventId:id,taskId:'OPTIONAL_REVIEW',status:'DONE'});
  assert.equal(same.status,200);assert.equal(same.body.version,h.state.version);
  assert.equal((await h.post('/api/postcall/task',{runId:h.state.runId,expectedVersion:h.state.version-1,eventId:id,taskId:'OPTIONAL_REVIEW',status:'TODO'})).status,409);
  assert.equal((await h.post('/api/postcall/task',{runId:h.state.runId,expectedVersion:h.state.version-1,eventId:'pc_new00001',taskId:'OPTIONAL_REVIEW',status:'DONE'})).status,409);
  assert.equal((await h.cmd('/api/postcall/task',{eventId:'pc_new00002',taskId:'UNKNOWN',status:'DONE'})).status,409);
  await h.cmd('/api/postcall/answer',{question:'linkOpened',answer:'YES'});
  assert.equal(h.state.postCall.steps.some(x=>x.id==='DEVICE_REVIEW'),true);
  assert.equal(h.state.postCall.completed,0,'optional benign review is retired after reported exposure');
 }finally{await h.close()}
});
test('v135 case close freezes postcall and messages; reset isolates data and child projection',async()=>{
 const h=await harness();try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-bait',consented:true});
  await h.cmd('/api/action',{action:'END_CALL'});
  await h.cmd('/api/postcall/answer',{question:'moneySent',answer:'YES'});
  await h.cmd('/api/end');
  assert.equal(h.state.postCall.status,'ARCHIVED');
  assert.equal((await h.cmd('/api/messages/link-attempt',{messageId:h.state.messages.entries[0].id,attemptId:'msg_attempt_d1234567'})).status,409);
  assert.equal((await h.cmd('/api/postcall/answer',{question:'moneySent',answer:'NO'})).status,409);
  const before=h.state.runId;
  const next=await h.cmd('/api/reset',{scenarioId:'benign',mode:'verified'});
  assert.equal(next.status,200);assert.notEqual(h.state.runId,before);
  assert.equal(h.state.messages.entries.length,0);assert.equal(h.state.postCall.status,'WAITING_FOR_CALL_END');
  assert.equal((await h.read(h.child)).body.postCall,undefined);
 }finally{await h.close()}
});
test('v135 UI contains no clickable anchors from SMS body and offers explicit post-call workflow',async()=>{
 const html=await readFile(new URL('../demo/safety-challenge/public/mobile.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../demo/safety-challenge/public/mobile.js',import.meta.url),'utf8');
 assert.match(html,/id="view-messages"/);assert.match(html,/id="postcall-panel"/);assert.match(html,/id="msg-consent"/);
 assert.match(js,/\$\('msg-list'\)\.addEventListener/);assert.match(js,/esc\(m\.body\)/);
 assert.match(js,/disabled aria-disabled="true"/);assert.match(js,/messages\/link-attempt/);
 assert.doesNotMatch(js,/innerHTML\s*=\s*m\.body/);assert.doesNotMatch(js,/window\.open\(m\./);
});
test('v135 corrected/retracted caller evidence de-escalates provisional quarantine',async()=>{
 const h=await harness();try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'unknown-link',consented:true});
  const ev={source:'MOCK_ASR_FIXTURE',consented:true,operation:'FINAL',turnId:'voice_link_eval',revision:0,
   speaker:'caller',quality:'OK',text:'지금 당장 돈을 송금하세요. 인증번호를 알려주세요.'};
  const first=await h.cmd('/api/voice/fixture',{event:ev});assert.equal(first.status,200);
  assert.equal(h.state.risk.band,'HIGH');assert.equal(h.state.messages.entries[0].verdict,'QUARANTINED');
  const changed=await h.cmd('/api/voice/fixture',{event:{...ev,revision:1,text:'오늘 저녁 몇 시에 올까요?'}});
  assert.equal(changed.status,200);assert.equal(h.state.risk.band,'LOW');
  assert.equal(h.state.messages.entries[0].verdict,'REVIEW_ONLY');
  const removed=await h.cmd('/api/voice/fixture',{event:{source:'MOCK_ASR_FIXTURE',consented:true,operation:'RETRACT',turnId:'voice_link_eval',revision:2}});
  assert.equal(removed.status,200);assert.equal(h.state.risk.index,0);
 }finally{await h.close()}
});
test('v135 user-reported card exposure activates followup without any actual card lock',async()=>{
 const h=await harness('otp');try{
  assert.equal((await h.cmd('/api/action',{action:'CARD_EXPOSURE_REPORTED'})).status,200);
  assert.equal((await h.cmd('/api/action',{action:'END_CALL'})).status,200);
  assert.equal(h.state.postCall.steps.some(s=>s.id==='CONTACT_FINANCIAL_PROVIDER'),true);
  assert.equal(h.state.postCall.steps.some(s=>s.id==='REPORT_FRAUD'),true);
  assert.equal(h.state.mockCard.status,'ACTIVE');assert.equal(h.state.safeBank.status,'READY');
  assert.equal(h.state.externalActionPerformed,false);
 }finally{await h.close()}
});
test('v135 role, origin and stale-case guards also protect message and postcall commands',async()=>{
 const h=await harness('benign');try{
  const runId=h.state.runId,version=h.state.version;
  const b={runId,expectedVersion:version,fixtureId:'otp-bait',consented:true};
  assert.equal((await h.post('/api/messages/mock-receive',b,h.child)).status,403);
  assert.equal((await h.post('/api/messages/mock-receive',{...b,runId:'demo_wrong'},h.parent)).status,409);
  assert.equal((await h.cmd('/api/messages/mock-receive',{fixtureId:'family-normal',consented:true})).status,200);
  assert.equal((await h.post('/api/messages/mock-receive',{...b,expectedVersion:version},h.parent)).status,409);
  assert.equal((await h.cmd('/api/action',{action:'END_CALL'})).status,200);
  assert.equal((await h.post('/api/postcall/answer',{runId:h.state.runId,expectedVersion:h.state.version,question:'linkOpened',answer:'YES'},h.child)).status,403);
  assert.equal((await h.cmd('/api/postcall/answer',{question:'linkOpened',answer:'INVALID'})).status,400);
  assert.equal((await h.cmd('/api/postcall/answer',{question:'notDefined',answer:'YES'})).status,400);
  assert.equal((await h.cmd('/api/postcall/task',{taskId:'OPTIONAL_REVIEW',status:'DELETE',eventId:'pc_abcd5678'})).status,400);
  assert.equal(h.state.postCall.status,'ACTIVE');
 }finally{await h.close()}
});
test('v135 message link attempt rate bound prevents event/log flooding',async()=>{
 const h=await harness();try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'otp-bait',consented:true});
  const id=h.state.messages.entries[0].id;
  for(let i=0;i<24;i++){
   const r=await h.cmd('/api/messages/link-attempt',{messageId:id,attemptId:`msg_attempt_limited_${i.toString().padStart(3,'0')}`});
   assert.equal(r.status,200,`attempt ${i}`);assert.equal(r.body.messages.lastAttempt.blocked,true);
  }
  assert.equal(h.state.messages.totalAttempts,24);
  assert.equal((await h.cmd('/api/messages/link-attempt',{messageId:id,attemptId:'msg_attempt_limited_999'})).status,429);
  assert.equal((await h.read()).body.messages.totalAttempts,24);
 }finally{await h.close()}
});
