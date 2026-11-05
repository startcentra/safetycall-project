/**
 * Browser-E2E launcher for /live. TTS WAV -> real FFmpeg PCM -> real WebSocket adapter -> LOOPBACK contract simulator.
 * Nothing leaves this machine. Every run is labelled LOCAL_CONTRACT_SIMULATOR in state, events and UI.
 * SAFECALL_E2E_FIXTURE=1 makes the simulator return labelled "[SIM-FIXTURE]" lines (a rules-engine fixture, not the recording's
 * dialogue) so the HIGH-risk + simulated-bank hold path can be exercised. SAFECALL_E2E_GPS_FAST=1 compresses the GPS schedule.
 */
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
import {startSimulatorServer,placeholderText} from '../demo/safety-challenge/asr-contract-simulator.mjs';
import {MockMetaProvider} from '../src/modules/analysis/meta-provider.ts';
import {resolveFfmpeg} from './resolve-ffmpeg.mjs';

const KEY='local-simulator-not-a-key';
const FIXTURE=[
  '[SIM-FIXTURE] 서울중앙지검 수사관입니다.',
  '[SIM-FIXTURE] 계좌가 범죄에 연루되어 조사가 필요합니다. 아무에게도 말하지 마세요.',
  '[SIM-FIXTURE] 지금 바로 안전계좌로 돈을 송금하세요.',
];
const port=Number(process.env.SAFECALL_DEMO_PORT||4177);
if(process.env.SAFECALL_E2E_META_GATE==='1'){
  // Meta-mode UI with the transfer gate. The runner and model THROW if ever invoked, so nothing can be sent anywhere;
  // the test checks the audio-only UI without allowing a real upstream call.
  const never=()=>{throw new Error('E2E_GATE_RUNNER_MUST_NOT_RUN');};
  const gate=createDemoServer({port,mediaAsrEnabled:true,mediaAsrRunner:never,metaProvider:{analyze:never},
    metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:'e2e-gate-placeholder-not-a-key'}});
  const address=await gate.listen();
  console.log(`SafeCall /live E2E (META transfer gate, runner disabled): http://127.0.0.1:${address.port}/live`);
  const stop=async()=>{await gate.close();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}else{
const ffmpegBin=resolveFfmpeg();
if(!ffmpegBin){console.error('ffmpeg not found: set SAFECALL_FFMPEG_PATH');process.exit(2);}
const sim=await startSimulatorServer({expectKey:KEY,maxTurnMs:6000,textFor:process.env.SAFECALL_E2E_FIXTURE==='1'?(n=>FIXTURE[(n-1)%FIXTURE.length]):placeholderText});
// Simulator "model": the deterministic local mock, relabelled as LOCAL_CONTRACT_SIMULATOR by the server. Never Meta.
const mock=new MockMetaProvider();
const simulatorModel={analyze:async context=>{
  const input={...context.input,turns:context.input.turns.map(t=>({...t,speaker:'caller'}))};
  return {...await mock.analyze({...context,input}),analysisMode:'LIVE',elapsedMs:1,usage:null};
}};
const app=createDemoServer({port,mediaAsrEnabled:true,
  mediaAsrConfig:{provider:'LOCAL_CONTRACT_SIMULATOR',url:sim.url,modelProvider:'LOCAL_CONTRACT_SIMULATOR',ffmpegBin,
    gpsScheduleMs:process.env.SAFECALL_E2E_GPS_FAST==='1'?[3000,5000,7000,9000,11000,13000,15000,17000,19000]:undefined},
  metaConfig:{enabled:true,approved:true,killSwitch:false,apiKey:KEY,maxCallsPerProcess:50},metaProvider:simulatorModel});
const address=await app.listen();
console.log(`SafeCall /live E2E (LOCAL_CONTRACT_SIMULATOR): http://127.0.0.1:${address.port}/live`);
const shutdown=async()=>{await app.close();await sim.close();process.exit(0);};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
