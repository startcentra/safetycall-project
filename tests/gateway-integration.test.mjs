/** OFFLINE gateway integration harness: runs the exact gateway event handlers with fake sockets.
 * No `ws` dependency, no real network, no Meta key, and zero billable requests.
 * This does NOT test real WebSocket framing, TLS, or Meta protocol compatibility.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {CostGuard, estimateVoiceUsd} from '../src/modules/cost/guard.ts';
import {issueLiveTicket, verifyLiveTicket} from '../src/modules/security/live-auth.ts';

const GATEWAY = new URL('../scripts/voice-gateway.mjs', import.meta.url);
const access = 'this-is-a-long-offline-test-access-secret';
const signingKey = 'this-is-another-long-offline-signing-key';
const source = readFileSync(GATEWAY,'utf8').replace(/^import .*;\s*$/gm,'');

function harness(overrides={}) {
  const dir=mkdtempSync(join(tmpdir(),'safecall-gateway-offline-'));
  const budget=new CostGuard({file:join(dir,'ledger.json'),totalUsd:110,initialApprovedUsd:5,dailyUsd:5,sessionUsd:1,maxConcurrent:1,killSwitch:false,liveEnabled:true,spendApproved:true});
  const fakeMeta=[];
  let server;
  class FakeServer {
    constructor(opts){this.opts=opts;this.handlers=new Map();server={opts:this.opts,handlers:this.handlers};}
    on(event,fn){this.handlers.set(event,fn);}
  }
  class FakeUpstream {
    constructor(url){this.url=url;this.readyState=0;this.sent=[];this.bufferedAmount=0;this.closeCount=0;fakeMeta.push(this);}
    send(value){this.sent.push(value);}
    close(){this.closeCount++;this.readyState=3;this.onclose?.({code:1000});}
    connected(){this.readyState=1;this.onopen?.();}
    event(value){this.onmessage?.({data:JSON.stringify(value)});}
    fail(code=1006){this.readyState=3;this.onclose?.({code});}
  }
  class FakeBrowser {
    constructor(){this.readyState=1;this.sent=[];this.handlers=new Map();this.closeCount=0;}
    on(event,fn){this.handlers.set(event,fn);}
    send(value){this.sent.push(JSON.parse(value));}
    close(code,reason){if(this.readyState===3)return;this.closeCount++;this.closeCode=code;this.reason=reason;this.readyState=3;this.handlers.get('close')?.();}
    message(value,binary=false){this.handlers.get('message')?.(binary?value:Buffer.from(JSON.stringify(value)),binary);}
  }
  const env={META_LIVE_ENABLED:'false',META_VOICE_LIVE_ENABLED:'false',META_SPEND_APPROVED:'false',META_BUDGET_KILL_SWITCH:'true',SAFECALL_SESSION_SIGNING_KEY:signingKey,MODEL_API_KEY:'OFFLINE_FAKE_TOKEN_NOT_A_REAL_KEY',...overrides};
  runInNewContext(source,{WebSocketServer:FakeServer,WebSocket:FakeUpstream,serverCostGuard:()=>budget,estimateVoiceUsd,verifyLiveTicket,createHash,process:{env},Buffer,Date,Number,Math,JSON,Set,Map,Error,clearTimeout,setTimeout,console:{log(){}}},{filename:'voice-gateway.mjs',timeout:4000});
  function browser(){const b=new FakeBrowser();server.handlers.get('connection')(b);return b;}
  function ticket(){const t=issueLiveTicket('VOICE',access,access,signingKey);
    const sid=verifyLiveTicket(t,'VOICE',signingKey).sid.replaceAll('-','');
    budget.beginExperiment('voice_'+sid,'VOICE',{maxCalls:1,capUsd:0.05,ttlMs:720000});return t;}
  return {browser,ticket,budget,fakeMeta,server,env,close:()=>rmSync(dir,{recursive:true,force:true})};
}

test('gateway refuses all billable upstream connections by default',()=>{
 const h=harness();try{
  assert.equal(h.server.opts.host,'127.0.0.1');
  assert.equal(h.server.opts.verifyClient({origin:'https://attack.invalid'}),false);
  const b=h.browser();b.message({type:'start',ticket:h.ticket(),consented:true,durationSeconds:3});
  assert.equal(h.fakeMeta.length,0);assert.ok(b.sent.some(x=>x.type==='bridgeError'));
  assert.equal(h.budget.stats().exposureUsd,0);
 }finally{h.close();}
});

test('even when LIVE flags are set, missing consent and invalid signed tickets are rejected before upstream',()=>{
 const h=harness({META_LIVE_ENABLED:'true',META_VOICE_LIVE_ENABLED:'true',META_SPEND_APPROVED:'true',META_BUDGET_KILL_SWITCH:'false'});
 try{
  h.browser().message({type:'start',ticket:h.ticket(),consented:false,durationSeconds:2});
  h.browser().message({type:'start',ticket:'forged',consented:true,durationSeconds:2});
  assert.equal(h.fakeMeta.length,0);assert.equal(h.budget.stats().exposureUsd,0);
 }finally{h.close();}
});

test('signed session, fake ASR handshake, ordered FINAL, revocation and conservative billing',()=>{
 const h=harness({META_LIVE_ENABLED:'true',META_VOICE_LIVE_ENABLED:'true',META_SPEND_APPROVED:'true',META_BUDGET_KILL_SWITCH:'false'});
 try{
  const b=h.browser(); const t=h.ticket();
  b.message({type:'start',ticket:t,consented:true,durationSeconds:4});
  assert.equal(h.fakeMeta.length,1,'real gateway would attempt one ASR connection; harness intercepts');
  const u=h.fakeMeta[0];assert.equal(u.sent.length,0);
  u.connected();assert.equal(u.sent.length,1,'fake handshake sent');
  u.event({sessionId:'fake-server-session'});
  assert.ok(b.sent.some(x=>x.type==='bridgeReady'));
  b.message(Buffer.alloc(3840),true);
  assert.equal(u.sent.length,2,'one PCM frame forwarded');
  u.event({type:'speechStart',turnId:5,audioProcessedMs:80});
  u.event({type:'speechComplete',turnId:5,transcript:'가상 위험 발화',audioProcessedMs:80});
  assert.ok(b.sent.some(x=>x.type==='metaEvent'&&x.event.type==='speechComplete'));
  b.message({type:'revoke'});
  assert.equal(b.readyState,3);assert.ok(u.closeCount>=1);
  assert.equal(h.budget.stats().unsettled,0);
  assert.ok(h.budget.stats().liabilityUsd>0,'uncertain canceled request retains reserved liability');
  const count=u.sent.length;
  b.message(Buffer.alloc(3840),true);
  assert.equal(u.sent.length,count,'revoked session never transmits more audio');
 }finally{h.close();}
});

test('gateway rejects repeated ticket across browser connections in same process',()=>{
 const h=harness({META_LIVE_ENABLED:'true',META_VOICE_LIVE_ENABLED:'true',META_SPEND_APPROVED:'true',META_BUDGET_KILL_SWITCH:'false'});
 try{
  const t=h.ticket();h.browser().message({type:'start',ticket:t,consented:true,durationSeconds:3});
  const b=h.browser();b.message({type:'start',ticket:t,consented:true,durationSeconds:3});
  assert.equal(h.fakeMeta.length,1);assert.ok(b.sent.some(x=>x.type==='bridgeError'&&x.message.includes('이미 사용된')));
 }finally{h.close();}
});

test('bad PCM frame after fake handshake stops forwarding and retains unconfirmed budget',()=>{
 const h=harness({META_LIVE_ENABLED:'true',META_VOICE_LIVE_ENABLED:'true',META_SPEND_APPROVED:'true',META_BUDGET_KILL_SWITCH:'false'});
 try{
  const b=h.browser();b.message({type:'start',ticket:h.ticket(),consented:true,durationSeconds:2});
  const u=h.fakeMeta[0];u.connected();u.event({sessionId:'fake'});
  const before=u.sent.length;b.message(Buffer.alloc(3),true);
  assert.equal(u.sent.length,before);assert.equal(b.readyState,3);
  assert.ok(b.sent.some(x=>x.type==='bridgeError'&&x.message.includes('PCM')));
  assert.ok(h.budget.stats().liabilityUsd>0);
 }finally{h.close();}
});

test('endStream then fake normal ASR closure settles measured usage instead of entire reservation',()=>{
 const h=harness({META_LIVE_ENABLED:'true',META_VOICE_LIVE_ENABLED:'true',META_SPEND_APPROVED:'true',META_BUDGET_KILL_SWITCH:'false'});
 try{
  const b=h.browser();b.message({type:'start',ticket:h.ticket(),consented:true,durationSeconds:5});
  const u=h.fakeMeta[0];u.connected();u.event({sessionId:'fake'});
  b.message(Buffer.alloc(3840),true);
  u.event({type:'speechComplete',turnId:0,transcript:'테스트',audioProcessedMs:80});
  b.message({type:'end'});
  assert.ok(u.sent.some(x=>typeof x==='string'&&x.includes('endStream')));
  u.fail(1000);
  const ledger=h.budget.stats();
  assert.equal(ledger.unsettled,0);assert.equal(ledger.liabilityUsd,0);
  assert.ok(Math.abs(ledger.measuredUsageUsd-estimateVoiceUsd(0.08))<1e-9);
  assert.ok(ledger.measuredUsageUsd<estimateVoiceUsd(5));
 }finally{h.close();}
});

test('Meta ASR error event closes browser and preserves uncertain liability',()=>{
 const h=harness({META_LIVE_ENABLED:'true',META_VOICE_LIVE_ENABLED:'true',META_SPEND_APPROVED:'true',META_BUDGET_KILL_SWITCH:'false'});
 try{
  const b=h.browser();b.message({type:'start',ticket:h.ticket(),consented:true,durationSeconds:3});
  const u=h.fakeMeta[0];u.connected();u.event({sessionId:'fake'});
  u.event({type:'error',message:'test-fake-error'});
  assert.equal(b.readyState,3);assert.ok(b.sent.some(x=>x.type==='bridgeError'));
  assert.equal(h.budget.stats().unsettled,0);assert.ok(h.budget.stats().liabilityUsd>0);
 }finally{h.close();}
});
