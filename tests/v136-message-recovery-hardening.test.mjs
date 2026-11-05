import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {classifyMessage,evaluateMessageContent,REVIEW_TTL_MS,projectMessages} from '../src/modules/message-safety/index.ts';
import {createRecoveryCapsule,openRecoveryCapsule} from '../src/modules/postcall-capsule/index.ts';
import {PLATFORM_CAPABILITIES,resolvePlatformCapability} from '../src/modules/platform-capability/index.ts';

async function harness(scenarioId='benign'){
 const app=createDemoServer({port:0});const {port}=await app.listen();
 const base=`http://127.0.0.1:${port}`;
 const response=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,mode:'verified'})});
 assert.equal(response.status,201);let state=await response.json();
 const parent={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.parentToken};
 const child={'X-SafeCall-Session':state.sessionCredentials.sessionId,'X-SafeCall-Token':state.sessionCredentials.childToken};
 async function post(route,body,auth=parent){const r=await fetch(base+route,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
 async function cmd(route,extra={}){const r=await post(route,{runId:state.runId,expectedVersion:state.version,...extra});if(r.status===200&&typeof r.body.version==='number')state=r.body;return r;}
 async function read(auth=parent){const r=await fetch(base+'/api/state',{headers:auth});return {status:r.status,body:await r.json()};}
 return {base,get state(){return state},parent,child,post,cmd,read,async close(){await app.close()}};
}

import {randomUUID as uuid} from 'node:crypto';
// use Node crypto rather than browser API in tests
const review=()=>({reviewId:'msg_review_'+uuid(),action:'RELEASE_PREVIEW',reason:'INDEPENDENT_OFFICIAL_CHECK_SELF_REPORTED',confirmed:true});

test('v136 contextual false-positive release: consent + 15-minute self-report + no navigation + subsequent evidence revokes',async()=>{
 const h=await harness('otp');try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'unknown-link',consented:true});
  for(let i=0;i<3;i++)assert.equal((await h.cmd('/api/advance')).status,200);
  assert.equal(h.state.risk.band,'HIGH');let m=h.state.messages.entries[0];assert.equal(m.reasonCode,'CALL_RISK_CONTEXT');
  assert.ok(m.observation.linkedEvidenceIds.length>0);
  const id=m.id;
  assert.equal((await h.cmd('/api/messages/review',{...review(),messageId:id,confirmed:false})).status,400);
  assert.equal((await h.cmd('/api/messages/review',{...review(),messageId:id,reason:'ANYTHING'})).status,400);
  assert.equal((await h.cmd('/api/messages/review',{...review(),messageId:id})).status,200);
  m=h.state.messages.entries[0];assert.equal(m.reasonCode,'USER_REVIEWED_TEMPORARY_QUARANTINE');assert.equal(m.verdict,'REVIEW_ONLY');
  assert.equal(m.review.active,true);assert.ok(Date.parse(m.review.expiresAt)>Date.now());
  await h.cmd('/api/messages/link-attempt',{messageId:id,attemptId:'msg_attempt_testrelease0001'});
  assert.equal(h.state.messages.lastAttempt.blocked,false);assert.equal(h.state.externalActionPerformed,false);
  assert.equal((await h.cmd('/api/advance')).status,200);
  m=h.state.messages.entries[0];assert.equal(m.verdict,'QUARANTINED');assert.equal(m.review.active,false);
 }finally{await h.close()}
});
test('v136 suspicious content quarantines even with HIGH contextual risk and cannot be self-released',async()=>{
 const h=await harness('otp');try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'prosecutor-bait',consented:true});
  for(let i=0;i<4;i++)await h.cmd('/api/advance');
  assert.equal(h.state.messages.entries[0].reasonCode,'SUSPICIOUS_MESSAGE_CONTENT');
  const m=h.state.messages.entries[0];assert.equal((await h.cmd('/api/messages/review',{...review(),messageId:m.id})).status,409);
  assert.equal((await h.cmd('/api/messages/link-attempt',{messageId:m.id,attemptId:'msg_attempt_quarantine9999'})).status,200);
  assert.equal(h.state.messages.lastAttempt.blocked,true);
 }finally{await h.close()}
});
test('v136 reviewing link never permits external navigation; can revoke and preserves idempotent replay',async()=>{
 const h=await harness('otp');try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'parcel-normal',consented:true});
  for(let i=0;i<3;i++)await h.cmd('/api/advance');
  const id=h.state.messages.entries[0].id,body={runId:h.state.runId,expectedVersion:h.state.version,messageId:id,...review()};
  const a=await h.post('/api/messages/review',body);assert.equal(a.status,200);const version=a.body.version;
  const retry=await h.post('/api/messages/review',body);assert.equal(retry.status,200);assert.equal(retry.body.version,version);
  assert.equal((await h.post('/api/messages/review',{...body,action:'REVOKE'})).status,409);
  assert.equal((await h.post('/api/messages/review',{...body,reviewId:'msg_review_alterid12',expectedVersion:version-1})).status,409);
  assert.equal((await h.post('/api/messages/review',{...body,reviewId:'msg_review_childtest1',expectedVersion:version},h.child)).status,403);
  const revoke=await h.post('/api/messages/review',{runId:h.state.runId,expectedVersion:version,reviewId:'msg_review_revoketest12',messageId:id,action:'REVOKE',reason:'USER_REVOKED',confirmed:true});
  assert.equal(revoke.status,200);assert.equal(revoke.body.messages.entries[0].verdict,'QUARANTINED');
 }finally{await h.close()}
});
test('v136 review expiry and case revision are server-side guards, not client-only button state',()=>{
 const msg={id:'msg_aaaaaaaaaaaaaaaaaaaa',fixtureId:'unknown-link',receivedAt:'2026-01-01T00:00:00Z'};
 const rev={reviewId:'msg_review_abcdefghi',messageId:msg.id,action:'RELEASE_PREVIEW',reason:'INDEPENDENT_OFFICIAL_CHECK_SELF_REPORTED',caseVersion:10,at:'2026-01-01T00:00:00Z',expiresAt:new Date(Date.parse('2026-01-01T00:00:00Z')+REVIEW_TTL_MS).toISOString()};
 const args={reviews:[rev],caseVersion:10,nowMs:Date.parse(rev.expiresAt)-1};
 assert.equal(projectMessages([msg],'HIGH',args)[0].verdict,'REVIEW_ONLY');
 assert.equal(projectMessages([msg],'HIGH',{...args,nowMs:Date.parse(rev.expiresAt)})[0].verdict,'QUARANTINED');
 assert.equal(projectMessages([msg],'HIGH',{...args,caseVersion:11})[0].verdict,'QUARANTINED');
 assert.equal(projectMessages([msg],'LOW',args)[0].verdict,'REVIEW_ONLY');
});
test('v136 URL normalization rejects link authority trick, punycode, embedded redirect and private host without fetching',()=>{
 const bad=['https://login.xn--bcher-kva.example/tracking','https://[::1]/','https://localhost/admin','https://example.org:8443/a',
  'https://example.org/?next=https%3A%2F%2Fevil.example%2F','https://user:pass@example.org/a','javascript:alert(1)'];
 for(const link of bad)assert.equal(evaluateMessageContent('사진 확인',link).reasonCode,'UNSAFE_LINK_FORMAT',link);
 assert.equal(evaluateMessageContent('정상 배송 추적: 공식 주문 내역을 확인하세요.','https://example.org/tracking').verdict,'REVIEW_ONLY');
 assert.equal(evaluateMessageContent('피싱 예방: 인증 번호를 제공하지 마세요.','https://example.org/security').verdict,'REVIEW_ONLY');
});
test('v136 encrypted user capsule: randomized AEAD + minimal fields + wrong password/tamper/expiry fail closed',()=>{
 const record={answers:{codeShared:'YES',linkOpened:'UNSURE'},taskStates:{SECURE_ACCOUNTS:'DONE'}};
 const pass='long local demo passphrase 24';const now=Date.parse('2026-11-04T00:00:00Z');
 const a=createRecoveryCapsule(record,pass,now),b=createRecoveryCapsule(record,pass,now);
 assert.notEqual(a,b);assert.deepEqual(openRecoveryCapsule(a,pass,now+100),record);
 const plaintext=Buffer.from(a,'base64url').toString('utf8');assert.doesNotMatch(plaintext,/codeShared|SECURE_ACCOUNTS|long local demo/);
 assert.throws(()=>openRecoveryCapsule(a,'wrong passphrase !!!!!',now+100));
 const env=JSON.parse(plaintext);env.data=env.data[0]==='A'?'B'+env.data.slice(1):'A'+env.data.slice(1);
 assert.throws(()=>openRecoveryCapsule(Buffer.from(JSON.stringify(env)).toString('base64url'),pass,now+100));
 assert.throws(()=>openRecoveryCapsule(a,pass,now+7*24*3600_000));
 assert.throws(()=>openRecoveryCapsule(a,pass,now-100));
 assert.throws(()=>createRecoveryCapsule(record,'short',now));
 assert.throws(()=>createRecoveryCapsule({answers:{evil:'YES'},taskStates:{}},pass,now));
});
test('v136 export/import across server restart restores ONLY self-reported postcall state into new case',async()=>{
 const original=await harness('benign');let capsule;try{
  await original.cmd('/api/action',{action:'END_CALL'});
  await original.cmd('/api/postcall/answer',{question:'codeShared',answer:'YES'});
  await original.cmd('/api/postcall/task',{taskId:'SECURE_ACCOUNTS',status:'DONE',eventId:'pc_v136_aaaaaaaa'});
  assert.equal((await original.cmd('/api/postcall/export',{passphrase:'my temporary secret recovery pass',consented:true})).status,200);
  const exp=await original.post('/api/postcall/export',{runId:original.state.runId,expectedVersion:original.state.version,consented:true,passphrase:'my temporary secret recovery pass'});
  assert.equal(exp.status,200);capsule=exp.body.capsule;
  assert.equal((await original.post('/api/postcall/export',{runId:original.state.runId,expectedVersion:original.state.version,consented:true,passphrase:'short'})).status,400);
  assert.equal((await original.post('/api/postcall/export',{runId:original.state.runId,expectedVersion:original.state.version,consented:true,passphrase:'my temporary secret recovery pass'},original.child)).status,403);
 }finally{await original.close()}
 const restored=await harness('benign');try{
  assert.equal((await restored.cmd('/api/postcall/import',{capsule,passphrase:'my temporary secret recovery pass',consented:true})).status,409);
  await restored.cmd('/api/action',{action:'END_CALL'});
  const bad=await restored.cmd('/api/postcall/import',{capsule,passphrase:'wrong local secret!!!!!!',consented:true});assert.equal(bad.status,400);
  assert.deepEqual(restored.state.postCall.answers,{});
  const ok=await restored.cmd('/api/postcall/import',{capsule,passphrase:'my temporary secret recovery pass',consented:true});assert.equal(ok.status,200);
  assert.equal(restored.state.postCall.answers.codeShared,'YES');
  assert.equal(restored.state.postCall.steps.find(s=>s.id==='SECURE_ACCOUNTS').status,'DONE');
  assert.equal(restored.state.recoveryVault.restoredFrom,'USER_ENCRYPTED_CAPSULE_SELF_REPORTED');
  assert.equal(restored.state.risk.band,'LOW');assert.equal(restored.state.safeBank.status,'READY');assert.equal(restored.state.mockCard.status,'ACTIVE');
  assert.equal(restored.state.externalActionPerformed,false);
  assert.equal((await restored.cmd('/api/postcall/import',{capsule,passphrase:'my temporary secret recovery pass',consented:true})).status,409);
  assert.equal((await restored.cmd('/api/postcall/delete',{scope:'POSTCALL_ONLY',confirmed:false})).status,400);
  assert.equal((await restored.cmd('/api/postcall/delete',{scope:'POSTCALL_ONLY',confirmed:true})).status,200);
  assert.deepEqual(restored.state.postCall.answers,{});
  assert.equal(restored.state.recoveryVault.restoredFrom,null);
  assert.equal(restored.state.safeBank.status,'READY');
  assert.equal(restored.state.postCall.steps.length,1);
 }finally{await restored.close()}
});
test('v136 concurrent tabs cannot overwrite newer postcall state or reviews',async()=>{
 const h=await harness('otp');try{
  const initialVersion=h.state.version;await h.cmd('/api/action',{action:'END_CALL'});
  const stale=await h.post('/api/postcall/answer',{runId:h.state.runId,expectedVersion:initialVersion,question:'codeShared',answer:'YES'});
  assert.equal(stale.status,409);assert.deepEqual(h.state.postCall.answers,{});
  await h.cmd('/api/postcall/answer',{question:'codeShared',answer:'YES'});
  assert.equal((await h.post('/api/postcall/delete',{runId:h.state.runId,expectedVersion:initialVersion,scope:'POSTCALL_ONLY',confirmed:true})).status,409);
  assert.equal(h.state.postCall.answers.codeShared,'YES');
 }finally{await h.close()}
});
test('v136 capability contract never claims real SMS/iMessage/KakaoTalk interception and child cannot read recovery',async()=>{
 const h=await harness();try{
  const state=h.state;assert.equal(state.platformCapability.nativeSmsBlocked,false);
  assert.equal(state.platformCapability.canBlockThirdPartyLinks,false);
  assert.equal(state.recoveryVault.serverPersistence,false);
  assert.equal((await h.read(h.child)).body.postCall,undefined);
  assert.equal((await h.read(h.child)).body.recoveryVault,undefined);
 }finally{await h.close()}
});
test('v136 UI has explicit review consent, encrypted capsule inputs, delete controls, no external SMS links',async()=>{
 const html=await readFile(new URL('../demo/safety-challenge/public/mobile.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../demo/safety-challenge/public/mobile.js',import.meta.url),'utf8');
 for(const id of ['msg-review-consent','postcall-passphrase','postcall-capsule','postcall-vault-consent','postcall-export','postcall-import','postcall-delete'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(js,/messages\/review/);assert.match(js,/postcall\/import/);assert.match(js,/postcall\/export/);assert.match(js,/postcall\/delete/);
 assert.doesNotMatch(js,/window\.open\(m\./);assert.doesNotMatch(js,/innerHTML\s*=\s*m\.body/);
});
test('v136 platform matrix is explicit: no native filter installed; digest, provenance and consent for observations',async()=>{
 const h=await harness();try{
  await h.cmd('/api/messages/mock-receive',{fixtureId:'unknown-link',consented:true});
  assert.equal(PLATFORM_CAPABILITIES.WEB.nativeAdapterInstalled,false);
  assert.equal(resolvePlatformCapability('ANDROID').policyEnforcement,'MOCK_ONLY');
  assert.equal(resolvePlatformCapability('IOS').imessage,'UNSUPPORTED_BY_IDENTITYLOOKUP');
  const m=h.state.messages.entries[0];
  assert.match(m.observation.contentDigest,/^sha256:[a-f0-9]{64}$/);
  assert.equal(m.observation.provenance,'CONSENTED_CATALOG_FIXTURE');assert.equal(m.observation.retention,'SESSION_MEMORY');
 }finally{await h.close()}
});
test('v136 privacy: exposure choices absent from audit log, archive can still delete self-report',async()=>{
 const h=await harness();try{
  await h.cmd('/api/action',{action:'END_CALL'});
  await h.cmd('/api/postcall/answer',{question:'codeShared',answer:'YES'});
  assert.doesNotMatch(JSON.stringify(h.state.log),/codeShared=YES/);
  await h.cmd('/api/end');assert.equal(h.state.postCall.status,'ARCHIVED');
  const deleted=await h.cmd('/api/postcall/delete',{scope:'POSTCALL_ONLY',confirmed:true});
  assert.equal(deleted.status,200);assert.deepEqual(h.state.postCall.answers,{});
  assert.doesNotMatch(JSON.stringify(h.state.log),/codeShared|SECURE_ACCOUNTS/);
  assert.equal((await h.cmd('/api/postcall/answer',{question:'codeShared',answer:'YES'})).status,409);
 }finally{await h.close()}
});
test('v136 capsule operations are rate-bounded even if password attempts fail',async()=>{
 const h=await harness();try{
  await h.cmd('/api/action',{action:'END_CALL'});
  for(let i=0;i<8;i++){
   const r=await h.post('/api/postcall/export',{runId:h.state.runId,expectedVersion:h.state.version,passphrase:'demo backup password 12345',consented:true});
   assert.equal(r.status,200);
  }
  const last=await h.post('/api/postcall/export',{runId:h.state.runId,expectedVersion:h.state.version,passphrase:'demo backup password 12345',consented:true});
  assert.equal(last.status,429);
 }finally{await h.close()}
});
test('v136 explicit observation port refuses arbitrary non-fixture input and native adapters fail closed',async()=>{
 const {observeBrowserMockFixture,NATIVE_MESSAGE_ADAPTER}=await import('../src/modules/message-safety/ports.ts');
 assert.equal(NATIVE_MESSAGE_ADAPTER.installed,false);
 assert.throws(()=>NATIVE_MESSAGE_ADAPTER.readSms());assert.throws(()=>NATIVE_MESSAGE_ADAPTER.blockThirdPartyLink());
 assert.throws(()=>observeBrowserMockFixture({messageId:'not allowed',body:'x',link:null,receivedAt:new Date().toISOString(),caseVersion:1}));
});

test('v136 published capability endpoint exposes only documentation, not OS permissions',async()=>{
 const h=await harness();try{
  const r=await fetch(h.base+'/api/platform/capabilities',{headers:h.parent});
  assert.equal(r.status,200);const x=await r.json();
  assert.equal(x.nativeIntegration,false);assert.equal(x.mode,'DOCUMENTED_CAPABILITY_MATRIX_NOT_DEVICE_DETECTION');
  assert.equal(x.platforms.WEB.nativeSmsRead,'UNSUPPORTED');
  assert.equal(x.platforms.ANDROID.nativeAdapterInstalled,false);
  assert.equal(x.platforms.IOS.nativeAdapterInstalled,false);
 }finally{await h.close()}
});
