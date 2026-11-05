"use client";

import Link from "next/link";
import { useState } from "react";
import type { TriageResult } from "@/modules/risk-triage";

const examples = [
  { label: "평범한 친구 전화", text: "오늘 저녁에 돈가스 먹으러 갈래?" },
  { label: "은행 사칭 위험", text: "은행 보안팀입니다. 지금 당장 안전 계좌로 돈을 보내세요. 가족에게는 말하지 마세요." },
  { label: "인증번호 유도", text: "인증번호를 지금 읽어 주세요." },
  { label: "심리적 조작 정황", text: "네 기억이 틀렸어. 아까 분명히 말했잖아." },
  { label: "안전 안내", text: "인증번호는 알려주면 안 됩니다. 송금하지 마세요." },
];

export default function TriageLabPage() {
  const [text, setText] = useState(examples[0].text);
  const [actionEvent, setActionEvent] = useState<"NONE" | "TRANSFER_PREPARED" | "OTP_SHARE_ATTEMPT">("NONE");
  const [result, setResult] = useState<TriageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function evaluate() {
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const response = await fetch("/api/triage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: [{ speaker: "caller", text }], actionEvent }),
      });
      if (!response.ok) throw new Error(`분석 요청 실패: HTTP ${response.status}`);
      const data: TriageResult = await response.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석에 실패했습니다.");
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-6 px-5 py-10 text-[#edf3fc]">
      <nav className="flex flex-wrap gap-4 text-sm text-[#85eddb]"><Link href="/">← 대시보드로 돌아가기</Link><Link href="/lab/replay">★ 60건 사례별 재생·평가 실험실 열기</Link></nav>
      <div>
        <p className="text-xs font-bold tracking-widest text-[#73dec9]">EXPERIMENT · OFFLINE RULES ONLY</p>
        <h1 className="mt-2 text-3xl font-bold">의심 표현 · 위험 지수 실험실</h1>
        <p className="mt-3 text-sm leading-7 text-[#b3c4db]">가상 발화를 입력하면 Meta AI를 호출할지 결정하는 1차 규칙과 실험용 위험 지수를 확인할 수 있어요. 실제 Meta AI 호출·사기 확률·가스라이팅 확정 판정은 아닙니다.</p>
      </div>
      <section className="space-y-4 rounded-3xl border border-[#32435a] bg-[#142134] p-5 sm:p-7">
        <div className="flex flex-wrap gap-2">{examples.map(example => <button key={example.label} type="button" onClick={() => { setText(example.text); setResult(null); }} className="rounded-lg border border-[#416078] px-3 py-2 text-xs hover:bg-[#223e53]">{example.label}</button>)}</div>
        <label htmlFor="utterance" className="block text-sm font-bold">가상 발신자 발언</label>
        <textarea id="utterance" maxLength={800} rows={4} value={text} onChange={e => setText(e.target.value)} className="w-full rounded-xl border border-[#41566d] bg-[#0d1827] p-4 text-sm outline-none focus:border-[#7be8d2]" />
        <label htmlFor="event" className="block text-sm font-bold">사용자 행동 이벤트</label>
        <select id="event" value={actionEvent} onChange={e => setActionEvent(e.target.value as typeof actionEvent)} className="w-full rounded-xl border border-[#41566d] bg-[#0d1827] p-3 text-sm">
          <option value="NONE">없음</option>
          <option value="TRANSFER_PREPARED">가상 송금 준비</option>
          <option value="OTP_SHARE_ATTEMPT">가상 인증정보 공유 시도</option>
        </select>
        <button type="button" disabled={busy || !text.trim()} onClick={evaluate} className="w-full rounded-xl bg-[#73ead2] p-3 font-bold text-[#0a2331] hover:bg-[#a7f4e5]">{busy ? "검사 중…" : "1차 위험 감지 실험"}</button>
        {error && <p role="alert" className="text-sm text-[#ffb3ac]">{error}</p>}
      </section>
      {result && <section aria-live="polite" className="space-y-4 rounded-3xl border border-[#354b63] bg-[#101d2e] p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">실험 결과</h2>
          <span className="rounded-full bg-[#284256] px-3 py-2 text-xs font-bold">{result.shouldCallMeta ? "실제 연동 시 Meta 호출 후보" : "Meta 호출 트리거 없음"}</span>
        </div>
        <p className="text-sm text-[#aec2da]">위험 지수(검증되지 않은 임시 가중치)</p>
        <p className="text-4xl font-bold">{result.riskIndex} <span className="text-base text-[#a7bacf]">/ 100 · {result.riskBand}</span></p>
        <p className="text-sm text-[#aec2da]">심리적 압박 지수(실험값)</p>
        <p className="text-3xl font-bold">{result.psychologicalPressureIndex} <span className="text-base text-[#a7bacf]">/ 100</span></p>
        <p className="text-xs text-[#9aacc2]">현실 인식 흔들기 단서 {result.realityUnderminingObservations}개 발화{result.repeatedRealityUnderminingCue ? " · 여러 발화에서 반복 관찰" : " · 반복 여부 미확인"} — 가스라이팅 판정 아님</p>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={result.riskIndex} aria-label="실험용 위험 지수" className="h-3 rounded-full bg-[#34485a]"><div className="h-full rounded-full bg-[#f7bd79]" style={{ width: `${result.riskIndex}%` }} /></div>
        <p className="text-sm text-[#c9d8e7]">탐지 신호: {result.signals.length ? result.signals.map(s => s.code).join(" · ") : "상대방 요구 신호 없음"}</p>
        <p className="text-sm text-[#c9d8e7]">트리거: {result.triggerReasons.join(" · ") || "없음"}</p>
        {result.emergencyFlag && <p className="rounded-lg bg-[#543029] p-3 text-sm font-bold">긴급 위해 가능성: AI 분석을 기다리지 않고 112 안내 우선</p>}
        <div className="space-y-2 text-xs text-[#9aacc2]">{result.limitations.map(x => <p key={x}>• {x}</p>)}</div>
      </section>}
    </main>
  );
}
