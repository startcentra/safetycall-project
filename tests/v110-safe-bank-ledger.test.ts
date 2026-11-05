import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoBankState,applyDemoBankCommand,type DemoBankCommand} from '../src/modules/mock-banking/safe-bank-ledger.ts';
const fresh=()=>createDemoBankState('case_demo',4);
const cmd=(patch:Partial<DemoBankCommand>={}):DemoBankCommand=>({id:'action_1',type:'HOLD',caseId:'case_demo',caseVersion:4,expectedRevision:0,userConfirmed:true,caseOpen:true,...patch});
test('explicitly confirmed mock hold never contains financial account data',()=>{
 const r=applyDemoBankCommand(fresh(),cmd());
 assert.equal(r.reason,'APPLIED');assert.equal(r.state.status,'HELD');
 assert.deepEqual(Object.keys(r.state).sort(),['activity','caseId','caseVersion','processedIds','processedCommands','revision','status'].sort());
});
test('duplicate click is idempotent and does not append activity',()=>{
 const a=applyDemoBankCommand(fresh(),cmd());
 const b=applyDemoBankCommand(a.state,cmd());
 assert.equal(b.reason,'DUPLICATE');assert.equal(b.state.activity.length,1);
});
test('stale case, version, concurrent revision and closed case fail closed',()=>{
 for(const patch of [{caseId:'other'},{caseVersion:3},{expectedRevision:2},{caseOpen:false}]){
  const r=applyDemoBankCommand(fresh(),cmd(patch));assert.equal(r.applied,false);assert.equal(r.state.status,'READY');
 }
});
test('consent required even for mock hold',()=>{
 assert.equal(applyDemoBankCommand(fresh(),cmd({userConfirmed:false})).reason,'CONSENT_REQUIRED');
});
test('cancel only held transfer, never change actual money',()=>{
 assert.equal(applyDemoBankCommand(fresh(),cmd({type:'CANCEL'})).reason,'NOT_HELD');
 const held=applyDemoBankCommand(fresh(),cmd()).state;
 const cancelled=applyDemoBankCommand(held,cmd({id:'action_2',type:'CANCEL',expectedRevision:1}));
 assert.equal(cancelled.state.status,'CANCELLED');assert.equal(cancelled.state.activity.length,2);
 assert.equal(applyDemoBankCommand(cancelled.state,cmd({id:'action_3',expectedRevision:2})).applied,false);
});
test('invalid and suspicious identifiers are rejected',()=>{
 assert.throws(()=>createDemoBankState('../../secret',1));
 assert.equal(applyDemoBankCommand(fresh(),cmd({id:'https://evil.test'})).reason,'INVALID');
});

test('same command ID with mutated payload is rejected instead of quietly deduplicated',()=>{
 const applied=applyDemoBankCommand(fresh(),cmd()).state;
 assert.equal(applyDemoBankCommand(applied,cmd({type:'CANCEL',expectedRevision:1})).reason,'CONFLICT');
 assert.equal(applyDemoBankCommand(applied,cmd({userConfirmed:false})).reason,'CONFLICT');
 assert.equal(applied.activity.length,1);
});
