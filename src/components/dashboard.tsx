"use client";

import { useCallback, useState } from "react";
import Link from "next/link";

type HealthResponse = {
  status: "ok";
  service: string;
  phase: string;
  model: "not_connected";
  mode: "demo_skeleton";
  version: string;
  timestamp: string;
};

type ProbeState = "idle" | "loading" | "success" | "failure";

const modules = [
  { title: "대화 이벤트", detail: "모의 발화 순차 진행 및 사건 기록", state: "데모 작동", complete: true },
  { title: "Meta AI 분석", detail: "실제 API 미연결", state: "미연결", complete: false },
  { title: "안전 정책", detail: "정책 결정 타입 정의", state: "계약 준비", complete: false },
  { title: "Mock Banking", detail: "가상 송금 보류·취소(실제 금융거래 없음)", state: "데모 작동", complete: true },
  { title: "실시간 코칭", detail: "가상 이벤트에 따른 규칙 기반 코칭", state: "데모 작동", complete: true },
];

const future = [
  { id: "M2", title: "첫 시나리오 데모", text: "시나리오·모의 송금·규칙 기반 코칭 연결" },
  { id: "M3", title: "Meta AI 연결", text: "실제 발화 분석 응답 및 검증" },
  { id: "M4–M5", title: "안전 정책 고도화", text: "실제 Meta 분석을 거래 정책에 연결" },
];

