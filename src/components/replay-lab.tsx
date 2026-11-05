"use client";

import Link from "next/link";
import MetaComparisonPanel from "@/components/meta-comparison";
import { useMemo, useState } from "react";
import { selectLiveGuidance } from "@/modules/playbook/select";
import { sourceById } from "@/modules/playbook/sources";
import { buildCaseTimeline, getCaseView } from "@/modules/case";
import { assessTriage, SIGNAL_LABELS, type TriageResult } from "@/modules/risk-triage";
import {
  evaluateDataset, replayScenario, researchSources, scenarios,
  type ReplayScenario, type ScenarioCategory,
} from "@/modules/evaluation";

const CATEGORY_LABEL: Record<ScenarioCategory, string> = {
  NORMAL: "정상 통화", TRADITIONAL: "전형적 사기", EVOLVED: "변형·신종", AMBIGUOUS: "판단 유보",
};
function pct(value: number | null) { return value === null ? "해당 없음" : `${(value * 100).toFixed(1)}%`; }
function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function csvCell(s: unknown) {
  const value = String(s ?? "");
  // Spreadsheet formula injection hardening for later export/opening.
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
function exportCsv(rows: ReturnType<typeof evaluateDataset>["cases"]) {
  const fields = ["id","title","category","label","baselineWarning","warning","metaCallCandidate","firstTriggerTurn","firstWarningTurn","criticalTurn","warnedBeforeCriticalTurn","warnedByCriticalTurn","lastRiskIndex","lastPressureIndex"] as const;
  const csv = [fields.join(","),...rows.map(r=>fields.map(f=>csvCell(r[f])).join(","))].join("\r\n");
  downloadText("safecall-v04-evaluation.csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
}
function RiskHistory({ history }: { history: ReturnType<typeof replayScenario> }) {
  const w=680,h=168,p=28;
  const x=(i:number)=>p + (history.length===1?0:(w-p*2)*i/(history.length-1));
  const y=(v:number)=>h-p-(v/100)*(h-p*2);
  const lines = [
    { color: "#74e3d3", title: "금융·행동 위험", values: history.map(s=>s.assessment.riskIndex) },
    { color: "#ffbf7d", title: "심리적 압박", values: history.map(s=>s.assessment.psychologicalPressureIndex) },
  ];
  return <div>
    <div className="mb-2 flex flex-wrap gap-4 text-xs">{lines.map(l=><span key={l.title} style={{color:l.color}}>● {l.title}</span>)}</div>
    <svg role="img" aria-label="현재까지의 발화별 금융 위험과 심리적 압박 지수" viewBox={`0 0 ${w} ${h}`} className="w-full rounded-xl bg-[#0b1728]">
      {[0,50,100].map(v=><g key={v}><line x1={p} x2={w-p} y1={y(v)} y2={y(v)} stroke="#2c4055"/><text x={5} y={y(v)+4} fill="#91a8bd" fontSize="11">{v}</text></g>)}
      {lines.map(line=><polyline key={line.title} points={line.values.map((v,i)=>`${x(i)},${y(v)}`).join(" ")} fill="none" stroke={line.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>)}
      {history.map((step,i)=><text key={i} x={x(i)} y={h-7} fill="#b2c6d9" fontSize="11" textAnchor="middle">{step.turnNumber}</text>)}
    </svg>
    <p className="mt-2 text-xs text-[#a6b8cd]">X축: 발화 번호 · Y축: 실험 지수(0–100, 사기 확률 아님)</p>
  </div>;
}

export default function ReplayLab() {
  const [category,setCategory] = useState<ScenarioCategory | "ALL">("ALL");
  const [selectedId,setSelectedId] = useState(scenarios[0].scenarioId);
  const [step,setStep] = useState(1);
  const [showTruth,setShowTruth] = useState(false);
  const [safeToSpeak,setSafeToSpeak] = useState(false);
  const [requestDelayPhrase,setRequestDelayPhrase] = useState(false);
  const report=useMemo(()=>evaluateDataset(),[]);
  const list=useMemo(()=>scenarios.filter(s=>category==="ALL" || s.category===category),[category]);
  const selected:ReplayScenario = scenarios.find(s=>s.scenarioId===selectedId) ?? scenarios[0];
  const history=useMemo(()=>replayScenario(selected),[selected]);
  const current=history[Math.min(step,history.length)-1];
  // Independent experimental case timeline: never changes the benchmark's canonical scorer.
  const caseTimeline=useMemo(()=>buildCaseTimeline(selected.scenarioId,selected.turns.map(t=>({turnId:t.turnId,speaker:t.speaker,text:t.text}))),[selected]);
  const caseState=caseTimeline[Math.min(step,caseTimeline.length)-1];
  const caseView=getCaseView(caseState);
  const assessment:TriageResult=current?.assessment ?? assessTriage({turns:[]});
  const guidance=selectLiveGuidance({caseState,jurisdiction:'KR',safeToSpeak,requestDelayPhrase});
  const sources=researchSources.filter(src=>selected.sourceIds.includes(src.sourceId));
  const row=report.cases.find(r=>r.id===selectedId);
  function choose(id:string) {setSelectedId(id);setStep(1);setShowTruth(false);setSafeToSpeak(false);setRequestDelayPhrase(false);}
  function changeCategory(value:ScenarioCategory | "ALL") {setCategory(value);const first=scenarios.find(s=>value==="ALL"||s.category===value);if(first)choose(first.scenarioId);}
  return <main className="mx-auto min-h-screen max-w-6xl space-y-6 px-4 py-8 text-[#edf3fc] sm:px-6">
    <nav className="flex flex-wrap gap-4 text-sm text-[#8be8d6]"><Link href="/">← 대시보드</Link><Link href="/lab">문장 직접 입력</Link><Link href="/simulator">가상 은행</Link><Link href="/lab/voice">음성 실험실</Link></nav>
    <header className="space-y-2">
      <p className="text-xs font-bold tracking-[0.15em] text-[#74e3d3]">SAFE CALL v0.6.6 · EVIDENCE GROUNDED LIVE GUIDANCE</p>
      <h1 className="text-3xl font-bold">실제 사례에서 착안한 대화 재생 실험실</h1>
      <p className="max-w-4xl text-sm leading-7 text-[#b8cbe0]">60개 자체 작성 가상 통화에서 한 발화씩 대화를 공개하고, <code>assessTriage()</code> 하나로 위험·심리적 압박을 측정합니다. 실제 녹취·유튜브 음원이 아니며, 기본값에서는 Meta API를 호출하지 않습니다. 출처는 수법 참고용이며 시나리오 대사는 모두 창작했습니다.</p>
    </header>
    <section className="rounded-2xl border border-[#34506a] bg-[#142438] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">실험 요약 · 60건</h2><div className="flex flex-wrap gap-2"><button onClick={()=>downloadText("safecall-v04-results.json",JSON.stringify(report,null,2),"application/json")} className="rounded-lg border border-[#477087] px-3 py-2 text-xs">JSON 저장</button><button onClick={()=>exportCsv(report.cases)} className="rounded-lg border border-[#477087] px-3 py-2 text-xs">CSV 저장</button></div></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[{title:"평가 포함",value:`${report.binaryEvaluated}건`,sub:"애매한 15건 제외"},{title:"기존 위험 분석 F1",value:pct(report.canonical.f1),sub:"합성 데이터 기준"},{title:"정상 통화 오경고",value:`${report.canonical.matrix.FP}건`,sub:`15개 정상 중 · ${pct(report.canonical.falsePositiveRate)}`},{title:"위험 통화 미탐",value:`${report.canonical.matrix.FN}건`,sub:"30개 위험 중"}].map(m=><div key={m.title} className="rounded-xl bg-[#0d1b2d] p-4"><p className="text-xs text-[#aac0d6]">{m.title}</p><p className="mt-2 text-2xl font-bold">{m.value}</p><p className="mt-1 text-xs text-[#9faec0]">{m.sub}</p></div>)}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[{name:"A · 키워드 비교용",metric:report.baseline},{name:"B · 단일 assessTriage",metric:report.canonical}].map(m=><div key={m.name} className="rounded-xl border border-[#33506a] p-3 text-sm"><strong>{m.name}</strong><p className="mt-2">TP {m.metric.matrix.TP} · FP {m.metric.matrix.FP} · TN {m.metric.matrix.TN} · FN {m.metric.matrix.FN}</p><p className="mt-1 text-[#b2c8da]">정밀도 {pct(m.metric.precision)} · 재현율 {pct(m.metric.recall)} · F1 {pct(m.metric.f1)}</p></div>)}
      </div>
      <p className="mt-4 text-xs leading-6 text-[#b3c7d9]">Meta 호출 후보: 전체 {report.triggerCount}건 · 위험 사례 호출 후보 재현율: {pct(report.triggerRecall)} · 최초 위험행동 <strong>이전</strong> 경고: {report.warningBeforeCriticalCount}/{report.criticalScenarioCount}건 · 위험행동 시점 <strong>이내</strong> 경고: {report.warningByCriticalCount}/{report.criticalScenarioCount}건. 모두 가상 데이터·규칙에 한정된 측정값입니다.</p>
    </section>
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <article className="space-y-4 rounded-2xl border border-[#344d64] bg-[#132035] p-5">
        <h2 className="text-xl font-bold">① Dataset Explorer</h2>
        <label className="block text-sm">사례 유형
          <select value={category} onChange={e=>changeCategory(e.target.value as ScenarioCategory|"ALL")} className="mt-2 w-full rounded-lg border border-[#48627c] bg-[#091627] p-3">
            <option value="ALL">전체 60건</option>{Object.entries(CATEGORY_LABEL).map(([key,name])=><option key={key} value={key}>{name} 15건</option>)}
          </select>
        </label>
        <label className="block text-sm">시나리오
          <select value={selected.scenarioId} onChange={e=>choose(e.target.value)} className="mt-2 w-full rounded-lg border border-[#48627c] bg-[#091627] p-3">
            {list.map(s=><option key={s.scenarioId} value={s.scenarioId}>{s.scenarioId} · {s.title}</option>)}
          </select>
        </label>
        <p className="text-xs text-[#a4b7cc]">{CATEGORY_LABEL[selected.category]} · 출처: {sources.length ? `${sources.length}개 공식/연구 자료 수법 참고` : "자체 작성 정상·판단유보 대조군"}</p>
        <h3 className="font-bold">② Conversation Replay</h3>
        <ol className="space-y-2">
          {selected.turns.slice(0,step).map((t,i)=><li key={t.turnId} className="rounded-xl bg-[#0c1929] p-3 text-sm"><span className="mr-2 text-[#83d8c8]">#{i+1} {t.speaker==="caller"?"상대방":"사용자"}</span>{t.text}</li>)}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={()=>setStep(1)} className="rounded-lg border border-[#466077] px-4 py-2 text-sm">처음</button>
          <button disabled={step<=1} onClick={()=>setStep(v=>v-1)} className="rounded-lg border border-[#466077] px-4 py-2 text-sm">이전</button>
          <button disabled={step>=selected.turns.length} onClick={()=>setStep(v=>v+1)} className="rounded-lg bg-[#71e0cb] px-4 py-2 text-sm font-bold text-[#0b2430]">다음 발화</button>
          <span className="ml-auto text-xs text-[#b4c9db]">{step} / {selected.turns.length}</span>
        </div>
      </article>
      <article className="space-y-4 rounded-2xl border border-[#344d64] bg-[#132035] p-5" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">③ Risk & Coaching Timeline</h2><span className="rounded-full bg-[#264156] px-3 py-1 text-xs">{assessment.riskBand} · {assessment.shouldCallMeta?"Meta 호출 후보":"호출 트리거 없음"}</span></div>
        <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#0c1929] p-3"><p className="text-xs text-[#aec2d4]">행동 위험 지수</p><p className="text-3xl font-bold">{assessment.riskIndex}<span className="text-sm text-[#9db3c7]"> /100</span></p></div><div className="rounded-xl bg-[#0c1929] p-3"><p className="text-xs text-[#aec2d4]">심리 압박 지수</p><p className="text-3xl font-bold">{assessment.psychologicalPressureIndex}<span className="text-sm text-[#9db3c7]"> /100</span></p></div></div>
        <RiskHistory history={history.slice(0,step)}/>
        <div className="space-y-3 rounded-xl border border-[#456584] bg-[#0d1b2d] p-4">
          <p className="font-bold text-[#8be8d6]">④ Situation Memory + Live Signals (v0.6.5 실험)</p>
          <p className="text-xs text-[#b3c7d9]">사건 {caseView.caseId} · 상태 버전 {caseView.stateVersion} · 과거 근거는 유지하고 현재 발화의 압박만 별도 계산합니다.</p>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {[{label:'누적 상황 위험',value:caseView.assessment.riskIndex},
              {label:'현재 긴박도',value:caseView.live.urgency},
              {label:'현재 강압 신호',value:caseView.live.coercivePressure},
              {label:'피해 행동 임박도',value:caseView.live.actionProximity},
              {label:'현재 압박 지수',value:caseView.live.livePressureIndex},
              {label:'긴박도 변화(발화 기준)',value:caseView.live.urgencyDelta}].map(item=><div key={item.label} className="rounded-lg bg-[#182b41] p-3"><p className="text-xs text-[#b6c8d9]">{item.label}</p><p className="mt-1 text-xl font-semibold">{item.value}{item.label.includes('변화')?'':' /100'}</p></div>)}
          </div>
          <p className="text-xs text-[#b2c6d9]">위험 근거 {caseView.activeEvidenceCount}개 · 현재 발화 위해 표현 {caseView.live.currentThreatObserved?'발견':'미발견'} · 화자 확인 불가 발화는 상대방 증거로 승격하지 않습니다. 지수는 검증되지 않은 규칙 점수이며 범죄 확률 또는 실제 스트레스 측정치가 아닙니다.</p>
        </div>
        <div className="space-y-2"><h3 className="font-bold">현재 관찰된 신호</h3>{assessment.signals.length ? <ul className="space-y-2">{assessment.signals.map(s=><li key={s.code} className="rounded-lg bg-[#0c1929] p-3 text-sm"><span className="font-bold text-[#84e3d1]">{SIGNAL_LABELS[s.code]}</span><span className="ml-2 text-xs text-[#abc2d5]">#{s.turn+1}</span><p className="mt-1 break-words text-xs text-[#b2c6d8]">{s.evidence}</p></li>)}</ul>:<p className="text-sm text-[#a6bcd1]">현재 발화까지 탐지된 규칙 신호 없음. 위험이 없다는 보증이 아닙니다.</p>}</div>
        <div className="space-y-3 rounded-xl border border-[#5a6e79] bg-[#1d3342] p-4">
          <p className="text-xs font-bold text-[#8ae8d2]">SafeCall Live Guidance · 공식 출처 참고 행동 카드 (데모)</p>
          <p className="text-xs text-[#adbfce]">사건 버전 {guidance.stateVersion} · {guidance.status} · {guidance.primary.id}</p>
          <div><p className="text-xs font-semibold text-[#a4e6d9]">지금 할 행동</p><p className="mt-1 text-sm leading-7">{guidance.primary.userAction}</p></div>
          {guidance.secondary && <p className="rounded-lg bg-[#0e2333] p-3 text-sm">추가: {guidance.secondary.userAction}</p>}
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-1" checked={safeToSpeak} onChange={e=>setSafeToSpeak(e.target.checked)}/>이 가상 장면에서 대화 문구를 보는 것이 안전하다고 판단하고, 선택적으로 표시합니다. 실제 위해 상황에서는 문구를 차단합니다.</label>
          {safeToSpeak && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-1" checked={requestDelayPhrase} onChange={e=>setRequestDelayPhrase(e.target.checked)}/>시간을 벌기 위한 문구를 요청합니다 (위협 상황에서는 표시하지 않음).</label>}
          {guidance.replyText ? <p className="rounded-lg border border-[#58877d] p-3 text-sm">필요하면 이렇게 말할 수 있어요: <strong>{guidance.replyText}</strong></p>:<p className="text-xs text-[#b2c8d7]">상대방에게 할 대화 문구는 제공하지 않습니다 (NO_SCRIPT).</p>}
          <p className="text-xs text-[#b2c8d7]">근거 발화: {guidance.primary.evidenceUtteranceIds.join(', ')||'확정된 직접 근거 없음'} · {guidance.reason}</p>
          <p className="text-xs text-[#b2c8d7]">참고한 공개 자료: {guidance.primary.sourceIds.map((id,i)=>{const src=sourceById(id);return src?<span key={id}>{i>0?' · ':''}<a href={src.url} target="_blank" rel="noopener noreferrer" className="underline text-[#8ae8d2]">{src.organization}</a></span>:null;})}</p>
          <p className="text-xs text-[#adbfce]">공식 기관이 승인한 SafeCall 지침이 아닙니다. 자동 발신·금융 조치는 실행하지 않습니다.</p>
        </div>
        {assessment.emergencyFlag && <p className="rounded-lg border border-[#b9645b] bg-[#4c2524] p-3 text-sm">실제 위해 가능성을 배제하지 마세요. 즉시 112 신고 안내 우선.</p>}
      </article>
    </section>
    <MetaComparisonPanel scenario={selected} step={step} triage={assessment}/>
    <section className="grid gap-5 lg:grid-cols-2">
      <article className="rounded-2xl border border-[#344d64] bg-[#132035] p-5"><h2 className="mb-3 text-xl font-bold">④ Evaluation Dashboard</h2><div className="space-y-2 text-sm">
        {report.perCategory.map(x=><div key={x.category} className="flex justify-between gap-3 border-b border-[#344d64] py-2"><span>{(CATEGORY_LABEL[x.category as ScenarioCategory] ?? x.category)}</span><span>{x.count}건 중 경고 {x.warned}건 · 호출 후보 {x.triggered}건</span></div>)}
      </div>
      <p className="mt-3 text-xs text-[#afc3d5]">현재 사례: 첫 경고 {row?.firstWarningTurn??"없음"}번째 / 트리거 {row?.firstTriggerTurn??"없음"}번째 · 위험 행동 예상 시점 {row?.criticalTurn??"해당 없음"}</p>
      <button type="button" onClick={()=>setShowTruth(!showTruth)} className="mt-4 rounded-lg border border-[#587189] px-3 py-2 text-sm">{showTruth?"정답 라벨 가리기":"평가용 정답 라벨 보기"}</button>
      {showTruth && <div className="mt-3 space-y-1 rounded-xl bg-[#0c1929] p-3 text-sm"><p>합성 시나리오 정답: <strong>{selected.groundTruth.scenarioLabel}</strong></p><p>의도한 안전 행동: {selected.groundTruth.expectedActionCodes.join(", ")||"상황 판단 유보"}</p><p>작성 당시 예상한 위험 신호: {selected.groundTruth.expectedSignals.join(", ")||"없음"}</p><p className="text-xs text-[#a6bfd2]">이 레이블은 AI/위험 분석 입력에 전달하지 않습니다.</p></div>}
      </article>
      <article className="rounded-2xl border border-[#344d64] bg-[#132035] p-5"><h2 className="mb-3 text-xl font-bold">출처 및 실험 제한</h2>{sources.length? <ul className="space-y-3">{sources.map(s=><li key={s.sourceId} className="text-sm"><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[#78e6d5] underline">{s.title}</a><p className="mt-1 text-xs text-[#a7bfd3]">{s.publisher} · 공개 자료의 수법을 참고한 자체 창작 대화. 실제 녹취 아님.</p></li>)}</ul>:<p className="text-sm text-[#b4c8dc]">이 사례는 연구 출처가 있는 피해 사건이 아닌 자체 창작 대조군입니다.</p>}
        <p className="mt-4 text-xs leading-6 text-[#b4c8dc]">정밀도·재현율은 45개 이진 라벨 사례에만 적용했으며, 애매한 15개는 별도 집계했습니다. 실사용 성능이나 위험 확률을 입증하지 않습니다. Meta 분석은 명시 실행할 때만 가능하며, 기본적으로 OFFLINE입니다.</p>
      </article>
    </section>
  </main>;
}
