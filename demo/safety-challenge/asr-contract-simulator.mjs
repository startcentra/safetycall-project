/** TEST-ONLY local simulator of the documented Meta realtime ASR wire protocol. NOT Meta and NOT speech recognition.
 * Turn boundaries come from a simple energy VAD over the PCM it actually receives; transcript text is a labelled placeholder
 * unless a test supplies an explicit fixture. The server labels every run against it LOCAL_CONTRACT_SIMULATOR.
 */
import {frameDbfs,PCM_BYTES_PER_MS,ASR_MODEL} from './media-realtime.mjs';

export const SIMULATOR_LABEL='LOCAL_CONTRACT_SIMULATOR';
export const placeholderText=(n,ms)=>`[SIM-ASR #${n} ${(ms/1000).toFixed(1)}s]`;

/**
 * One simulated realtime session. `send(text)` emits a server JSON frame, `close(code)` closes the socket.
 * Options: expectKey (handshake must carry `Bearer <expectKey>`), textFor(turnNumber, speechMs), speechDbfs, endSilenceMs,
 * failAt {audioMs, closeCode, errorType}, enforceBacklog (close 1008 when > 5 s ahead of wall-clock processing).
 */
export function createSimulatedSession({send,close,expectKey=null,textFor=placeholderText,speechDbfs=-38,endSilenceMs=640,maxTurnMs=null,failAt=null,enforceBacklog=false,idleMs=null,now=()=>performance.now()}){
 let acked=false,ended=false,closed=false,receivedMs=0,firstAudioAt=null,turnSeq=0,turn=null,silenceRun=0,speechRun=0,lastPartialAt=0,idleTimer=null;
 const out=o=>{if(!closed)send(JSON.stringify(o));};
 const shut=code=>{if(closed)return;closed=true;clearTimeout(idleTimer);close(code);};
 const armIdle=()=>{if(!idleMs)return;clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(!ended){out({type:'error',message:'idle input',sessionId:'sim'});shut(1008);}},idleMs);idleTimer.unref?.();};
 function finishTurn(atMs){
  if(!turn)return;
  const speechMs=Math.max(80,atMs-turn.start);
  out({type:'speechEnd',turnId:turn.id,audioProcessedMs:atMs});
  out({type:'speechComplete',turnId:turn.id,transcript:textFor(turn.id,speechMs),audioProcessedMs:atMs});
  turn=null;
 }
 return {
  receiveText(raw){
   if(closed)return;
   let msg;try{msg=JSON.parse(raw);}catch{out({type:'error',message:'bad json',sessionId:''});return shut(1008);}
   if(!acked){
    const ok=msg?.authorization&&typeof msg.authorization.accessToken==='string'&&msg.authorization.accessToken.startsWith('Bearer ')&&
     (expectKey===null||msg.authorization.accessToken===`Bearer ${expectKey}`)&&msg.audioEncoding==='PCM_24KHZ'&&msg.model===ASR_MODEL&&['ENDPOINTING','DIARIZATION'].includes(msg.mode);
    if(!ok){out({type:'error',message:'handshake rejected',sessionId:'',errorType:'authentication_error'});return shut(1008);}
    acked=true;out({sessionId:'sim-session'});armIdle();return;
   }
   if(msg?.type==='endStream'){ended=true;clearTimeout(idleTimer);finishTurn(receivedMs);out({type:'audioProgress',audioProcessedMs:receivedMs});setTimeout(()=>shut(1000),20).unref?.();return;}
   out({type:'error',message:'unexpected text frame',sessionId:'sim'});shut(1008);
  },
  receiveBinary(buf){
   if(closed)return;
   if(!acked||ended){out({type:'error',message:'audio before handshake or after endStream',sessionId:''});return shut(1008);}
   armIdle();
   const frame=Buffer.from(buf);const dur=Math.round(frame.length/PCM_BYTES_PER_MS);
   if(firstAudioAt===null)firstAudioAt=now();
   receivedMs+=dur;
   if(enforceBacklog&&receivedMs-(now()-firstAudioAt)>5000){out({type:'error',message:'backlog',sessionId:'sim'});return shut(1008);}
   if(failAt&&receivedMs>=failAt.audioMs){if(failAt.errorType)out({type:'error',message:'simulated failure',sessionId:'sim',errorType:failAt.errorType});return shut(failAt.closeCode??1011);}
   out({type:'audioProgress',audioProcessedMs:receivedMs});
   const loud=frameDbfs(frame)>speechDbfs;
   if(loud){speechRun+=dur;silenceRun=0;}else{silenceRun+=dur;speechRun=0;}
   if(!turn&&speechRun>=160){turn={id:++turnSeq,start:receivedMs-speechRun};out({type:'speechStart',turnId:turn.id,audioProcessedMs:receivedMs});lastPartialAt=receivedMs;}
   if(turn&&loud&&receivedMs-lastPartialAt>=480){lastPartialAt=receivedMs;out({type:'transcript',transcript:`[SIM-ASR #${turn.id} …${((receivedMs-turn.start)/1000).toFixed(1)}s]`,final:false,audioProcessedMs:receivedMs});}
   if(turn&&silenceRun>=endSilenceMs)finishTurn(receivedMs-silenceRun);
   else if(turn&&maxTurnMs&&receivedMs-turn.start>=maxTurnMs){finishTurn(receivedMs);speechRun=0;}
  },
  get receivedMs(){return receivedMs;},
 };
}

