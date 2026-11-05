"use client";

import { useEffect, useRef, useState } from "react";
import { selectLiveGuidance } from "@/modules/playbook/select";
import { buildCaseTimeline } from "@/modules/case";
import { buildReplayMetaInput } from "@/modules/analysis/replay-input";
import type { MetaAnalysisResponse } from "@/modules/analysis/meta-contract";
import type { TriageResult } from "@/modules/risk-triage";
import type { ReplayScenario } from "@/modules/evaluation";

interface ApiResponse extends MetaAnalysisResponse { error?: string; usedCalls?: number; maxCalls?: number; }
interface Status { mode: "OFFLINE" | "READY_FOR_EXPLICIT_LIVE"; liveEnabled: boolean; apiKeyConfigured: boolean; maxCallsPerProcess: number; model: string; }
const USD_PER_MILLION_INPUT = 1.25;
const USD_PER_MILLION_OUTPUT = 4.25;
function costUpperEstimate(response: MetaAnalysisResponse) {
  const {inputTokens,outputTokens} = response.usage;
  if (inputTokens === null || outputTokens === null) return "토큰 정보 없음";
  const usd = (inputTokens * USD_PER_MILLION_INPUT + outputTokens * USD_PER_MILLION_OUTPUT) / 1_000_000;
  return `최대 추정 $${usd.toFixed(5)} (캐시 할인 제외)`;
}
export default function MetaComparisonPanel(props:{scenario:ReplayScenario;step:number;triage:TriageResult}) {
  return <ScopedMetaComparisonPanel key={`${props.scenario.scenarioId}:${props.step}`} {...props}/>;
}
function ScopedMetaComparisonPanel({scenario,step,triage}:{scenario:ReplayScenario;step:number;triage:TriageResult}) {
  const [status,setStatus] = useState<Status | null>(null);
  const [result,setResult] = useState<ApiResponse | null>(null);
  const [mode,setMode] = useState<"OFFLINE" | "MOCK" | "LIVE" | "ERROR">("OFFLINE");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [confirmLive,setConfirmLive] = useState(false);
  const [attempts,setAttempts] = useState(0);
  const [localAccess,setLocalAccess] = useState("");
  const [experimentInfo,setExperimentInfo] = useState("실험 없음 · LIVE 기본 차단");
  const ticketRef=useRef<string|null>(null);
  const controllerRef=useRef<AbortController|null>(null);

  // No credentials are stored in browser persistent storage.
  const version = useRef(0);
  useEffect(()=>{
    fetch("/api/meta/status",{cache:"no-store"}).then(r=>r.json()).then(x=>setStatus(x as Status)).catch(()=>setStatus(null));
  },[]);
  async function requestCloseLiveExperiment(ticket:string,access:string){
    try{const response=await fetch('/api/meta/experiment',{method:'POST',headers:{'Content-Type':'application/json','x-safecall-local-key':access,'x-safecall-spark-ticket':ticket},body:'{}',cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('종료 API 실패');return true;}
    catch {return false;}
  }
  const localAccessRef=useRef(localAccess);
  useEffect(()=>{localAccessRef.current=localAccess;},[localAccess]);
  useEffect(()=>()=>{
    version.current++;
    controllerRef.current?.abort();
    const ticket=ticketRef.current;
    ticketRef.current=null;
    if(ticket && localAccessRef.current)void requestCloseLiveExperiment(ticket,localAccessRef.current);
  },[]);
  async function closeLiveExperiment(ticket:string,access:string){
    const closed=await requestCloseLiveExperiment(ticket,access);
    if(!closed)setExperimentInfo('종료 확인 실패 · 만료까지 신규 LIVE 실험 차단될 수 있음. 장부 확인 필요');
    return closed;
  }

  function stopLive(){
    controllerRef.current?.abort();
    const ticket=ticketRef.current;
    if(ticket){void closeLiveExperiment(ticket,localAccess);ticketRef.current=null;}
    setExperimentInfo('사용자 종료 요청 · 이미 전송한 API 과금 여부는 불명');
  }
  async function run(requestedMode:"MOCK"|"LIVE") {
    if(busy||controllerRef.current) return;
    if(requestedMode === "LIVE" && (!triage.shouldCallMeta || !status?.liveEnabled || !status.apiKeyConfigured || !confirmLive || localAccess.length<24)) return;
    const requestId = ++version.current;
    const controller=new AbortController();controllerRef.current=controller;
    const requestTimeout=setTimeout(()=>controller.abort(),20000);
    const access=localAccess;
    let ticket:string|null=null;
    setBusy(true);setError(null);setResult(null);
    try {
      if(requestedMode==='LIVE'){
        const issue=await fetch('/api/meta/session',{method:'POST',headers:{'Content-Type':'application/json','x-safecall-local-key':access},body:'{}',cache:'no-store',signal:controller.signal});
        const issued=await issue.json();
        if(!issue.ok)throw new Error(issued.error??`세션 발급 실패 (${issue.status})`);
        if(typeof issued.ticket!=='string')throw new Error('서버 티켓 형식 오류');
        ticket=issued.ticket;ticketRef.current=ticket;
        setExperimentInfo(`실험 시작 · 호출 상한 ${issued.experiment?.maxCalls??1}회 · 로컬 노출 상한 $${issued.experiment?.capUsd??0.05} · 유효 120초`);
      }
      const payload = buildReplayMetaInput(scenario,step);
      const response = await fetch('/api/meta/analyze',{
        method:'POST',headers:{'Content-Type':'application/json',...(requestedMode==='LIVE'?{
          'x-safecall-live-confirm':'yes','x-safecall-local-key':access,'x-safecall-spark-ticket':ticket!}:{})},
        body:JSON.stringify({...payload,requestedMode,...(requestedMode==='LIVE'?{allowLive:true}:{})}),
        cache:'no-store',signal:controller.signal,
      });
      const data:ApiResponse = await response.json();
      if(requestId!==version.current||controller.signal.aborted) return;
      if(!response.ok){setError(data.error??`HTTP ${response.status}`);setMode('ERROR');return;}
      setResult(data);setMode(data.analysisMode);setAttempts(v=>v+Number(data.analysisMode==='LIVE'));
      setConfirmLive(false);
    } catch (err) {
      if(requestId===version.current){setError(controller.signal.aborted?'요청이 취소되었습니다. 이미 처리된 비용은 별도 확인 필요':err instanceof Error?err.message:'연결 오류: 규칙 기반 코칭을 유지합니다.');setMode('ERROR');}
    } finally {
      clearTimeout(requestTimeout);
      // One explicit LIVE action = one experiment. Close even on error/timeout.
      if(ticket){const closing=closeLiveExperiment(ticket,access);const closed=await closing;
        if(ticketRef.current===ticket)ticketRef.current=null;
        if(requestId===version.current&&closed)setExperimentInfo('서버 실험 종료 확인 · Meta 청구액은 별도 확인 필요');}
      if(controllerRef.current===controller)controllerRef.current=null;
      if(requestId===version.current)setBusy(false);
    }
  }
  const ai=result?.analysis;
  const modelCase=buildCaseTimeline(`meta_${scenario.scenarioId}`,scenario.turns.slice(0,step).map(t=>({turnId:t.turnId,speaker:t.speaker,text:t.text}))).at(-1);
  const groundedGuidance=modelCase?selectLiveGuidance({caseState:modelCase,jurisdiction:'KR',model:ai??null,modelStateVersion:modelCase.version}):null;
  return <section className="rounded-2xl border border-[#34506a] bg-[#142438] p-5 space-y-4" aria-live="polite">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-xl font-bold">v0.5 · Meta 분석 비교 (B)</h2>
      <p className="mt-1 text-xs text-[#b8cee0]">A: 기존 단일 규칙 분석은 그대로 유지 · B: 모델 결과를 별도로 표시하고 검증된 코칭 코드만 사용</p></div>
      <span className="rounded-full border border-[#507087] px-3 py-1 text-xs font-bold">{busy?"요청 중":mode}</span>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-[#3e5972] bg-[#0d1b2d] p-4 text-sm space-y-2">
        <h3 className="font-bold text-[#88e4d1]">A · 기존 assessTriage()</h3>
        <p>위험 {triage.riskBand} · 지수 {triage.riskIndex}/100</p>
        <p>심리적 압박 {triage.psychologicalPressureIndex}/100</p>
        <p>Meta 호출 후보: <strong>{triage.shouldCallMeta?"예":"아니오"}</strong></p>
        <p className="text-xs text-[#b3c8d8]">기존 로컬 규칙의 실험 점수. 사기 확률이 아닙니다.</p>
      </div>
      <div className="rounded-xl border border-[#3e5972] bg-[#0d1b2d] p-4 text-sm space-y-2">
        <h3 className="font-bold text-[#c6d8ff]">B · Meta AI 공급자</h3>
        {ai ? <>
          <p>모드 <strong>{result?.analysisMode}</strong> · 위험 {ai.riskLevel} ({ai.riskIndex}/100)</p>
          <p>심리적 압박 {ai.manipulationIndex}/100</p>
          <p>심리적 조작 단서: {ai.manipulationTechniques.join(", ")||"없음"}</p>
          <p>근거 발화: {ai.evidenceUtteranceIds.join(", ")||"없음"}</p>
          <p className="text-xs text-[#b3c8d8]">불확실성: {ai.uncertainty}</p>
        </> : <p className="text-[#b5c6d5]">분석 결과 없음. 버튼을 눌러 MOCK을 시험하거나 LIVE를 명시적으로 승인하세요.</p>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button disabled={busy} className="rounded-lg border border-[#5a8196] px-4 py-2" onClick={()=>run("MOCK")}>모의 응답 테스트 (무료)</button>
      <label className="text-xs text-[#b5cada]">LIVE 로컬 접근 코드 (브라우저에 저장하지 않음)
        <input type="password" autoComplete="off" value={localAccess} onChange={e=>setLocalAccess(e.target.value)} className="ml-2 rounded-lg border border-[#5a8196] bg-[#0d1b2d] p-2" placeholder="SAFECALL_LOCAL_ACCESS_TOKEN" />
      </label>
      <label className="inline-flex items-center gap-2 text-xs text-[#b5cada]">
        <input type="checkbox" checked={confirmLive} disabled={!status?.liveEnabled || !status.apiKeyConfigured || !triage.shouldCallMeta || busy} onChange={e=>setConfirmLive(e.target.checked)}/>
        현재 발화의 실제 유료 호출에 동의
      </label>
      <button disabled={busy || !confirmLive || localAccess.length<24 || !status?.liveEnabled || !status.apiKeyConfigured || !triage.shouldCallMeta} className="rounded-lg bg-[#f1bf79] px-4 py-2 text-xs font-bold text-[#1b2732]" onClick={()=>run("LIVE")}>실제 Meta 1회 분석</button>
      <button className="rounded-lg border border-red-400 px-4 py-2 text-xs" disabled={!busy} onClick={stopLive}>실험 중지</button>
    </div>
    <p className="text-xs text-[#f9cd91]">{experimentInfo} · 클라이언트 종료는 외부 과금 취소를 보증하지 않습니다.</p>
    <p className="text-xs text-[#b5c7d8]">서버 LIVE: {status?.liveEnabled&&status.apiKeyConfigured?"명시 실행 대기":"비활성 (기본값)"} · 모델 {status?.model??"확인 중"} · 세션에서 확인된 LIVE 요청 {attempts}회 · 서버 프로세스 최대 {status?.maxCallsPerProcess??5}회</p>
    {error && <p className="rounded-xl border border-[#a64a48] bg-[#3b2229] p-3 text-sm">{error} — 기존 로컬 코칭을 유지합니다.</p>}
    {result && <div className="space-y-2 rounded-xl border border-[#477087] bg-[#1a2c40] p-4 text-sm">
      <h3 className="font-bold">검증된 행동 코칭</h3>
      <p>{groundedGuidance?.primary.userAction??"확정된 발화가 없어 코칭을 생성하지 않았습니다."}</p><p className="text-xs text-[#b0c7d9]">정책 선택: {groundedGuidance?.primary.id??"없음"} · Meta 추천은 확인된 근거 범위 안에서만 참고 · 자동 실행 없음</p>
      <p className="text-xs text-[#b0c7d9]">분석 모드: {result.analysisMode} · 모델: {result.model} · 응답: {result.elapsedMs}ms · 입력/출력 토큰: {result.usage.inputTokens??"?"}/{result.usage.outputTokens??"?"} · {result.analysisMode==="LIVE"?costUpperEstimate(result):"MOCK: 청구 없음"}</p>
      <p className="text-xs text-[#b0c7d9]">{result.disclaimer}</p>
    </div>}
    <p className="text-xs leading-6 text-[#b0c7d9]">실제 Meta 호출은 자동 수행하지 않습니다. 데이터를 보낼 때 해당 발화까지의 텍스트만 전송하며 미래 발화, 정답 레이블 및 출처 메타데이터는 전송하지 않습니다. C(전 발화 Meta 평가)는 승인 전 비활성입니다.</p>
  </section>;
}
