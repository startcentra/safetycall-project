'use client';
import {useState} from 'react';
import {assessTriage} from '@/modules/risk-triage/index.ts';
import {decideBankArrival,maskedStaffScript,type Jurisdiction,type ArrivalEvidence} from '@/modules/bank-arrival/index.ts';
export default function BankArrivalDemo(){
 const [country,setCountry]=useState<Jurisdiction>('KR');
 const [call,setCall]=useState(false);
 const [arrival,setArrival]=useState<ArrivalEvidence>('NONE');
 const [help,setHelp]=useState(false);
 const [locked,setLocked]=useState(false);
 const [held,setHeld]=useState(false);
 const ko=country==='KR';
 const phrase=ko?'지금 당장 송금하세요. 가족에게 말하지 마세요.':'Transfer the money immediately. Do not tell anyone in your family.';
 const risk=assessTriage({turns:call?[{speaker:'caller',text:phrase}]:[]});
 const decision=decideBankArrival({caseId:'SIMULATION',stateVersion:call?1:0,caseOpen:true,riskIndex:risk.riskIndex,detected:risk.riskIndex>=40,activeEvidenceIds:risk.signals.map((s,i)=>s.code+i),evidenceVersion:call?1:0,country,arrivalEvidence:arrival,arrivalCaseId:'SIMULATION',arrivalVersion:call?1:0,locationConsent:false,locationTimestampMs:null,nowMs:0,bankPlaceVerified:false,physicalEmergency:risk.emergencyFlag,userWantsHelp:help});
 const reset=()=>{setCall(false);setArrival('NONE');setHelp(false);setLocked(false);setHeld(false)};
 const box='rounded-3xl bg-white p-5 shadow-sm';
 return <main className="min-h-screen bg-[#f3f6fb] px-4 py-7 text-[#18283a]"><div className="mx-auto max-w-[420px] space-y-4">
 <header className="flex items-center justify-between gap-3"><h1 className="text-xl font-bold">SafeCall · {ko?'은행 방문 보호':'Bank visit protection'}</h1><select aria-label="Language" className="rounded-xl border p-2 text-xs" value={country} onChange={e=>{setCountry(e.target.value as Jurisdiction);reset()}}><option value="KR">한국어</option><option value="US">English</option></select></header>
 <p className="rounded-2xl bg-[#deebfc] p-3 text-xs">{ko?'가상 통화·은행 시연. 실제 GPS·계좌·전화와 연결되지 않습니다.':'Fictional call and bank simulation. No real GPS, account or telephone.'}</p>
 <section className={box}><h2 className="font-bold">{ko?'1. 위험 전화':'1. Risk call'}</h2><p className="my-3 text-sm">{call?phrase:(ko?'통화를 시작하면 가상의 송금 압박이 나타납니다.':'Start the fictional pressure call.')}</p><button className="w-full rounded-xl bg-[#2053a2] p-3 font-bold text-white" onClick={()=>call?reset():setCall(true)}>{call?(ko?'초기화':'Reset'):(ko?'가상 전화 시작':'Start mock call')}</button></section>
 <section className={box}><h2 className="font-bold">{ko?'2. 근거와 점수':'2. Evidence and score'}</h2><strong className="text-3xl">{risk.riskIndex}/100</strong><div className="my-3 h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-orange-500" style={{width:risk.riskIndex+'%'}} /></div><p className="text-sm">{risk.signals.map(x=>x.code).join(', ')||'No signals'}</p><p className="mt-2 text-xs text-slate-500">{ko?'사기 확률이 아닌 실험적 규칙 점수입니다.':'Experimental rule score, not fraud probability.'}</p></section>
 <section className={box}><h2 className="font-bold">{ko?'3. 은행 방문 증거':'3. Bank arrival evidence'}</h2><p className="my-2 text-xs text-slate-500">{ko?'GPS 근접만으로 도착을 확정할 수 없습니다.':'GPS proximity alone does not establish arrival.'}</p><div className="grid grid-cols-2 gap-2"><button className="rounded-xl border p-3 text-sm" onClick={()=>setArrival('NEARBY_GPS')}>{ko?'GPS 근처 (가상)':'Nearby (mock)'}</button><button className="rounded-xl border p-3 text-sm" onClick={()=>setArrival('USER_CONFIRMED')}>{ko?'도착 직접 확인':'Confirm arrival'}</button></div><label className="my-3 flex gap-2 text-sm"><input type="checkbox" checked={help} onChange={e=>setHelp(e.target.checked)}/>{ko?'직원 도움 요청에 동의':'Request staff assistance'}</label><p role="status" className="rounded-xl bg-slate-100 p-3 text-sm"><b>{decision.state}</b> · {decision.reason}</p>{decision.allowBankSimulation&&<p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm">{maskedStaffScript(country)}</p>}</section>
 <section className={box}><h2 className="font-bold">{ko?'4. SafeBank 가상 은행':'4. SafeBank sandbox'}</h2><p className="my-3 text-sm">Card: {locked?'LOCKED':'ACTIVE'} · Transfer: {held?'HELD':'DRAFT'}</p><div className="grid grid-cols-2 gap-2"><button disabled={!decision.allowBankSimulation} onClick={()=>setLocked(x=>!x)} className="rounded-xl border p-3 text-sm disabled:opacity-40">{ko?'가상 카드 잠금':'Mock card lock'}</button><button disabled={!decision.allowBankSimulation} onClick={()=>setHeld(true)} className="rounded-xl border p-3 text-sm disabled:opacity-40">{ko?'가상 송금 보류':'Hold mock transfer'}</button></div></section>
 </div></main>
}