/** In-process WebSocket double for node tests: same EventTarget surface as the global WebSocket the adapter uses. */
export function createSimulatedWebSocketFactory(options={}){
 const sockets=[];
 const factory=(url)=>{
  const target=new EventTarget();let state=0;
  const fire=(type,props={})=>{const e=new Event(type);Object.assign(e,props);target.dispatchEvent(e);};
  const socket={url,sent:[],bufferedAmount:0,get readyState(){return state;},
   addEventListener:(...a)=>target.addEventListener(...a),removeEventListener:(...a)=>target.removeEventListener(...a),
   send(data){if(state!==1)throw new Error('socket not open');socket.sent.push(typeof data==='string'?data:Buffer.from(data));
    queueMicrotask(()=>typeof data==='string'?session.receiveText(data):session.receiveBinary(data));},
   close(code=1000){if(state>=2)return;state=2;setImmediate(()=>{state=3;fire('close',{code});});},
  };
  const plan=typeof options.plan==='function'?options.plan(sockets.length):options;
  const session=createSimulatedSession({...plan,send:text=>setImmediate(()=>{if(state===1)fire('message',{data:text});}),close:code=>socket.close(code)});
  sockets.push(socket);
  if(plan.refuseConnect){setImmediate(()=>{state=3;fire('close',{code:plan.refuseConnect});});}
  else setImmediate(()=>{state=1;fire('open');});
  return socket;
 };
 factory.sockets=sockets;
 return factory;
}

/** Loopback WebSocket server (uses the `ws` dev dependency) for browser E2E against the same protocol. */
export async function startSimulatorServer({port=0,...options}={}){
 const {WebSocketServer}=await import('ws');
 const wss=new WebSocketServer({host:'127.0.0.1',port,path:'/v1/asr/realtime'});
 await new Promise(r=>wss.once('listening',r));
 wss.on('connection',ws=>{
  const session=createSimulatedSession({...options,send:text=>{if(ws.readyState===1)ws.send(text);},close:code=>{try{ws.close(code);}catch{}}});
  ws.on('message',(data,isBinary)=>isBinary?session.receiveBinary(data):session.receiveText(String(data)));
 });
 return {url:`ws://127.0.0.1:${wss.address().port}/v1/asr/realtime`,close:()=>new Promise(r=>{for(const c of wss.clients)c.terminate();wss.close(()=>r());})};
}
