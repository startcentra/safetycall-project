import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {CostGuard,CostGuardError,estimateVoiceUsd,estimateSparkUsd} from '../src/modules/cost/guard.ts';
const dir=mkdtempSync(join(tmpdir(),'safecall-budget-'));const file=join(dir,'budget.json');
const c=(override={})=>new CostGuard({file,totalUsd:110,initialApprovedUsd:5,dailyUsd:5,sessionUsd:1,maxConcurrent:1,killSwitch:false,liveEnabled:true,spendApproved:true,...override});
test('pricing math',()=>{assert.equal(estimateVoiceUsd(3600),.18);assert.equal(estimateSparkUsd(1_000_000,1_000_000),5.5);});
test('offline and kill-switch fail closed',()=>{assert.throws(()=>c({liveEnabled:false}).reserve('VOICE',.1,'session'),CostGuardError);assert.throws(()=>c({killSwitch:true}).reserve('VOICE',.1,'session'),CostGuardError);assert.throws(()=>c({spendApproved:false}).reserve('VOICE',.1,'session'),CostGuardError);});
test('durable reservation / concurrent guard / settlement',()=>{const a=c();const id=a.reserve('VOICE',.1,'s1');assert.throws(()=>c().reserve('VOICE',.1,'s2'),CostGuardError);assert.equal(c().stats().unsettled,1);c().settle(id,.08);assert.equal(c().stats().unsettled,0);assert.equal(c().stats().measuredUsageUsd,.08);assert.equal(c().stats().liabilityUsd,0);assert.throws(()=>c().settle(id,0),CostGuardError);});
test('approval cap and daily cap',()=>{const limited=c({dailyUsd:.01});assert.throws(()=>limited.reserve('VOICE',.1,'s3'),CostGuardError);});
test('unknown upstream charge keeps reserve',()=>{const id=c().reserve('SPARK',.02,'s4');c().settle(id);assert.ok(c().stats().uncertain>0);});
test('conservative failure on broken ledger',()=>{const busted=c({file:dir+'/missing/is/a/dir'});assert.ok(busted.stats());});
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));

test('reject invalid NaN, Infinity and negative budget configuration',()=>{
 for(const key of ['totalUsd','initialApprovedUsd','dailyUsd','sessionUsd']){
  for(const value of [NaN,Infinity,-1])assert.throws(()=>c({[key]:value}),CostGuardError);
 }
 for(const value of [NaN,0,Infinity,1.5])assert.throws(()=>c({maxConcurrent:value}),CostGuardError);
});
test('reject invalid ASR pricing duration',()=>{
 for(const value of [NaN,Infinity,-1,86401])assert.throws(()=>estimateVoiceUsd(value),CostGuardError);
});
test('malformed ledger cannot produce negative remaining budget or authorize billing',()=>{
 const badFile=join(dir,'corrupt.json');
 writeFileSync(badFile,JSON.stringify({version:1,spentMicros:-1000,reservations:[]}));
 assert.throws(()=>c({file:badFile}).reserve('VOICE',.1,'tamper'),CostGuardError);
});

test('ongoing voice stream must not block Spark analysis while both share the budget cap',()=>{
 const local=c({file:join(dir,'parallel.json')});
 const voice=local.reserve('VOICE',.01,'voice01');
 const spark=local.reserve('SPARK',.02,'spark01');
 const spark2=local.reserve('SPARK',.02,'spark02');
 assert.throws(()=>local.reserve('SPARK',.02,'spark03'),CostGuardError);
 assert.throws(()=>local.reserve('VOICE',.01,'voice02'),CostGuardError);
 local.settle(spark,.01);local.settle(spark2,.01);local.settle(voice,.01);
 assert.equal(local.stats().unsettled,0);
});