export function Dashboard() {
  const [probe, setProbe] = useState<ProbeState>("idle");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState("");

  const checkHealth = useCallback(async () => {
    setProbe("loading");
    setMessage("");
    setHealth(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      let response: Response;
      try {
        response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: unknown = await response.json();
      if (!isHealthResponse(body)) throw new Error("예상과 다른 API 응답입니다.");
      setHealth(body);
      setProbe("success");
    } catch (error) {
      setProbe("failure");
      setMessage(error instanceof Error ? error.message : "서버 연결 상태를 확인할 수 없습니다.");
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#090f1c] text-[#eef4ff]">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_50%_0%,rgba(38,101,118,0.26),transparent_68%)]" />
      <div className="relative mx-auto max-w-[1120px] px-5 pb-24 pt-6 sm:px-8 sm:pt-9">
        <header className="mb-12 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#4ad5bf]/30 bg-[#1d534f]/40 text-xl text-[#78ebd9]" aria-hidden="true">◆</div>
            <div>
              <p className="text-[17px] font-semibold tracking-tight">SafeCall Guardian</p>
              <p className="text-[12px] text-[#91a7c3]">META HACKATHON · 2026</p>
            </div>
          </div>
          <span className="rounded-full border border-[#4a647c] bg-[#18263a] px-3 py-1.5 text-xs font-semibold tracking-wide text-[#bfd1e6]">M2 / DEMO SKELETON</span>
        </header>

        <main className="space-y-8">
          <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-[28px] border border-[#314a60] bg-gradient-to-br from-[#162f40] via-[#132334] to-[#111a2b] p-7 shadow-2xl sm:p-10">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#408e83] bg-[#163f3e] px-3 py-1.5 text-xs font-semibold text-[#97f4df]"><span className="h-2 w-2 rounded-full bg-[#77ebc7]" /> 기본 골조 및 데모 화면 준비</div>
              <h1 className="max-w-lg text-3xl font-bold leading-tight tracking-tight sm:text-[40px] sm:leading-[1.25]">위험한 순간에,<br/><span className="text-[#74e5d0]">안전한 다음 행동</span>을.</h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-[#bdcbdc]">통화 위험 신호와 금융 행동을 연결해 단계별 대응을 안내할 AI 안전 시스템. 현재는 로컬 서버 기반 가상 통화 데모를 실행할 수 있으며, 실제 AI 모델은 미연결입니다.</p>
              <div className="mt-7 flex flex-wrap gap-2">
                {['한국어 우선', '가상 시나리오', '비밀키 분리', '실제 통화 접근 없음'].map(tag => <span key={tag} className="rounded-full border border-[#34566a] bg-[#0b1b2a]/70 px-3 py-1.5 text-xs text-[#b7d0df]">{tag}</span>)}
              </div>
            </div>
            <div className="flex flex-col justify-between rounded-[28px] border border-[#34455d] bg-[#131f30] p-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#9db0c8]">시스템 상태</p>
                <h2 className="mt-3 text-2xl font-semibold">연결 테스트</h2>
                <p className="mt-3 text-sm leading-6 text-[#91a7bf]">버튼을 누르면 브라우저에서 로컬 서버의 API를 실제 호출합니다. AI 모델은 아직 호출하지 않습니다.</p>
                <div className="mt-6 rounded-2xl border border-[#33475d] bg-[#0d1827] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#bdccde]">서버 상태</span>
                    <span className={`text-xs font-bold ${probe === 'success' ? 'text-[#76ebc6]' : probe === 'failure' ? 'text-[#f5a8a8]' : 'text-[#a9bad0]'}`} aria-live="polite">{probe === 'success' ? '응답 정상' : probe === 'failure' ? '확인 실패' : probe === 'loading' ? '확인 중' : '아직 확인하지 않음'}</span>
                  </div>
                  <div className="my-3 h-px bg-[#273b51]" />
                  <div className="flex items-center justify-between gap-3 text-sm"><span className="text-[#bdccde]">Meta Model API</span><span className="rounded-md bg-[#473827] px-2 py-1 text-xs text-[#f1c88f]">미연결</span></div>
                  {health && <div className="mt-3 text-xs text-[#94b6ca]" aria-live="polite">응답 단계: {health.phase}<br/>확인 시간: {new Date(health.timestamp).toLocaleString('ko-KR')}</div>}
                  {message && <p className="mt-3 break-words text-xs text-[#f5a8a8]" role="alert">{message}</p>}
                </div>
              </div>
              <button type="button" className="mt-6 w-full rounded-xl bg-[#66e0c9] px-4 py-3.5 text-sm font-bold text-[#092b2e] transition hover:bg-[#9df2e0] disabled:opacity-60" disabled={probe === 'loading'} onClick={checkHealth}>{probe === 'loading' ? '서버에 요청 중…' : '서버 연결 확인하기'}</button>
            </div>
          </section>

          <section className="rounded-[25px] border border-[#376c69] bg-[#173337] p-6 sm:p-8">
            <p className="text-xs font-bold tracking-widest text-[#93f0d8]">INTERACTIVE DEMO · M2 SKELETON</p>
            <h2 className="mt-3 text-2xl font-bold">첫 번째 가상 통화 흐름</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[#c5e1dc]">발화 재생 → 규칙 기반 위험 표시 → 행동 코칭 → 가상 송금 보류 → 취소까지 동작하는 기초 시뮬레이터야. Meta API와 실제 통화는 아직 연결되지 않았어.</p>
            <Link className="mt-5 inline-flex rounded-xl bg-[#71e3ce] px-5 py-3 text-sm font-bold text-[#082a2d] hover:bg-[#a9f4e5]" href="/simulator">가상 시뮬레이터 실행 →</Link>
          </section>
          <section className="rounded-[25px] border border-[#66754c] bg-[#202c29] p-6 sm:p-8">
            <p className="text-xs font-semibold tracking-widest text-[#a0f5d0]">NEW · OFFLINE RISK TRIAGE EXPERIMENT</p>
            <h2 className="mt-2 text-2xl font-bold">의심 표현과 위험 지수를 직접 시험해 보기</h2>
            <p className="mt-3 text-sm leading-7 text-[#c5e1dc]">가상 발화 입력 → 의심 표현 감지 → Meta 호출 후보 판단 → 근거별 임시 위험 지수 계산. 현재는 실제 Meta API 호출 없이 동작하는 실험실입니다.</p>
            <Link href="/lab" className="mt-5 inline-flex rounded-xl bg-[#a0f5d0] px-5 py-3 text-sm font-bold text-[#082a2d]">위험 분석 실험실 열기 →</Link>
          </section>
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-semibold tracking-widest text-[#68d9cb]">MODULE READINESS</p><h2 className="mt-2 text-2xl font-semibold">핵심 모듈 준비 현황</h2></div><span className="text-xs text-[#91a9bf]">실제 연동 여부를 구분해 표시</span></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((m, i) => <article key={m.title} className="rounded-2xl border border-[#293e55] bg-[#121f30] p-5">
                <div className="mb-6 flex items-center justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1a3241] text-xs font-bold text-[#78e7d4]">{String(i + 1).padStart(2, '0')}</span><span className="rounded-full bg-[#293449] px-2.5 py-1 text-[11px] text-[#c8d4e5]">{m.state}</span></div>
                <h3 className="text-base font-semibold">{m.title}</h3><p className="mt-1.5 text-xs leading-5 text-[#96abc4]">{m.detail}</p>
              </article>)}
              <article className="rounded-2xl border border-dashed border-[#48677a] bg-[#102434] p-5">
                <p className="text-xs font-semibold text-[#78e7d4]">M1에서 구현된 기능</p><h3 className="mt-5 text-lg font-semibold">Health API</h3><p className="mt-2 text-xs leading-5 text-[#abc0d4]">GET /api/health<br/>서버 응답 및 모듈 연결 상태 확인</p>
              </article>
            </div>
          </section>

          <section className="rounded-[25px] border border-[#2d4358] bg-[#111d2d] p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold tracking-widest text-[#68d9cb]">NEXT MILESTONES</p><h2 className="mt-2 text-2xl font-semibold">다음 개발 단계</h2></div><span className="rounded-full bg-[#293449] px-3 py-1.5 text-xs text-[#c8d4e5]">현재 M2 기초</span></div>
            <div className="grid gap-4 md:grid-cols-3">
              {future.map((item) => <div className="rounded-xl bg-[#19283b] p-5" key={item.id}><span className="text-xs font-bold text-[#78e7d4]">{item.id}</span><h3 className="mt-3 font-semibold">{item.title}</h3><p className="mt-2 text-xs leading-5 text-[#a7bbcf]">{item.text}</p></div>)}
            </div>
          </section>
          <aside className="rounded-xl border border-[#4c4e4b] bg-[#222325] px-5 py-4 text-xs leading-6 text-[#e2d7b8]" role="note"><strong>안내:</strong> 현재는 개발 시뮬레이션입니다. 데모 코칭과 가상 송금 보류만 작동합니다. 실제 Meta AI 분석, 금융기관 연동, 실제 신고 기능은 없습니다. 실제 위험 상황에서는 AI 판단을 기다리지 말고 112에 신고하세요.</aside>
        </main>
        <footer className="mt-12 flex flex-wrap justify-between gap-2 border-t border-[#29394e] pt-6 text-xs text-[#7e94ae]"><span>SafeCall Guardian · M0/M1 골조 / M2 기초 시뮬레이터</span><span>2026 Meta Global AI Developer Hackathon</span></footer>
      </div>
    </div>
  );
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return data.status === "ok" && data.phase === "M2_SKELETON" && data.model === "not_connected" && typeof data.timestamp === "string";
}
