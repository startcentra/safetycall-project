import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceDemoSession, ApiError } from '../demo/safety-challenge/public/mobile-client.js';
import { createDemoServer } from '../demo/safety-challenge/server.mjs';

const demoState = (id='demo_mock_case') => ({
  runId:id,version:1,careCaseVersion:0,step:0,mode:'verified',endedAt:null,
  scenario:{id:'otp',totalSteps:4},
  risk:{band:'LOW',index:0,urgency:0,pressure:0,proximity:0,evidence:0,emergency:false},
  transcript:[],log:[],safeBank:{caseId:id,caseVersion:0,revision:0,status:'READY',activity:[]},
  bankArrivalConfirmed:false,bankHelpConsented:false,bankArrivalVersion:null,actions:[],review:{},
  sessionCredentials:{sessionId:'session_new',parentToken:'parent-token',childToken:'child-token'},
});

test('v124: failed new-session creation never commits or releases the previous session', async () => {
  let committed=false,released=false;
  const prior={auth:{sessionId:'session_old',token:'old-private-token'},caseId:'old_case'};
  await assert.rejects(replaceDemoSession({
    create:async()=>{throw new ApiError('NETWORK_ERROR','offline');},
    commit:()=>{committed=true;},releasePrevious:async()=>{released=true;},
  }),e=>e.code==='NETWORK_ERROR');
  assert.equal(committed,false);assert.equal(released,false);
  assert.equal(prior.caseId,'old_case');assert.equal(prior.auth.sessionId,'session_old');
});

test('v124: malformed replacement is never committed, previous session stays available', async () => {
  let committed=false;
  await assert.rejects(replaceDemoSession({create:async()=>({sessionCredentials:{}}),commit:()=>{committed=true;}}),e=>e.code==='INVALID_RESPONSE');
  assert.equal(committed,false);
});

test('v124: valid session is committed before previous session is released', async () => {
  const events=[];let state='old_case';
  const out=await replaceDemoSession({create:async()=>demoState('demo_new'),
    commit:s=>{events.push('commit');state=s.runId;},
    releasePrevious:async()=>{events.push('release');assert.equal(state,'demo_new');},
  });
  assert.equal(out.runId,'demo_new');assert.deepEqual(events,['commit','release']);
});

test('v124: failure closing old session does not roll back valid replacement', async () => {
  let state='old_case';const out=await replaceDemoSession({create:async()=>demoState('demo_new'),commit:s=>{state=s.runId;},
    releasePrevious:async()=>{throw new Error('old server already restarted');}});
  assert.equal(state,'demo_new');assert.equal(out.runId,'demo_new');
});

// Integration-level restart: backend sessions are intentionally ephemeral; a client
// must NOT represent a previous case as restored after the server is restarted.
test('v124: server restart invalidates old token and requires explicitly created new case', async () => {
  const first=createDemoServer({port:0});const a=await first.listen();const base=`http://127.0.0.1:${a.port}`;
  let previous;
  try {
    const response=await fetch(base+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:'otp',mode:'verified'})});
    assert.equal(response.status,201);previous=await response.json();
    const h={'X-SafeCall-Session':previous.sessionCredentials.sessionId,'X-SafeCall-Token':previous.sessionCredentials.parentToken};
    assert.equal((await fetch(base+'/api/state',{headers:h})).status,200);
  } finally {await first.close();}
  const second=createDemoServer({port:0});const b=await second.listen();const nextBase=`http://127.0.0.1:${b.port}`;
  try {
    const h={'X-SafeCall-Session':previous.sessionCredentials.sessionId,'X-SafeCall-Token':previous.sessionCredentials.parentToken};
    const expired=await fetch(nextBase+'/api/state',{headers:h});
    assert.equal(expired.status,403);assert.equal((await expired.json()).code,'FORBIDDEN');
    const created=await fetch(nextBase+'/api/session/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:'kidnap',mode:'verified'})});
    assert.equal(created.status,201);const fresh=await created.json();
    assert.notEqual(fresh.runId,previous.runId);
    assert.equal(fresh.safeBank.status,'READY');assert.equal(fresh.bankArrivalConfirmed,false);
    assert.equal(fresh.bankHelpConsented,false);assert.equal(fresh.endedAt,null);
  } finally {await second.close();}
});
