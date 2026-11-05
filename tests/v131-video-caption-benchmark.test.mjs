import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateCaptionTimeline,extractContextEvidence} from '../src/modules/voice-benchmark/index.ts';
import {assessTriage} from '../src/modules/risk-triage/index.ts';
const fixtures=JSON.parse(await readFile(new URL('../data/v131/video-caption-observations.json',import.meta.url),'utf8'));
const find=id=>fixtures.cases.find(c=>c.id===id);
test('v131 timestamps are strictly monotonic and windows never read future observation',()=>{
 for(const c of fixtures.cases){const r=evaluateCaptionTimeline(c,5000,110000);assert.equal(r.length,22);for(const point of r){assert.equal(point.observationCount,c.observations.filter(x=>x.observedAtMs<=point.atMs).length);assert.equal(point.mode,'SPARSE_CAPTION_OBSERVATION_NOT_STT');}}
});
test('v131 avoids premature warning before any observed suspicious evidence',()=>{
 const mail=evaluateCaptionTimeline(find('registered-mail'),5000,60000);
 assert.equal(mail[0].riskIndex,0);assert.equal(mail[0].contextEvidence.length,0);
 assert.equal(mail.find(p=>p.atMs===55000).contextEvidence.some(x=>x.code==='NAVIGATION_PROMPT'),false);
 assert.equal(mail.find(p=>p.atMs===60000).contextEvidence.some(x=>x.code==='NAVIGATION_PROMPT'),true);
});
test('v131 prosecutor crime involvement observed after authority claim, not before',()=>{
 const points=evaluateCaptionTimeline(find('prosecutor-personal-data'),5000,85000);
 assert.equal(points.find(p=>p.atMs===60000).contextEvidence.some(x=>x.code==='CRIME_INVOLVEMENT_CLAIM'),false);
 assert.equal(points.find(p=>p.atMs===80000).contextEvidence.some(x=>x.code==='CRIME_INVOLVEMENT_CLAIM'),true);
});
test('v131 educational and negated examples avoid proposed contextual warnings',()=>{
 for(const row of fixtures.controls){assert.deepEqual(extractContextEvidence([{...row,observedAtMs:1000}]),[],row.id);}
 const refusal=assessTriage({turns:[{speaker:'caller',text:'인증번호를 알려주지 마세요. 송금하지 마세요.'}]});
 assert.equal(refusal.signals.some(s=>s.code==='MONEY_REQUEST'||s.code==='CREDENTIAL_REQUEST'),false);
});
test('v131 unknown/user speech cannot authorize supplemental caller evidence',()=>{
 assert.deepEqual(extractContextEvidence([{speaker:'user',observedAtMs:10,text:'인터넷 주소창에 사이트를 입력하세요'}]),[]);
 assert.deepEqual(extractContextEvidence([{speaker:'unknown',observedAtMs:10,text:'대포통장으로 개설되어 범죄에 사용된 사실'}]),[]);
});
test('v131 invalid observations and oversized audio windows fail closed',()=>{
 const c=find('registered-mail');
 assert.throws(()=>evaluateCaptionTimeline({...c,observations:[c.observations[1],c.observations[0]]}));
 assert.throws(()=>evaluateCaptionTimeline({...c,observations:[{observedAtMs:0,speaker:'caller',text:'x'.repeat(1000)}]}));
 assert.throws(()=>evaluateCaptionTimeline(c,12000));
 assert.throws(()=>evaluateCaptionTimeline(c,5000,c.durationMs+1));
});
test('v131 no automatic financial action in checkpoint output',()=>{
 for(const c of fixtures.cases)for(const p of evaluateCaptionTimeline(c,5000,110000)){
  assert.ok(['NO_AUTO_ACTION','VERIFY_OFFICIAL_CHANNEL'].includes(p.protection));
  assert.equal('cardLock' in p,false);assert.equal('transferHold' in p,false);
 }
});
