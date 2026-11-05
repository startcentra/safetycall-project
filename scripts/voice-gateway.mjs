/** Local-only WebSocket bridge; requires explicit META_SPEND_APPROVED=true and user consent. */
import { WebSocketServer } from 'ws';
import {createHash} from 'node:crypto';
import { serverCostGuard, estimateVoiceUsd } from '../src/modules/cost/guard.ts';
import { verifyLiveTicket } from '../src/modules/security/live-auth.ts';

const PORT=Number(process.env.SAFECALL_VOICE_PORT??'3001');
if (!Number.isInteger(PORT)||PORT<1||PORT>65535) throw new Error('Invalid local port');
const server=new WebSocketServer({host:'127.0.0.1',port:PORT,maxPayload:8192,verifyClient:({origin})=> origin==='http://localhost:3000'||origin==='http://127.0.0.1:3000'});
const ASR='wss://api.meta.ai/v1/asr/realtime';
const usedTicketNonces=new Map(); // single-process anti-replay until ticket expiry
const enabled=()=>process.env.META_LIVE_ENABLED==='true'&&process.env.META_VOICE_LIVE_ENABLED==='true'&&process.env.META_SPEND_APPROVED==='true'&&process.env.META_BUDGET_KILL_SWITCH!=='true';
server.on('connection',browser=>{
 let upstream=null, budgetId=null, experimentId=null, billedSeconds=0, sessionFrames=0, durationLimit=0, startMs=0, ended=false, closeDone=false, ready=false;
 let watchdog=null;let finishConfirmed=false;let failed=false;
 const armTimeout=(ms,reason)=>{if(watchdog)clearTimeout(watchdog);watchdog=setTimeout(()=>fail(reason),ms);watchdog.unref?.();};
 const send=(data)=>{if(browser.readyState===1)browser.send(JSON.stringify(data));};
 const complete=()=>{if(closeDone)return;closeDone=true;if(watchdog)clearTimeout(watchdog);if(budgetId){try{serverCostGuard().settle(budgetId,finishConfirmed&&billedSeconds>0?estimateVoiceUsd(billedSeconds):undefined)}catch{send({type:'bridgeError',message:'예산 정산 실패: 추가 LIVE 실행을 중단하고 장부 확인 필요'});}}if(experimentId){try{serverCostGuard().closeExperiment(experimentId);}catch{send({type:'bridgeError',message:'실험 종료 장부 오류: 운영자 점검 필요'});}}};
 const fail=message=>{if(closeDone)return;failed=true;send({type:'bridgeError',message});if(upstream && upstream.readyState<=1)upstream.close();browser.close(1008,'SafeCall session ended');complete();};
 armTimeout(15000,'가상 통화 연결 시작시간 초과');
 browser.on('message',(payload,isBinary)=>{
  try {
    if (isBinary) {
      if(!ready||ended||!enabled()) return fail('LIVE 비활성 또는 스트림 상태 오류');
      const bytes=payload.byteLength;
      if(bytes===0||bytes>3840||bytes%2) return fail('PCM 24kHz 16-bit 80ms 프레임만 허용');
      sessionFrames+=bytes;const streamedSeconds=sessionFrames/48000;
      if(streamedSeconds>durationLimit+.09 || streamedSeconds>(Date.now()-startMs)/1000+1.0) return fail('재생시간/최대 길이 제한 위반');
      if(upstream?.readyState!==1)return fail('Meta 전사 연결이 준비되지 않음');
      if(upstream.bufferedAmount>192000)return fail('실시간 Meta 송신 버퍼 초과: 누락 구간을 안전하게 중단합니다.');
      upstream.send(payload);return;
    }
    const msg=JSON.parse(payload.toString());
    if(msg?.type==='revoke')return fail('동의 철회: 음성 전송을 종료했습니다. 이미 전송된 내용은 소급 회수할 수 없습니다.');
    if(msg.type==='start'&&!upstream) {
      if(!enabled())return fail('API 크레딧 사용 승인 전: LIVE 요청 차단');
      let ticket;
      try{ticket=verifyLiveTicket(msg.ticket,'VOICE',process.env.SAFECALL_SESSION_SIGNING_KEY);}catch{return fail('유효한 단기 LIVE 세션 승인이 필요합니다.');}
      for(const [nonce,exp] of usedTicketNonces)if(exp<Date.now())usedTicketNonces.delete(nonce);
      if(usedTicketNonces.has(ticket.nonce))return fail('이미 사용된 LIVE 세션 승인권');
      usedTicketNonces.set(ticket.nonce,ticket.exp);
      experimentId='voice_'+ticket.sid.replaceAll('-','');
      if(msg.consented!==true)return fail('음성 Meta 전송에 대한 동의 필요');
      durationLimit=Number(msg.durationSeconds);
      const maxDuration=Math.min(600,Number(process.env.META_MAX_VOICE_SECONDS_PER_SESSION??600));
      if(!Number.isFinite(maxDuration)||maxDuration<.1||!Number.isFinite(durationLimit)||durationLimit<.1||durationLimit>maxDuration)return fail('오디오 최대 10분 제한 또는 설정 오류');
      if(!process.env.MODEL_API_KEY)return fail('Meta 키 미설정');
      const id=ticket.sid;
      try{budgetId=serverCostGuard().reserveExperiment('VOICE',estimateVoiceUsd(Math.ceil(durationLimit)),experimentId,createHash('sha256').update(ticket.nonce).digest('hex'));}catch{return fail('예산 장부 또는 유료 승인 한도 차단');}
      armTimeout(15000,'Meta 전사 연결 대기시간 초과');
      upstream=new WebSocket(`${ASR}?sessionId=${id}`);
      upstream.onopen=()=>{if(closeDone)return;try{upstream.send(JSON.stringify({authorization:{accessToken:`Bearer ${process.env.MODEL_API_KEY}`},audioEncoding:'PCM_24KHZ',model:'muse-voice-transcribe-1.0',mode:'ENDPOINTING'}));armTimeout(15000,'Meta 전사 핸드셰이크 시간 초과');}catch{fail('Meta 인증 프레임 전송 오류');}};
      upstream.onmessage=ev=>{
        if(closeDone)return;
        try {if(String(ev.data).length>250000)return fail('Meta 전사 이벤트가 허용 크기를 초과했습니다.');const event=JSON.parse(String(ev.data));
          if(!event||typeof event!=='object')return fail('Meta 이벤트 타입 오류');
          if(event.type==='error')return fail('Meta 음성 전사가 오류를 반환했습니다. 인증·입력·한도를 확인하세요.');
          if(event.audioProcessedMs!==undefined){
            if(!Number.isSafeInteger(event.audioProcessedMs)||event.audioProcessedMs<0||event.audioProcessedMs>durationLimit*1000+5000)return fail('Meta 음성 진행시간 오류');
            billedSeconds=Math.max(billedSeconds,event.audioProcessedMs/1000);
          }
          if(!event.type&&typeof event.sessionId==='string') {if(ready)return fail('중복 Meta 핸드셰이크');ready=true;startMs=Date.now();armTimeout(Math.ceil(durationLimit*1000)+15000,'음성 업로드 세션 시간 초과');send({type:'bridgeReady',sessionId:id});}
          else if(typeof event.type==='string') {
        const permitted=['speechStart','transcript','speechComplete','speechEnd'];
        if(permitted.includes(event.type))send({type:'metaEvent',event:{type:event.type,turnId:event.turnId,transcript:event.transcript,audioProcessedMs:event.audioProcessedMs,label:event.label}});
      }
        }catch{fail('Meta 이벤트 구문 오류');}
      };
      upstream.onerror=()=>fail('Meta 실시간 전사 연결 오류');
      upstream.onclose=(event)=>{if(closeDone)return;if(event.code!==1000)send({type:'bridgeError',message:'Meta 연결이 비정상 종료됐습니다. 완료되지 않은 발화는 처리하지 않습니다.'});
       finishConfirmed=ended&&!failed&&event.code===1000;
       send({type:'bridgeClosed',code:event.code});complete();if(browser.readyState===1)browser.close();};
      return;
    }
    if(msg.type==='end'&&upstream&&!ended&&ready){ended=true;armTimeout(20000,'Meta 전사 종료 응답시간 초과');if(upstream.readyState===1)upstream.send(JSON.stringify({type:'endStream'}));return;}
    fail('지원하지 않는 로컬 프로토콜 명령');
  }catch{fail('전사 요청 처리 오류');}
 });
 browser.on('close',()=>{if(upstream&&upstream.readyState<=1)upstream.close();complete();});
});
console.log(`SafeCall Voice Gateway listening locally on 127.0.0.1:${PORT}; live spending is OFF unless separately approved.`);
