import {test} from 'node:test';import assert from 'node:assert/strict';
import {emptyVoiceState,applyVoiceEvent} from '../src/modules/audio/transcript.ts';
import {assessTriage} from '../src/modules/risk-triage/index.ts';
import {selectDemoCoaching} from '../src/modules/coaching/index.ts';
test('finalized synthetic ASR turn passes same canonical triage and coaching; partial does not',()=>{
 let a=applyVoiceEvent(emptyVoiceState(),{type:'transcript',transcript:'지금 송금'});
 assert.equal(a.finalized.length,0);
 a=applyVoiceEvent(a,{type:'speechComplete',turnId:11,transcript:'지금 당장 송금하세요.',audioProcessedMs:2800});
 const assessment=assessTriage({turns:a.finalized.map(u=>({speaker:'caller',text:u.text}))});
 assert.ok(assessment.shouldCallMeta);assert.ok(assessment.riskIndex>0);
 const coaching=selectDemoCoaching({assessment,transferStatus:'NONE',claimStatus:'UNVERIFIED',ended:false});
 assert.ok(coaching.includes('송금') || coaching.includes('공식'));
});
