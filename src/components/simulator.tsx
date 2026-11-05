"use client";

import { useState } from "react";
import Link from "next/link";
import type { SimulationAction, SimulationState } from "@/modules/simulation/engine";

const formatAmount = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

export function Simulator() {
  const [session, setSession] = useState<SimulationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/simulations", { method: "POST", cache: "no-store" });
      const body: unknown = await res.json();
      if (!res.ok) throw new Error(getError(body));
      setSession(body as SimulationState);
    } catch (err) { setError(err instanceof Error ? err.message : "시뮬레이션 시작 실패"); }
    finally { setBusy(false); }
  }

  async function send(action: SimulationAction) {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/simulations/${encodeURIComponent(session.id)}/events`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }), cache: "no-store",
      });
      const body: unknown = await res.json();
      if (!res.ok) throw new Error(getError(body));
      setSession(body as SimulationState);
    } catch (err) { setError(err instanceof Error ? err.message : "이벤트 처리 실패"); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-[#090f1c] text-[#eef4ff]">
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-sm text-[#8debd9] hover:underline">← 시스템 대시보드</Link>
        <span className="rounded-full border border-[#ba9855] bg-[#322919] px-3 py-1.5 text-xs font-bold text-[#f4d29a]">가상 훈련 · DEMO ONLY · META 미연결</span>
      </header>
      <div className="mb-7">
        <p className="text-xs font-semibold tracking-[0.16em] text-[#78e7d4]">M2 STARTER / INTERACTIVE DEMO</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">가상 통화와 행동 코칭</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[#a9bed2]">아래 버튼으로 가상의 발화를 순서대로 재생해 봐. 분석은 현재 <strong>미리 작성된 규칙</strong>으로 동작해. 실제 Meta AI 호출, 실제 통화, 실제 송금, 실제 은행 조회 기능은 없어.</p>
      </div>
      {!session ? <section className="rounded-3xl border border-[#36566a] bg-[#152638] p-8">
        <h2 className="text-2xl font-bold">은행 사칭 시나리오 01</h2>
        <p className="mt-3 text-sm leading-7 text-[#b4c7d9]">가상의 은행 보안팀을 사칭하는 발신자가 송금을 재촉하는 상황이야. 새로운 발화를 입력으로 받아 코칭이 바뀌는지 살펴보자.</p>
        <button className="mt-7 rounded-xl bg-[#71e3ce] px-6 py-3 font-bold text-[#082a2d] disabled:opacity-50" disabled={busy} onClick={start}>{busy ? "시작 중…" : "가상 통화 시작"}</button>
      </section> : <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-[#2b4b62] bg-[#121f30] p-6 sm:p-7">
          <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-bold">모의 통화</h2><span className="rounded-lg bg-[#25354b] px-3 py-1 text-xs text-[#bfd1e5]">{session.ended ? "훈련 종료" : `발화 ${session.utteranceIndex}/3`}</span></div>
          <div className="mt-5 min-h-52 space-y-3 rounded-2xl border border-[#2a4256] bg-[#0b1725] p-4">
            {session.transcript.length === 0 && <p className="text-sm text-[#8ea7bd]">발화 재생 버튼을 누르면 가상 상대방의 대화가 여기에 나타나.</p>}
            {session.transcript.map((line, idx) => <div key={idx} className="rounded-xl bg-[#213348] p-3"><p className="mb-1 text-xs text-[#81e1d0]">가상 발신자 · {idx + 1}</p><p className="text-sm leading-6">{line}</p></div>)}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <ActionButton onClick={() => send("NEXT_LINE")} disabled={busy || session.ended || session.utteranceIndex >= 3} primary>다음 발화 재생</ActionButton>
            <ActionButton onClick={() => send("VERIFY_CLAIM")} disabled={busy || session.ended || session.claimStatus === "MOCK_CONTRADICTED"}>가상 은행 주장 검증</ActionButton>
            <ActionButton onClick={() => send("END_CASE")} disabled={busy || session.ended}>훈련 종료</ActionButton>
          </div>
          <p className="mt-4 text-xs text-[#8fa9c1]">미리 작성한 대화와 규칙을 순서대로 진행하는 데모야. 음성 녹음과 AI 분석은 아직 연결되지 않았어.</p>
        </section>
        <div className="space-y-5">
          <section className="rounded-3xl border border-[#37556c] bg-[#142438] p-6">
            <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold">위험 신호 · 가상 규칙</h2><span className="rounded-full bg-[#273952] px-3 py-1 text-xs text-[#e4c393]">{session.risk.toUpperCase()}</span></div>
            {session.assessment && <div className="mt-4 grid gap-2 rounded-xl border border-[#355573] bg-[#0f2133] p-3 text-sm sm:grid-cols-3">
              <div><span className="block text-xs text-[#91b1c9]">위험 지수 · 실험값</span><strong>{session.assessment.riskIndex}/100</strong></div>
              <div><span className="block text-xs text-[#91b1c9]">심리 압박 · 실험값</span><strong>{session.assessment.psychologicalPressureIndex}/100</strong></div>
              <div><span className="block text-xs text-[#91b1c9]">Meta 호출 후보</span><strong>{session.assessment.shouldCallMeta ? "예 (호출 안 함)" : "아니오"}</strong></div>
            </div>}
            <p className="mt-2 text-xs text-[#93bad0]">/lab과 동일한 risk-triage 분석기 사용 · 임시 지수이며 사기 확률이 아닙니다.</p>
            <div className="mt-4 flex min-h-10 flex-wrap gap-2">{session.signals.length ? session.signals.map(signal=><span key={signal} className="rounded-lg bg-[#4b3226] px-3 py-1.5 text-xs text-[#ffd1ad]">{signal}</span>) : <p className="text-sm text-[#a4bad0]">아직 신호가 없음</p>}</div>
            <div className="mt-4 rounded-xl border border-[#326477] bg-[#153c47] p-4"><p className="mb-2 text-xs font-semibold text-[#86e8dd]">현재 행동 코칭</p><p aria-live="polite" className="text-sm font-medium leading-7">{session.coaching}</p></div>
            <p className="mt-3 text-xs text-[#acbdcc]">상대방에게 말할 수 있는 예시: “{session.replySuggestion}”</p>
            <p className="mt-3 text-xs text-[#d6b37e]">상대방 신원: {session.claimStatus === "UNVERIFIED" ? "미확인" : "가상 조회와 불일치 (실제 조회 아님)"}</p>
          </section>
          <section className="rounded-3xl border border-[#37556c] bg-[#142438] p-6">
            <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold">Mock Bank</h2><span className="text-xs text-[#a7c0d4]">모의 거래 전용</span></div>
            <div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-[#a7bdcf]">가상 계좌</span><span>DEMO-USER-001</span></div><div className="flex justify-between"><span className="text-[#a7bdcf]">가상 잔액</span><strong>{formatAmount(session.mockBalance)}</strong></div><div className="flex justify-between"><span className="text-[#a7bdcf]">모의 요청 금액</span><strong>{formatAmount(session.mockTransferAmount)}</strong></div><div className="flex justify-between"><span className="text-[#a7bdcf]">거래 상태</span><strong className="text-[#f1d098]">{session.transferStatus}</strong></div></div>
            <div className="mt-5 flex flex-wrap gap-2"><ActionButton primary onClick={() => send("REQUEST_TRANSFER")} disabled={busy || session.ended || session.utteranceIndex === 0 || session.transferStatus !== "NONE"}>가상 송금 시도</ActionButton><ActionButton onClick={() => send("CANCEL_TRANSFER")} disabled={busy || session.ended || session.transferStatus !== "HELD"}>가상 송금 취소</ActionButton></div>
            <p className="mt-3 text-xs leading-5 text-[#9eb2c6]">모든 모의 송금은 서버에서 보류돼. 이 버전은 실제 금액 이동을 전혀 수행하지 않아.</p>
          </section>
        </div>
        <section className="rounded-3xl border border-[#2b4b62] bg-[#121f30] p-6 lg:col-span-2">
          <h2 className="text-lg font-bold">사건 타임라인</h2>
          <ol className="mt-4 space-y-2">{session.timeline.map((event, i) => <li key={`${event.at}-${i}`} className="flex flex-col gap-1 rounded-lg border border-[#2b4054] bg-[#172638] p-3 sm:flex-row sm:gap-5"><span className="shrink-0 text-xs font-bold text-[#82dfd0]">{event.type}</span><span className="text-xs leading-5 text-[#c1d0e1]">{event.detail}</span></li>)}</ol>
          <button disabled={busy} onClick={start} className="mt-5 rounded-lg border border-[#468373] px-4 py-2 text-xs font-semibold text-[#82e7d5] disabled:opacity-50">새 시뮬레이션 시작</button>
        </section>
      </div>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-[#b45a5a] bg-[#402626] p-4 text-sm text-[#ffcccc]">{error}</p>}
      <aside className="mt-8 rounded-xl border border-[#665332] bg-[#30281d] p-4 text-xs leading-6 text-[#f0d4a7]">실제 위험 상황을 위한 앱이 아니라 해커톤 개발용 시뮬레이터야. 실제 긴급한 범죄·위해 상황에서는 AI의 판단을 기다리지 말고 112로 신고해야 해.</aside>
    </div>
  </div>;
}

function ActionButton({ onClick, disabled, children, primary = false }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; primary?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${primary ? "bg-[#71e3ce] text-[#082a2d] hover:bg-[#a9f4e5]" : "border border-[#47647e] bg-[#23374c] text-[#dbe9f7] hover:bg-[#304960]"}`}>{children}</button>;
}

function getError(response: unknown): string {
  if (typeof response === "object" && response !== null && "error" in response && typeof response.error === "string") return response.error;
  return "서버 요청 실패";
}
