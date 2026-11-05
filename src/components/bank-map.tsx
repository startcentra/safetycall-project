'use client';
import {useEffect,useRef,useState} from 'react';
type Coord={lat:number;lon:number};
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
const centers={KR:{lat:37.5665,lon:126.978},US:{lat:40.7128,lon:-74.006}};
export default function BankMap({country}:{country:'KR'|'US'}){
 const [open,setOpen]=useState(false);
 const [pos,setPos]=useState<Coord|null>(null);
 const [status,setStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++},[]);
 const ko=country==='KR';
 function close(){generation.current++;setOpen(false);setPos(null);setStatus('');setBusy(false)}
 function locate(){
  if(typeof navigator==='undefined'||!navigator.geolocation){setStatus(ko?'위치 서비스가 없어 지도만 열 수 있습니다.':'Location unavailable. You can still view the map.');return}
  const token=++generation.current;
  setBusy(true);setPos(null);
  navigator.geolocation.getCurrentPosition(p=>{
   if(token!==generation.current)return;
   const {latitude,longitude,accuracy}=p.coords;
   if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||accuracy>2000){setStatus(ko?'위치가 부정확합니다. 지도에서 직접 탐색하세요.':'Location accuracy too low. Explore manually.');setBusy(false);return}
   setPos({lat:clamp(latitude,-85,85),lon:clamp(longitude,-180,180)});
   setStatus(ko?'현재 위치를 지도에 표시할 준비가 됐습니다. 위치는 저장하지 않습니다.':'Location ready for map view. It is not saved.');
   setBusy(false);
  },()=>{if(token!==generation.current)return;setStatus(ko?'위치 권한 거부 또는 조회 실패. 기본 지역 지도를 사용할 수 있습니다.':'Permission denied or location unavailable. Use the regional map.');setBusy(false)},
  {enableHighAccuracy:false,maximumAge:0,timeout:8000});
 }
 const c=pos??centers[country];
 const delta=pos?0.009:0.025;
 const bbox=[c.lon-delta,c.lat-delta,c.lon+delta,c.lat+delta].map(x=>x.toFixed(5)).join('%2C');
 const frame='https://www.openstreetmap.org/export/embed.html?bbox='+bbox+'&layer=mapnik';
 return <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm" aria-label={ko?'은행 주변 지도':'Area map'}>
  <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-[#64748b]">OPEN MAP · OPTIONAL</p><h2 className="mt-1 text-lg font-bold">{ko?'지도에서 은행 탐색':'Explore banks on a map'}</h2></div><span className="rounded-full bg-[#eef2ff] px-2 py-1 text-[11px] font-bold text-[#4f46e5]">OSM</span></div>
  <p className="mt-2 text-sm leading-6 text-slate-600">{ko?'지도는 OpenStreetMap으로 제공돼요. 표시된 은행의 영업·지점 정보는 확인되지 않았으며 GPS는 은행 입장을 증명하지 않습니다.':'Map data is from OpenStreetMap. Bank listings and opening hours are unverified; GPS does not confirm bank entry.'}</p>
  {!open?<button type="button" className="mt-4 min-h-12 w-full rounded-2xl bg-[#20375c] px-4 font-semibold text-white" onClick={()=>setOpen(true)}>{ko?'외부 지도 열기 (지도 제공자에 접속)':'Open external map (connect to provider)'}</button>:<div className="mt-4 space-y-3">
   <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{ko?'지도를 불러오면 지도 제공자에게 지역 정보와 IP가 전달될 수 있어요. 위치 공유는 별도 동의입니다.':'Loading the map may share the displayed area and IP with the provider. GPS sharing requires a separate action.'}</p>
   <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className="min-h-12 rounded-xl border border-[#cbd5e1] px-2 text-sm font-semibold disabled:opacity-50" onClick={locate}>{busy?'…':ko?'내 위치 사용':'Use my location'}</button><button type="button" className="min-h-12 rounded-xl border border-[#cbd5e1] px-2 text-sm font-semibold" onClick={close}>{ko?'지도 닫기·위치 삭제':'Close / clear location'}</button></div>
   <p role="status" className="text-xs text-slate-600">{status}</p>
   <iframe key={frame} title={ko?'OpenStreetMap 지도':'OpenStreetMap area map'} loading="lazy" referrerPolicy="no-referrer" className="h-[255px] w-full rounded-2xl border border-slate-200" src={frame}/>
   <p className="text-xs text-slate-500">© OpenStreetMap contributors · <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">ODbL / attribution</a></p>
   <a className="block min-h-11 rounded-xl bg-[#eef2ff] p-3 text-center text-sm font-semibold text-[#253e88]" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/">{ko?'OpenStreetMap에서 지점 직접 확인':'Verify branches on OpenStreetMap'}</a>
  </div>}
 </section>
}