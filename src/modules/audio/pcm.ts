/** Browser AudioBuffer => 24kHz 16-bit mono PCM, 80ms frames. Pure functions for test. */
export const TARGET_RATE=24000;
export const FRAME_SAMPLES=1920;
export function resampleLinear(input:Float32Array,inputRate:number,targetRate=TARGET_RATE):Float32Array {
 if(!Number.isFinite(inputRate)||inputRate<8000||inputRate>192000||!Number.isFinite(targetRate)||targetRate<8000||targetRate>48000)throw new Error('잘못된 WAV 샘플링 주파수');
 const output=new Float32Array(Math.floor(input.length*targetRate/inputRate));
 for(let i=0;i<output.length;i++){
   const at=i*inputRate/targetRate;const lo=Math.floor(at);const fraction=at-lo;
   output[i]=(input[Math.min(lo,input.length-1)]??0)*(1-fraction)+(input[Math.min(lo+1,input.length-1)]??0)*fraction;
 }
 return output;
}
export function pcm16Frames(samples:Float32Array,frameSamples=FRAME_SAMPLES):ArrayBuffer[] {
 if(!Number.isSafeInteger(frameSamples)||frameSamples<1||frameSamples>48000)throw new Error('잘못된 PCM 프레임 길이');
 const frames:ArrayBuffer[]=[];
 for(let i=0;i<samples.length;i+=frameSamples){const count=Math.min(frameSamples,samples.length-i);const bytes=new ArrayBuffer(count*2);const view=new DataView(bytes);
 for(let j=0;j<count;j++){const sample=samples[i+j];const value=Number.isFinite(sample)?Math.max(-1,Math.min(1,sample)):0;view.setInt16(j*2,Math.round(value<0?value*32768:value*32767),true);}
 frames.push(bytes);}return frames;
}
