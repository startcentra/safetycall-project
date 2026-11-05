import {test} from 'node:test';import assert from 'node:assert/strict';
import {resampleLinear,pcm16Frames} from '../src/modules/audio/pcm.ts';
test('24k PCM buffers 80ms per full frame',()=>{const samples=new Float32Array(3840).fill(.5);const packets=pcm16Frames(samples);assert.equal(packets.length,2);assert.equal(packets[0].byteLength,3840);assert.equal(new DataView(packets[0]).getInt16(0,true),16384);});
test('downsample to 24k',()=>{const src=new Float32Array(48000);assert.equal(resampleLinear(src,48000).length,24000);});

test('PCM invalid frame sizes cannot cause infinite loops',()=>{
 for(const value of [0,-1,NaN,Infinity,2.5])assert.throws(()=>pcm16Frames(new Float32Array(2),value));
});
test('PCM invalid output rates rejected and NaN samples converted to silence',()=>{
 assert.throws(()=>resampleLinear(new Float32Array(2),24000,0));
 assert.throws(()=>resampleLinear(new Float32Array(2),24000,Infinity));
 const data=new Float32Array([NaN,Infinity,-Infinity]);
 const bytes=pcm16Frames(data)[0];const view=new DataView(bytes);
 assert.equal(view.getInt16(0,true),0);assert.equal(view.getInt16(2,true),0);
});
