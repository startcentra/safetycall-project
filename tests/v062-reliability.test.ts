import {test} from 'node:test';import assert from 'node:assert/strict';
import {emptyVoiceState,applyVoiceEvent} from '../src/modules/audio/transcript.ts';
import {assessTriage} from '../src/modules/risk-triage/index.ts';
import {CostGuard,CostGuardError} from '../src/modules/cost/guard.ts';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'safecall-v062-'));
const guard=(file:string,cap=1)=>new CostGuard({file,totalUsd:5,initialApprovedUsd:5,dailyUsd:5,sessionUsd:cap,maxConcurrent:1,killSwitch:false,liveEnabled:true,spendApproved:true});
process.on('exit',()=>rmSync(root,{recursive:true,force:true}));
test('long caller utterance tail is analyzed, not silently truncated',()=>{
 const phrase='일반적인 안내입니다. '.repeat(100)+' 지금 송금하세요.';
 const s=applyVoiceEvent(emptyVoiceState(),{type:'speechComplete',turnId:1,transcript:phrase});
 assert.equal(s.finalized[0].text,phrase.trim());assert.equal(s.finalized[0].speaker,'unknown');
 const caller=assessTriage({turns:[{speaker:'caller',text:s.finalized[0].text}]});
 assert.ok(caller.signals.some(x=>x.code==='MONEY_REQUEST'));
 const unknown=assessTriage({turns:[{speaker:'unknown',text:s.finalized[0].text}]});
 assert.equal(unknown.signals.length,0,'unverified speaker may not be silently called the attacker');
});
test('ASR overlapping starts and out-of-order completes preserve open-turn order',()=>{
 let s=emptyVoiceState();s=applyVoiceEvent(s,{type:'speechStart',turnId:1});s=applyVoiceEvent(s,{type:'transcript',transcript:'먼저'});
 s=applyVoiceEvent(s,{type:'speechStart',turnId:2});s=applyVoiceEvent(s,{type:'speechComplete',turnId:2,transcript:'두 번째'});
 s=applyVoiceEvent(s,{type:'speechComplete',turnId:1,transcript:'첫 번째'});
 assert.deepEqual(s.finalized.map(v=>v.text),['첫 번째','두 번째']);
 assert.equal(s.finalized.some(t=>t.recovered),false);
 s=applyVoiceEvent(s,{type:'speechComplete',turnId:1,transcript:'변조'});
 assert.equal(s.finalized.length,2);
});
test('known cost releases unused reservation; timeout remains conservative',()=>{
 const local=guard(join(root,'spent.json'));
 const r=local.reserve('SPARK',.1,'session');const before=local.stats();assert.ok(before.pendingUsd>.1);
 local.settle(r,.005);
 const stats=local.stats();assert.equal(stats.measuredUsageUsd,.005);assert.equal(stats.pendingUsd,0);assert.equal(stats.liabilityUsd,0);
 assert.ok(stats.remainingApprovedUsd>before.remainingApprovedUsd);
 const u=local.reserve('SPARK',.02,'session');local.settle(u);
 assert.ok(local.stats().liabilityUsd>.02);
});
test('v1 ledger migrates conservatively without erasing legacy exposure',()=>{
 const file=join(root,'legacy.json');writeFileSync(file,JSON.stringify({version:1,spentMicros:120010,reservations:[{id:'legacy:1',kind:'SPARK',reservedMicros:120010,chargedMicros:120010,status:'SETTLED',openedAt:'2026-10-28T00:00:00.000Z',uncertain:false}]}));
 const local=guard(file);
 assert.equal(local.stats().measuredUsageUsd,0);assert.equal(local.stats().liabilityUsd,.12001);
 assert.equal(JSON.parse(readFileSync(file,'utf8')).version,2);
});
test('corrupt v2 ledger fails closed instead of restoring blank amounts',()=>{
 const file=join(root,'invalid.json');writeFileSync(file,JSON.stringify({version:2,legacyLiabilityMicros:-99,reservations:[]}));
 assert.throws(()=>guard(file).reserve('SPARK',.1,'fail'),CostGuardError);
});
