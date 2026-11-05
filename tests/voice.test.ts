import {test} from 'node:test';import assert from 'node:assert/strict';
import {emptyVoiceState,applyVoiceEvent} from '../src/modules/audio/transcript.ts';
test('partials are REPLACED not appended; completes exactly once',()=>{
 let s=emptyVoiceState();s=applyVoiceEvent(s,{type:'speechStart',turnId:1});s=applyVoiceEvent(s,{type:'transcript',transcript:'입금'});s=applyVoiceEvent(s,{type:'transcript',transcript:'입금하세요'});assert.equal(s.partial,'입금하세요');assert.equal(s.finalized.length,0);s=applyVoiceEvent(s,{type:'speechComplete',turnId:1,transcript:'입금하세요.',audioProcessedMs:1000});s=applyVoiceEvent(s,{type:'speechComplete',turnId:1,transcript:'입금하세요.',audioProcessedMs:1000});assert.equal(s.finalized.length,1);assert.equal(s.finalized[0].text,'입금하세요.');
});
test('out-of-order final turn retained once, unknown ignored',()=>{let s=emptyVoiceState();s=applyVoiceEvent(s,{type:'eventOfFuture'});s=applyVoiceEvent(s,{type:'speechComplete',turnId:3,transcript:'확인'});assert.deepEqual(s.seenIds,['asr-3']);});

test('ignore orphan partials, negative IDs and non-finite timestamps',()=>{
 let s=applyVoiceEvent(emptyVoiceState(),{type:'transcript',transcript:'orphan'});
 assert.equal(s.partial,'');
 s=applyVoiceEvent(s,{type:'speechComplete',turnId:-3,transcript:'bad'});
 assert.equal(s.finalized.length,0);
 s=applyVoiceEvent(s,{type:'speechStart',turnId:3});
 s=applyVoiceEvent(s,{type:'transcript',transcript:'safe'});
 s=applyVoiceEvent(s,{type:'speechComplete',turnId:3,transcript:'hello',audioProcessedMs:NaN});
 assert.equal(s.finalized.length,1);assert.equal(s.finalized[0].audioProcessedMs,0);
});
test('empty complete transcript cannot trigger a new risk turn',()=>{
 let s=applyVoiceEvent(emptyVoiceState(),{type:'speechStart',turnId:12});
 s=applyVoiceEvent(s,{type:'speechComplete',turnId:12,transcript:'   '});
 assert.equal(s.finalized.length,0);
});
