import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {MEDIA_CATALOG,spawnPcmDecoder,streamMediaToMuse,PCM_BYTES_PER_MS} from '../demo/safety-challenge/media-realtime.mjs';
import {createSimulatedWebSocketFactory} from '../demo/safety-challenge/asr-contract-simulator.mjs';
import {resolveFfmpeg} from '../scripts/resolve-ffmpeg.mjs';

const MEDIA_DIR=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','demo','safety-challenge','media');
const ffmpeg=resolveFfmpeg('ffmpeg'),ffprobe=resolveFfmpeg('ffprobe');
const UNVERIFIED='UNVERIFIED: ffmpeg/ffprobe not found (set SAFECALL_FFMPEG_PATH)';

function run(bin,args){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{windowsHide:true});const out=[];let err='';
  p.stdout.on('data',d=>out.push(d));p.stderr.on('data',d=>{err+=d;});p.on('error',reject);
  p.on('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(`${path.basename(bin)} exit ${code}: ${err.slice(0,200)}`)));});}
function rmsDbfs(buf){let sum=0;const n=buf.length>>1;for(let i=0;i<n;i++){const v=buf.readInt16LE(i*2)/32768;sum+=v*v;}return n?10*Math.log10(sum/n||1e-12):-120;}

for(const item of MEDIA_CATALOG){
  const file=path.join(MEDIA_DIR,item.filename);

  test(`${item.id}: container duration and audio track match the catalog`,{skip:!ffprobe&&UNVERIFIED},async()=>{
    const info=JSON.parse((await run(ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,sample_rate,channels','-of','json',file])).toString());
    assert.ok(Math.abs(Number(info.format.duration)-item.durationSeconds)<=0.05,`duration ${info.format.duration}`);
    const audio=info.streams.filter(s=>s.codec_type==='audio');
    assert.equal(audio.length,1,'exactly one audio track');
    assert.ok(Number(audio[0].sample_rate)>=16000);
  });

  test(`${item.id}: FFmpeg decodes to 24 kHz mono s16le; 2 s = 96000 bytes; full decode length matches; audio is not silent`,{skip:!ffmpeg&&UNVERIFIED},async()=>{
    const two=await run(ffmpeg,['-nostdin','-v','error','-i',file,'-t','2','-vn','-ac','1','-ar','24000','-c:a','pcm_s16le','-f','s16le','pipe:1']);
    assert.equal(two.length,96000);
    const chunks=[];const p=spawnPcmDecoder(file,ffmpeg);
    await new Promise((resolve,reject)=>{p.stdout.on('data',d=>chunks.push(d));p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error('decode exit '+c)));});
    const pcm=Buffer.concat(chunks);
    const ms=pcm.length/PCM_BYTES_PER_MS;
    assert.ok(Math.abs(ms-item.durationSeconds*1000)<=120,`decoded ${ms} ms`);
    assert.ok(rmsDbfs(pcm)>-45,`recording has audible speech energy (${rmsDbfs(pcm).toFixed(1)} dBFS)`);
  });

  test(`${item.id}: the whole recording streams through the realtime adapter as real PCM (loopback contract simulator)`,{skip:!ffmpeg&&UNVERIFIED},async()=>{
    const factory=createSimulatedWebSocketFactory({expectKey:'k',maxTurnMs:6000});
    const finals=[];
    const result=await streamMediaToMuse({inputPath:file,apiKey:'k',ffmpegBin:ffmpeg,websocketFactory:factory,frameIntervalMs:1,onEvent:e=>{if(e.type==='ASR_FINAL')finals.push(e);}});
    assert.ok(Math.abs(result.mediaMs-item.durationSeconds*1000)<=120,`streamed ${result.mediaMs} ms`);
    assert.equal(result.closeCode,1000);
    assert.ok(finals.length>=5,'energy-based endpointing found speech turns in the decoded audio');
    assert.ok(finals.every(f=>f.endMediaMs<=item.durationSeconds*1000+120&&f.startMediaMs<=f.endMediaMs));
  });
}

const synthetics=MEDIA_CATALOG.filter(m=>m.kind==='SYNTHETIC_TTS');
if(!synthetics.length)test('synthetic recordings: audio/transcript sync',{skip:'UNVERIFIED: run scripts/generate-synthetic-recording.mjs'},()=>{});
for(const synthetic of synthetics)test(`${synthetic.id}: streamed turn boundaries line up with the known script timing (audio/transcript sync)`,{skip:!ffmpeg&&UNVERIFIED},async()=>{
  const manifest=JSON.parse(await readFile(path.join(MEDIA_DIR,`${synthetic.id}.manifest.json`),'utf8'));
  const factory=createSimulatedWebSocketFactory({expectKey:'k'});
  const finals=[];
  await streamMediaToMuse({inputPath:path.join(MEDIA_DIR,synthetic.filename),apiKey:'k',ffmpegBin:ffmpeg,websocketFactory:factory,frameIntervalMs:1,onEvent:e=>{if(e.type==='ASR_FINAL')finals.push(e);}});
  // Endpointing may split a scripted line at a sentence pause, so count can exceed the script; it may not miss lines.
  assert.ok(finals.length>=manifest.turns.length,`${finals.length} streamed turns vs ${manifest.turns.length} scripted`);
  const errors=manifest.turns.map(t=>Math.min(...finals.map(f=>Math.abs(f.startMediaMs-t.startMs)))).sort((a,b)=>a-b);
  const median=errors[Math.floor(errors.length/2)];
  assert.ok(median<=320&&errors.at(-1)<=640,`turn-start error median ${median} ms, max ${errors.at(-1)} ms`);
  const inGap=finals.filter(f=>!manifest.turns.some(t=>f.startMediaMs>=t.startMs-320&&f.startMediaMs<=t.endMs));
  assert.equal(inGap.length,0,`turns starting inside scripted silence: ${inGap.map(f=>f.startMediaMs)}`);
  assert.ok(finals.every(f=>f.endMediaMs<=manifest.durationSeconds*1000+120));
  assert.equal(manifest.sha256,createHash('sha256').update(await readFile(path.join(MEDIA_DIR,synthetic.filename))).digest('hex'),'manifest matches the generated WAV');
});

test('media route: 200 full, 206 ranges with Content-Range, 416 out of range, unknown files 404', async()=>{
  const app=createDemoServer({});const {port}=await app.listen();const base='http://127.0.0.1:'+port;
  try{
    for(const item of MEDIA_CATALOG){
      const size=(await stat(path.join(MEDIA_DIR,item.filename))).size,url=`${base}/media/${item.id}.wav`;
      const full=await fetch(url,{method:'GET'});
      assert.equal(full.status,200);assert.equal(full.headers.get('content-type'),'audio/wav');assert.equal(Number(full.headers.get('content-length')),size);assert.equal(full.headers.get('accept-ranges'),'bytes');
      await full.body.cancel();
      const head=await fetch(url,{headers:{range:'bytes=0-127'}});
      assert.equal(head.status,206);assert.equal(head.headers.get('content-range'),`bytes 0-127/${size}`);assert.equal((await head.arrayBuffer()).byteLength,128);
      const tail=await fetch(url,{headers:{range:`bytes=${size-100}-`}});
      assert.equal(tail.status,206);assert.equal((await tail.arrayBuffer()).byteLength,100);
      const bad=await fetch(url,{headers:{range:`bytes=${size}-`}});assert.equal(bad.status,416);await bad.text();
      const inverted=await fetch(url,{headers:{range:'bytes=500-100'}});assert.equal(inverted.status,416);await inverted.text();
    }
    for(const p of ['/media/secret.wav','/media/..%2Fserver.mjs','/media/synthetic-prosecutor-en.wav.bak'])assert.equal((await fetch(base+p)).status,404,p);
  }finally{await app.close();}
});
