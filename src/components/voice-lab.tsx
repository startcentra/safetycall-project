'use client';
import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import {scenarios} from '@/modules/evaluation';
import {assessTriage} from '@/modules/risk-triage';
import {selectLiveGuidance} from '@/modules/playbook/select';
import {buildCaseTimeline,getCaseView,createCase} from '@/modules/case';
import {applyVoiceEvent,emptyVoiceState,type VoiceAccumulator,type VoiceEvent} from '@/modules/audio/transcript';
import {pcm16Frames,resampleLinear} from '@/modules/audio/pcm';

type Comparison={analysisMode?:string;analysis?:{riskIndex:number;manipulationIndex:number;evidenceUtteranceIds:string[]};error?:string};
const voices=['NORMAL','TRADITIONAL','EVOLVED','AMBIGUOUS'].flatMap(category=>scenarios.filter(s=>s.category===category && s.turns.some(t=>t.speaker==='caller')).slice(0,3));
export default function VoiceLab(){
 const [scenarioId,setScenarioId]=useState(voices[0]?.scenarioId??'');
 const [revealed,setRevealed]=useState(0);
 const [running,setRunning]=useState(false);
 const [mode,setMode]=useState<'SCRIPTED'|'AUDIO_META'>('SCRIPTED');
 const [audio,setAudio]=useState<File|null>(null);
 const [consent,setConsent]=useState(false);
 const [localAccess,setLocalAccess]=useState('');
 const [sourceRole,setSourceRole]=useState<'UNKNOWN'|'CALLER_ONLY'>('UNKNOWN');
 const [asr,setAsr]=useState<VoiceAccumulator>(emptyVoiceState);
 const [status,setStatus]=useState('OFFLINE · 아무 API도 호출하지 않았습니다.');
 const [budget,setBudget]=useState<Record<string,unknown>|null>(null);
 const [meta,setMeta]=useState<{key:string;value:Comparison}|null>(null);
 const ws=useRef<WebSocket|null>(null);
 const sender=useRef<ReturnType<typeof setInterval>|null>(null);
 const audioElement=useRef<HTMLAudioElement|null>(null);
 const sourceUrl=useRef<string|null>(null);
 const fileActive=useRef(false);
 const scriptedActive=useRef(false);
 const generation=useRef(0);
 const selected=voices.find(s=>s.scenarioId===scenarioId)??voices[0];
 const turns=useMemo(()=>mode==='SCRIPTED' ? selected.turns.slice(0,revealed).map(t=>({speaker:t.speaker,text:t.text,turnId:t.turnId})) : asr.finalized.map(t=>({speaker:(sourceRole==='CALLER_ONLY'?'caller':'unknown') as 'caller'|'unknown',text:t.text,turnId:t.turnId})),[mode,selected,revealed,asr.finalized,sourceRole]);
 const triage=useMemo(()=>assessTriage({turns:turns.map(t=>({speaker:t.speaker,text:t.text}))}),[turns]);
 // UI-only derived state: finalized utterances (including explicit ASR corrections), no model scores.
 const caseState=useMemo(()=>{
   const timeline=buildCaseTimeline('voice_demo',turns);
   return timeline.at(-1)??createCase('voice_demo');
 },[turns]);
 const caseView=getCaseView(caseState);
 const needsRoleReview=mode==='AUDIO_META'&&turns.some(t=>t.speaker==='unknown');
 const guidance=selectLiveGuidance({caseState,jurisdiction:'KR'});
 const metaKey=JSON.stringify(turns);
 const metaBlocked=turns.some(t=>t.text.length>800 || t.speaker==='unknown');
 const visibleMeta:Comparison|null=metaBlocked?{analysisMode:'OFFLINE',error:'화자 불명 또는 800자 초과: Meta 입력을 보내지 않았습니다. 규칙 분석은 별도 적용됩니다.'}:meta?.key===metaKey?meta.value:null;
 useEffect(()=>{const controller=new AbortController();
  const thisGeneration=generation.current;
  if(!turns.length || metaBlocked)return ()=>controller.abort();
  // Meta input contract caps context to 8 turns, 800 characters each. Keep only the latest finalized context.
  fetch('/api/meta/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestedMode:'MOCK',turns:turns.slice(-8)}),signal:controller.signal}).then(x=>x.json().then(body=>({ok:x.ok,body}))).then(({ok,body})=>{if(!controller.signal.aborted&&thisGeneration===generation.current)setMeta({key:metaKey,value:ok?body:{analysisMode:'ERROR',error:body?.error??'모의 분석 실패'}})}).catch(()=>{if(!controller.signal.aborted&&thisGeneration===generation.current)setMeta({key:metaKey,value:{analysisMode:'ERROR',error:'모의 분석 연결 오류'}});});
  return ()=>controller.abort();
 },[turns,metaKey,metaBlocked]);
 function stop(){generation.current++;scriptedActive.current=false;fileActive.current=false;if(sender.current)clearInterval(sender.current);sender.current=null;
  if(ws.current?.readyState===WebSocket.OPEN)try{ws.current.send(JSON.stringify({type:'revoke'}));}catch{}
  ws.current?.close();ws.current=null;audioElement.current?.pause();if(sourceUrl.current){URL.revokeObjectURL(sourceUrl.current);sourceUrl.current=null;}if(typeof window!=='undefined')window.speechSynthesis?.cancel();setRunning(false);}
 useEffect(()=>()=>{if(sender.current)clearInterval(sender.current);ws.current?.close();audioElement.current?.pause();if(sourceUrl.current)URL.revokeObjectURL(sourceUrl.current);window.speechSynthesis?.cancel();},[]);
 function reset(nextId=scenarioId,nextMode=mode){stop();setScenarioId(nextId);setMode(nextMode);setRevealed(0);setAsr(emptyVoiceState());setMeta(null);setStatus('OFFLINE · 다시 시작할 수 있습니다.');}
 function autoScript(){
  stop();setMode('SCRIPTED');setRevealed(0);scriptedActive.current=true;setRunning(true);
  if(!window.speechSynthesis){scriptedActive.current=false;setStatus('브라우저 TTS를 지원하지 않습니다.');setRunning(false);return;}
  const play=(position:number)=>{
    if(!scriptedActive.current)return;
    if(position>=selected.turns.length){scriptedActive.current=false;setRunning(false);setStatus('SCRIPTED MOCK 재생 완료 · 실제 전사 없음');return;}
    const next=selected.turns[position];
    const spoken=new SpeechSynthesisUtterance(next.text);spoken.lang='ko-KR';spoken.rate=.85;spoken.onend=()=>{if(scriptedActive.current)play(position+1)};
    spoken.onerror=()=>{scriptedActive.current=false;setRunning(false);setStatus('TTS 재생 오류 · 한국어 브라우저 음성 지원 확인')};
    setRevealed(position+1);setStatus('SCRIPTED MOCK 음성 재생 중 · API 사용 없음');window.speechSynthesis.speak(spoken);
  };
  play(0);
 }
 function speakNext(){if(!selected||revealed>=selected.turns.length)return;
  const utterance=selected.turns[revealed];setRevealed(revealed+1);setStatus('SCRIPTED MOCK · 브라우저 TTS. 음성 인식 결과가 아닙니다.');
  if(typeof window==='undefined'||!('speechSynthesis' in window))return;
  window.speechSynthesis.cancel();const spoken=new SpeechSynthesisUtterance(utterance.text);spoken.lang='ko-KR';spoken.rate=.85;window.speechSynthesis.speak(spoken);
 }
 async function getBudget(){try{const r=await fetch('/api/budget',{cache:'no-store'});setBudget(await r.json());}catch{setStatus('예산 장부 상태를 확인할 수 없습니다.');}}
 async function startRealAudio(){
  if(!audio||!consent)return setStatus('음성 파일과 외부 전송 동의가 필요합니다.');
  if(!audio.name.toLowerCase().endsWith('.wav')||audio.size>20_000_000)return setStatus('20MB 이하의 WAV만 허용됩니다.');
  stop();const currentGeneration=generation.current;setAsr(emptyVoiceState());setMode('AUDIO_META');setMeta(null);setRunning(true);setStatus('로컬 게이트웨이 연결 시도 · LIVE 비활성 시 차단됩니다.');
  try{
   const context=new AudioContext();let buffer:AudioBuffer;
   try {const raw=await audio.arrayBuffer();buffer=await context.decodeAudioData(raw.slice(0));}
   finally {await context.close();}
   if(currentGeneration!==generation.current)return;
   if(buffer.duration>600||buffer.duration<.1)throw new Error('길이는 0.1초~10분이어야 합니다.');
   const mono=new Float32Array(buffer.length);for(let channel=0;channel<buffer.numberOfChannels;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<mono.length;i++)mono[i]+=data[i]/buffer.numberOfChannels;}
   const frames=pcm16Frames(resampleLinear(mono,buffer.sampleRate));
   const auth=await fetch('/api/voice/session',{method:'POST',headers:{'Content-Type':'application/json','x-safecall-local-key':localAccess},body:'{}',cache:'no-store'});
   setLocalAccess('');
   if(!auth.ok)throw new Error('LIVE 로컬 인증/비용 승인 실패. 서버 설정과 접근 코드를 확인하세요.');
   const credentials:unknown=await auth.json();
   if(!credentials||typeof credentials!=='object'||typeof (credentials as {ticket?:unknown}).ticket!=='string')throw new Error('세션 승인 데이터 오류');
   const ticket=(credentials as {ticket:string}).ticket;
   if(currentGeneration!==generation.current||!consent)return;
   const socket=new WebSocket('ws://127.0.0.1:3001');ws.current=socket;let index=0;let priorPlaybackSeconds=0;
   socket.addEventListener('open',()=>{if(currentGeneration!==generation.current)return socket.close();socket.send(JSON.stringify({type:'start',ticket,consented:true,durationSeconds:buffer.duration}));});
   socket.addEventListener('message',async event=>{
    if(currentGeneration!==generation.current)return;
    let message: {type?:string;event?:VoiceEvent;message?:string};try{message=JSON.parse(event.data);}catch{setStatus('게이트웨이 응답 형식 오류');return;}
    if(message.type==='bridgeReady'){
      if(!audioElement.current)return;
      sourceUrl.current=URL.createObjectURL(audio);audioElement.current.src=sourceUrl.current;
      try {await audioElement.current.play();}
      catch {setStatus('오디오 재생이 차단되었습니다. 전사를 시작하지 않습니다.');socket.close();return;}
      if(currentGeneration!==generation.current){socket.close();return;}
      fileActive.current=true;setStatus('LIVE 전사 진행 · Meta 서버 이벤트 대기');
      sender.current=setInterval(()=>{
       if(socket.readyState!==WebSocket.OPEN||!fileActive.current)return;
       const player=audioElement.current;
       if(!player||player.seeking)return;
       if(player.ended){
         // Playback completed: only a final (<80ms) PCM remainder can remain.
         while(index<frames.length){if(socket.bufferedAmount>192000){setStatus('종료 시 송신 버퍼 초과');stop();return;}socket.send(frames[index++]);}
         fileActive.current=false;if(sender.current)clearInterval(sender.current);sender.current=null;
         socket.send(JSON.stringify({type:'end'}));return;
       }
       if(player.paused)return;
       if(player.currentTime+0.1<priorPlaybackSeconds||player.currentTime>priorPlaybackSeconds+2){
         setStatus('재생/전송 시간 불일치: LIVE 세션을 안전하게 중단했습니다.');stop();return;
       }
       priorPlaybackSeconds=player.currentTime;
       if(socket.bufferedAmount>192000){setStatus('브라우저 송신 버퍼 포화: LIVE 세션 중단');stop();return;}
       if(index<frames.length && index*0.08<=player.currentTime+0.08){socket.send(frames[index++]);}

       else {fileActive.current=false;if(sender.current)clearInterval(sender.current);socket.send(JSON.stringify({type:'end'}));}
      },80);
    }
    if(message.type==='metaEvent'&&message.event) setAsr(s=>applyVoiceEvent(s,message.event!));
    if(message.type==='bridgeError'){stop();setStatus('ERROR · '+(message.message??'게이트웨이 오류'));}
    if(message.type==='bridgeClosed'){stop();setStatus('전사 스트림 종료 · LIVE 기록을 확인하세요.');}
   });
   socket.addEventListener('close',()=>{if(currentGeneration!==generation.current)return;stop();setStatus('전사 연결이 종료됐습니다. 추가 오디오 송신을 중단했습니다.');});
   socket.addEventListener('error',()=>{if(currentGeneration===generation.current)setStatus('게이트웨이 연결 실패 · npm run dev:voice 실행 및 사용 승인 상태 확인');});
  }catch(e){if(currentGeneration===generation.current){setRunning(false);setStatus(e instanceof Error?e.message:'오디오 형식 오류');}}
 }
 return <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 text-[#eff7ff]">
 <nav className="flex gap-4 text-sm text-[#85e6d4]"><Link href="/">← 대시보드</Link><Link href="/lab/replay">텍스트 평가실</Link><Link href="/simulator">가상 은행</Link></nav>
 <header className="space-y-2"><p className="text-xs font-bold tracking-widest text-[#71e6d2]">SAFE CALL GUARDIAN v0.6.5 · VOICE TO ACTION</p><h1 className="text-3xl font-bold">가상 통화 음성 실험실</h1><p className="text-sm leading-7 text-[#b7c8de]">SCRIPTED MOCK은 브라우저가 대본을 읽으며 동일한 텍스트를 분석하는 시뮬레이션입니다. 실제 음성 전사는 Meta LIVE 모드에서만 수행하며, 현재 기본값은 비용 보호를 위해 OFFLINE입니다. 통신사 일반 통화를 감청하지 않습니다.</p></header>
 <section className="grid gap-5 lg:grid-cols-2">
  <article className="space-y-3 rounded-2xl border border-[#3d5268] bg-[#14273c] p-5"><h2 className="text-lg font-bold">① 무료 가상 음성 재생 · MOCK</h2><label className="block text-sm">시나리오<select value={scenarioId} className="mt-2 w-full rounded-lg bg-[#0c1a2a] p-3" onChange={e=>reset(e.target.value,'SCRIPTED')}>{voices.map(s=><option key={s.scenarioId} value={s.scenarioId}>{s.title}</option>)}</select></label><button className="rounded-lg bg-[#76dcc8] px-4 py-2 font-bold text-[#112333]" onClick={autoScript}>전체 가상 통화 자동 재생</button><button className="ml-2 rounded-lg border px-3 py-2 text-sm" onClick={speakNext} disabled={mode!=='SCRIPTED'||running||revealed>=selected.turns.length}>다음 발화</button><button className="ml-2 rounded-lg border px-4 py-2" onClick={()=>reset()}>초기화·중지</button><p className="text-xs text-[#b1c6d9]">한국어 TTS 제공 여부는 브라우저/운영체제에 따라 달라집니다. 대본을 음성으로 출력하더라도 실제 ASR 시험은 아닙니다.</p></article>
  <article className="space-y-3 rounded-2xl border border-[#3d5268] bg-[#14273c] p-5"><h2 className="text-lg font-bold">② 자체 제작 WAV → Meta LIVE (별도 승인 필요)</h2><label className="block text-sm">본인이 권한을 가진 짧은 WAV 파일<input type="file" accept=".wav,audio/wav" className="mt-2 block w-full text-xs" onChange={e=>setAudio(e.target.files?.[0]??null)}/></label><label className="flex gap-2 text-xs"><input type="checkbox" checked={consent} onChange={e=>{if(!e.target.checked){stop();setStatus('동의 철회: 추가 전송 중단. 이미 전송된 데이터는 회수 불가.');}setConsent(e.target.checked)}}/> Meta 외부 API로 오디오를 전송하는 데 동의하며, 포함된 음성 사용 권한이 있습니다.</label><label className="block text-xs">LIVE 접근 코드 (서버에 설정한 SAFECALL_LOCAL_ACCESS_TOKEN)<input type="password" autoComplete="off" value={localAccess} onChange={e=>setLocalAccess(e.target.value)} className="mt-2 w-full rounded-lg bg-[#0c1a2a] p-2"/></label>
 <label className="block text-xs">테스트 WAV 화자 출처<select value={sourceRole} disabled={running} onChange={e=>setSourceRole(e.target.value as 'UNKNOWN'|'CALLER_ONLY')} className="mt-2 w-full rounded-lg bg-[#0c1a2a] p-2"><option value="UNKNOWN">불명 · 위험 판단 보류</option><option value="CALLER_ONLY">내가 제작한 상대방 단일 발화 WAV (명시적 매핑)</option></select></label>
 <p className="text-xs text-[#b1c6d9]">전사 화자 ID만으로 상대방 신원은 확인할 수 없습니다. 역할 미확인 음성은 자동으로 상대방이라 판정하지 않습니다.</p><button className="rounded-lg border border-[#74d8c7] px-4 py-2 text-sm" disabled={running||!consent||!audio||localAccess.length<24} onClick={startRealAudio}>LIVE 전사 시도</button><button className="ml-2 rounded-lg border px-4 py-2 text-sm" onClick={stop}>종료</button><audio ref={audioElement} controls={false}
 onPause={()=>{if(fileActive.current&&!audioElement.current?.ended){stop();setStatus('재생 일시정지: LIVE 스트림 중단. 다시 시작하세요.')}}}
 onSeeking={()=>{stop();setStatus('재생 위치 이동은 LIVE에서 지원하지 않아 중단했습니다.')}} className="mt-3 w-full"/><p className="text-xs text-[#f9cc8c]">LIVE 사용 승인이 없으면 게이트웨이가 요청을 거부합니다. 업로드 WAV에서 결과를 미리 생성하거나 가짜 전사를 표시하지 않습니다.</p></article>
 </section>
 <section className="rounded-2xl border border-[#3b536c] bg-[#14273c] p-5"><h2 className="mb-3 font-bold">③ 전사 상태 및 단일 위험 엔진</h2><p aria-live="polite" className="mb-3 text-sm text-[#a8decd]">{status}</p>{mode==='AUDIO_META'&&asr.partial&&<p className="rounded-lg border border-dashed p-2 text-xs">PARTIAL · {asr.partial} (수정 가능)</p>}<ul className="space-y-2">{turns.map((t,i)=><li key={t.turnId} className="rounded-lg bg-[#0b1a2a] p-3 text-sm">#{i+1} {t.speaker==='caller'?'상대방':t.speaker==='user'?'사용자':'화자 불명'} · {t.text}</li>)}</ul><div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#0c1a2a] p-3"><p className="text-xs">행동 위험 지수</p><p className="text-3xl font-bold">{needsRoleReview?'미평가':triage.riskIndex}<span className="text-sm">/100</span></p></div><div className="rounded-xl bg-[#0c1a2a] p-3"><p className="text-xs">심리 압박 지수</p><p className="text-3xl font-bold">{needsRoleReview?'미평가':triage.psychologicalPressureIndex}<span className="text-sm">/100</span></p></div></div><div className="mt-3 rounded-xl border border-[#456584] bg-[#0c1a2a] p-3"><p className="text-sm font-semibold text-[#82dfd2]">사건별 기억 · 현재 발화 신호 (v0.6.5)</p><p className="mt-1 text-xs text-[#b6c7d9]">과거 위험 {caseView.assessment.riskIndex}/100 · 현재 긴박도 {caseView.live.urgency}/100 · 현재 강압 {caseView.live.coercivePressure}/100 · 피해 행동 임박도 {caseView.live.actionProximity}/100</p><p className="mt-1 text-xs text-[#a8bacd]">누적 위험 증거 {caseView.activeEvidenceCount}건 · 오프라인 규칙 지수, 실제 스트레스 측정이나 범죄 확률 아님</p></div><p className="mt-3 text-xs">{needsRoleReview?'화자 불명 · 안전 판정 유보':triage.riskBand} · Meta 정밀분석 후보: {triage.shouldCallMeta?'예':'아니오'} · 실제 범죄 확률이 아닙니다.</p><div className="mt-3 rounded-xl border border-[#4b806e] p-3"><p className="text-xs text-[#8be1c9]">SafeCall Live Guidance · 공식 자료 참고 (MOCK, 발신 없음)</p><p className="mt-2 text-sm">{needsRoleReview?'화자를 확인할 수 없어 상대방의 행동을 확정할 수 없습니다. 민감한 금융 행동은 보류하고 독립적으로 확인하세요.':guidance.primary.userAction}</p><p className="mt-2 text-xs text-[#a8bacd]">{guidance.primary.id} · 근거: {guidance.primary.evidenceUtteranceIds.join(', ')||'미확인'} · NO_SCRIPT (음성 실험실에서는 대화 유지 유도 안 함)</p></div><p className="mt-3 text-xs text-[#aac0d4]">Meta MOCK: {visibleMeta?.analysisMode??'OFFLINE'} {visibleMeta?.error??''} · {visibleMeta?.analysis?.riskIndex??'-'}/100 (기존 규칙을 변환한 모의 분석, 실측 Meta AI 결과 아님)</p></section>
 <section className="rounded-2xl border border-[#3b536c] bg-[#14273c] p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">④ $150 크레딧 예산 모니터</h2><button className="rounded-lg border px-3 py-2 text-sm" onClick={getBudget}>로컬 비용 장부 새로고침</button></div><p className="mt-2 text-xs text-[#b2c6d8]">크레딧 $150는 참조액입니다. 앱 자동 사용 상한 $110, 초기 승인 범위 최대 $5, 예비비 $40. Meta 공식 청구 내역과 별개입니다.</p>{budget&&<pre className="mt-3 overflow-auto rounded-lg bg-[#0c1a2a] p-3 text-xs">{JSON.stringify(budget,null,2)}</pre>}</section>
 </main>;
}
