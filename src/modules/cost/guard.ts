/** Fail-closed single-machine budget guard. Monetary values use integer USD micro-units.
 * Known usage is NOT the Meta invoice. Unknown billed usage remains a liability.
 * Single host/file only; deploy with shared transactional storage for multiple hosts.
 */
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PRICE={voicePerHour:0.18,sparkInputPerMillion:1.25,sparkCachedPerMillion:0.15,sparkOutputPerMillion:4.25} as const;
const micros=(usd:number)=>{if(!Number.isFinite(usd)||usd<0||usd>1_000_000)throw new CostGuardError('비용 추정값 오류');return Math.ceil(usd*1_000_000);};
export function estimateVoiceUsd(seconds:number){if(!Number.isFinite(seconds)||seconds<0||seconds>86400)throw new CostGuardError('invalid audio duration');return Math.ceil(seconds)*PRICE.voicePerHour/3600;}
export function estimateSparkUsd(input:number,output:number,cached=0){if(![input,output,cached].every(v=>Number.isSafeInteger(v)&&v>=0)||cached>input)throw new CostGuardError('invalid token counts');return ((input-cached)*PRICE.sparkInputPerMillion+cached*PRICE.sparkCachedPerMillion+output*PRICE.sparkOutputPerMillion)/1e6;}
type Kind='VOICE'|'SPARK';
type Reservation={id:string;sessionId:string;kind:Kind;reservedMicros:number;openedAt:string;status:'RESERVED'|'SETTLED';measuredMicros:number;liabilityMicros:number};
type ExperimentStatus='ACTIVE'|'CLOSED'|'EXPIRED';
type Experiment={id:string;kind:Kind;status:ExperimentStatus;createdAt:string;expiresAt:string;closedAt:string|null;maxCalls:number;capMicros:number;attempts:Array<{key:string;reservationId:string}>};
type Ledger={version:2;legacyLiabilityMicros:number;reservations:Reservation[];experiments?:Experiment[]};
export class CostGuardError extends Error{constructor(message:string){super(message);this.name='CostGuardError';}}
export interface BudgetConfig {file:string;totalUsd:number;initialApprovedUsd:number;dailyUsd:number;sessionUsd:number;maxConcurrent:number;killSwitch:boolean;liveEnabled:boolean;spendApproved:boolean;}
const blank=():Ledger=>({version:2,legacyLiabilityMicros:0,reservations:[],experiments:[]});
const day=(iso:string)=>iso.slice(0,10);
const exposure=(r:Reservation)=>r.status==='RESERVED'?r.reservedMicros:r.measuredMicros+r.liabilityMicros;
const validMoney=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0;
function parseLedger(raw:unknown):Ledger {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new CostGuardError('장부 형식 오류');
 const obj=raw as Record<string,unknown>;
 if(obj.version===1){
   if(!validMoney(obj.spentMicros)||!Array.isArray(obj.reservations))throw new CostGuardError('과거 장부 검증 실패');
   let totalLegacySettled=0;
   const reservations:Reservation[]=obj.reservations.map((v:unknown)=>{
     if(!v||typeof v!=='object')throw new CostGuardError('과거 장부 항목 오류');
     const r=v as Record<string,unknown>;
     if(typeof r.id!=='string'||!r.id.includes(':')||(r.kind!=='VOICE'&&r.kind!=='SPARK')||!validMoney(r.reservedMicros)||r.reservedMicros===0||!validMoney(r.chargedMicros)||
       (r.status!=='RESERVED'&&r.status!=='SETTLED')||typeof r.openedAt!=='string'||!Number.isFinite(Date.parse(r.openedAt)))throw new CostGuardError('과거 장부 손상');
     if(r.status==='SETTLED')totalLegacySettled+=r.chargedMicros as number;
     return {id:r.id,sessionId:r.id.split(':')[0],kind:r.kind,reservedMicros:r.reservedMicros as number,openedAt:r.openedAt,status:r.status,measuredMicros:0,
       liabilityMicros:r.status==='SETTLED'?r.chargedMicros as number:0};
   });
   if(totalLegacySettled>(obj.spentMicros as number))throw new CostGuardError('과거 장부 합계 불일치');
   return {version:2,legacyLiabilityMicros:(obj.spentMicros as number)-totalLegacySettled,reservations,experiments:[]};
 }
 if(obj.version!==2||!validMoney(obj.legacyLiabilityMicros)||!Array.isArray(obj.reservations))throw new CostGuardError('장부 버전/합계 오류');
 const ids=new Set<string>();
 for(const value of obj.reservations){
   const r=value as Reservation;
   if(!r||typeof r.id!=='string'||ids.has(r.id)||typeof r.sessionId!=='string'||!r.id.startsWith(r.sessionId+':')||
      !['VOICE','SPARK'].includes(r.kind)||!validMoney(r.reservedMicros)||r.reservedMicros<=0||!validMoney(r.measuredMicros)||!validMoney(r.liabilityMicros)||
      !['RESERVED','SETTLED'].includes(r.status)||!Number.isFinite(Date.parse(r.openedAt))||
      (r.status==='RESERVED'&&(r.measuredMicros!==0||r.liabilityMicros!==0)))throw new CostGuardError('장부 항목 검증 실패');
   ids.add(r.id);
 }
 if(obj.experiments!==undefined){
  if(!Array.isArray(obj.experiments))throw new CostGuardError('실험 장부 형식 오류');
  const expIds=new Set<string>();
  for(const raw of obj.experiments){
   const e=raw as Experiment;
   if(!e||typeof e.id!=='string'||!/^[a-zA-Z0-9_-]{1,90}$/.test(e.id)||expIds.has(e.id)||
     !['VOICE','SPARK'].includes(e.kind)||!['ACTIVE','CLOSED','EXPIRED'].includes(e.status)||
     !Number.isFinite(Date.parse(e.createdAt))||!Number.isFinite(Date.parse(e.expiresAt))||
     !(e.closedAt===null||typeof e.closedAt==='string'&&Number.isFinite(Date.parse(e.closedAt)))||
     !Number.isSafeInteger(e.maxCalls)||e.maxCalls<1||e.maxCalls>5||!validMoney(e.capMicros)||e.capMicros===0||
     !Array.isArray(e.attempts)||e.attempts.length>e.maxCalls||e.attempts.some(a=>!a||!(/^[a-f0-9]{64}$/.test(a.key))||
       typeof a.reservationId!=='string'||!ids.has(a.reservationId))||
     new Set(e.attempts.map(a=>a.key)).size!==e.attempts.length)throw new CostGuardError('실험 장부 손상');
   expIds.add(e.id);
  }
 }
 return {...obj,experiments:(obj.experiments??[]) as Experiment[]} as Ledger;
}
export class CostGuard {
 readonly config:BudgetConfig;
 constructor(config:BudgetConfig){
  this.config=config;
  if(![config.totalUsd,config.initialApprovedUsd,config.dailyUsd,config.sessionUsd].every(v=>Number.isFinite(v)&&v>=0&&v<=1_000_000)||
      !Number.isSafeInteger(config.maxConcurrent)||config.maxConcurrent<1||config.maxConcurrent>1000||typeof config.file!=='string'||!config.file)throw new CostGuardError('invalid cap');
 }
 /** A terminal experiment cannot reserve more exposure, even after process restart.
  * Cost ceilings are application-side estimates, NOT provider invoice hard limits.
  */
 beginExperiment(id:string,kind:Kind,options:{maxCalls?:number;capUsd?:number;ttlMs?:number}={},now=new Date()){
  if(!this.config.liveEnabled||!this.config.spendApproved||this.config.killSwitch)throw new CostGuardError('LIVE 사용이 승인되지 않았습니다.');
  if(!/^[a-zA-Z0-9_-]{1,90}$/.test(id)||!['SPARK','VOICE'].includes(kind))throw new CostGuardError('잘못된 실험 ID');
  const maxCalls=options.maxCalls??1,capUsd=options.capUsd??0.05,ttlMs=options.ttlMs??(kind==='VOICE'?720000:120000);
  if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>5||!Number.isFinite(capUsd)||capUsd<=0||capUsd>1||
    !Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>900000)throw new CostGuardError('실험 한도 설정 오류');
  return this.transaction(l=>{
   const experiments=l.experiments??(l.experiments=[]);
   if(experiments.length>=2000)throw new CostGuardError('실험 감사 기록 보관 상한: LIVE 차단 후 운영자 점검 필요');
   for(const e of experiments)if(e.status==='ACTIVE'&&Date.parse(e.expiresAt)<=now.getTime()){e.status='EXPIRED';e.closedAt=now.toISOString();}
   if(experiments.some(e=>e.id===id))throw new CostGuardError('이미 발급된 실험 ID는 재사용할 수 없습니다.');
   if(experiments.some(e=>e.status==='ACTIVE'&&e.kind===kind))throw new CostGuardError('동일 종류의 다른 실험이 진행 중입니다. 먼저 종료하세요.');
   if(l.reservations.some(r=>r.status==='RESERVED'))throw new CostGuardError('미정산 요청이 남아 있어 새 실험 차단');
   if(l.legacyLiabilityMicros>0||l.reservations.some(r=>r.liabilityMicros>0))throw new CostGuardError('청구 불명 내역 발견: 공식 청구 대조 전 신규 LIVE 차단');
   const e:Experiment={id,kind,status:'ACTIVE',createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+ttlMs).toISOString(),
    closedAt:null,maxCalls,capMicros:micros(capUsd),attempts:[]};
   experiments.push(e);
   return {id:e.id,kind:e.kind,status:e.status,expiresAt:e.expiresAt,maxCalls:e.maxCalls,capUsd:e.capMicros/1e6};
  });
 }
 closeExperiment(id:string,now=new Date()){
  return this.transaction(l=>{
   const e=l.experiments?.find(x=>x.id===id);
   if(!e)throw new CostGuardError('실험 ID 없음');
   if(e.status==='ACTIVE'){e.status=now.getTime()>=Date.parse(e.expiresAt)?'EXPIRED':'CLOSED';e.closedAt=now.toISOString();}
   return {id:e.id,status:e.status,closedAt:e.closedAt,usedCalls:e.attempts.length,maxCalls:e.maxCalls,
    pendingCalls:l.reservations.filter(r=>e.attempts.some(a=>a.reservationId===r.id)&&r.status==='RESERVED').length};
  });
 }
 experimentStatus(id:string,now=new Date()){
  return this.transaction(l=>{
   const e=l.experiments?.find(x=>x.id===id);if(!e)throw new CostGuardError('실험 ID 없음');
   if(e.status==='ACTIVE'&&now.getTime()>=Date.parse(e.expiresAt)){e.status='EXPIRED';e.closedAt=now.toISOString();}
   return {id:e.id,kind:e.kind,status:e.status,usedCalls:e.attempts.length,maxCalls:e.maxCalls,capUsd:e.capMicros/1e6,
    reservedExposureUsd:e.attempts.reduce((sum,a)=>sum+exposure(l.reservations.find(r=>r.id===a.reservationId)!),0)/1e6,
    expiresAt:e.expiresAt,closedAt:e.closedAt};
  });
 }
 reserveExperiment(kind:Kind,estimatedUsd:number,experimentId:string,requestKey:string,now=new Date()):string{
  if(!this.config.liveEnabled||!this.config.spendApproved||this.config.killSwitch)throw new CostGuardError('LIVE 비활성');
  if(!['VOICE','SPARK'].includes(kind)||!Number.isFinite(estimatedUsd)||estimatedUsd<=0||
    !/^[a-f0-9]{64}$/.test(requestKey))throw new CostGuardError('유료 요청 식별자 오류');
  const requested=micros(estimatedUsd*1.2+0.00001);
  return this.transaction(l=>{
   if(l.legacyLiabilityMicros>0||l.reservations.some(r=>r.liabilityMicros>0))throw new CostGuardError('청구 불명 내역: 유료 요청 차단');
   const e=l.experiments?.find(x=>x.id===experimentId);
   if(!e||e.kind!==kind)throw new CostGuardError('해당 유형의 등록된 실험이 없습니다.');
   if(e.status==='ACTIVE'&&now.getTime()>=Date.parse(e.expiresAt)){e.status='EXPIRED';e.closedAt=now.toISOString();}
   if(e.status!=='ACTIVE')throw new CostGuardError('종료 또는 만료된 실험: 추가 과금 차단');
   if(e.attempts.some(a=>a.key===requestKey))throw new CostGuardError('이미 시도한 동일 유료 요청: 자동 재시도 금지');
   if(e.attempts.length>=e.maxCalls)throw new CostGuardError('실험 최대 API 호출 횟수 초과');
   const prior=e.attempts.reduce((sum,a)=>sum+exposure(l.reservations.find(r=>r.id===a.reservationId)!),0);
   if(prior+requested>e.capMicros)throw new CostGuardError('실험 비용 노출 상한 초과');
   const id=this.allocate(l,kind,requested,experimentId,now);
   e.attempts.push({key:requestKey,reservationId:id});
   return id;
  });
 }
 private allocate(l:Ledger,kind:Kind,requested:number,sessionId:string,now:Date){
   const today=day(now.toISOString());const active=l.reservations.filter(r=>r.status==='RESERVED');
   if(l.reservations.some(r=>r.status==='SETTLED'&&r.measuredMicros>r.reservedMicros))throw new CostGuardError('예약 초과 정산 발견: 추가 유료 요청 차단');
   const limit=kind==='VOICE'?this.config.maxConcurrent:Math.max(2,this.config.maxConcurrent);
   if(active.filter(r=>r.kind===kind).length>=limit)throw new CostGuardError('동시 호출 제한');
   const total=l.legacyLiabilityMicros+l.reservations.reduce((a,r)=>a+exposure(r),0);
   const daily=l.reservations.filter(r=>day(r.openedAt)===today).reduce((a,r)=>a+exposure(r),0);
   const session=l.reservations.filter(r=>r.sessionId===sessionId).reduce((a,r)=>a+exposure(r),0);
   const cap=micros(Math.min(this.config.totalUsd,this.config.initialApprovedUsd));
   if(total+requested>cap||daily+requested>micros(this.config.dailyUsd)||session+requested>micros(this.config.sessionUsd))throw new CostGuardError('앱/일일/세션 예산 상한 초과');
   const id=sessionId+':'+randomUUID();l.reservations.push({id,sessionId,kind,reservedMicros:requested,openedAt:now.toISOString(),status:'RESERVED',measuredMicros:0,liabilityMicros:0});return id;
 }
 private transaction<T>(fn:(ledger:Ledger)=>T):T {
  const file=resolve(this.config.file);mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const lock=file+'.lock';let fd:number;
  try{fd=openSync(lock,'wx',0o600);}catch{throw new CostGuardError('예산 장부 잠김 또는 접근 불가: 유료 요청 차단');}
  try{
   let ledger=blank();try{ledger=parseLedger(JSON.parse(readFileSync(file,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new CostGuardError('장부 손상: 유료 요청 차단');}
   const result=fn(ledger);
   const temp=file+'.'+randomUUID()+'.tmp';
   try{writeFileSync(temp,JSON.stringify(ledger,null,2),{mode:0o600,flag:'wx'});renameSync(temp,file);}catch{try{unlinkSync(temp);}catch{}throw new CostGuardError('예산 장부 저장 실패');}
   return result;
  }finally{closeSync(fd!);unlinkSync(lock);}
 }
 reserve(kind:Kind,estimatedUsd:number,sessionId:string,now=new Date()):string {
  if(!this.config.liveEnabled||!this.config.spendApproved||this.config.killSwitch)throw new CostGuardError('사용 승인 없음 또는 Kill Switch 활성화');
  if(!['VOICE','SPARK'].includes(kind)||!/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)||!Number.isFinite(estimatedUsd)||estimatedUsd<=0)throw new CostGuardError('예약 입력 오류');
  const requested=micros(estimatedUsd*1.2+0.00001);
  return this.transaction(l=>this.allocate(l,kind,requested,sessionId,now));
 }
 settle(id:string,actualUsd?:number){
  return this.transaction(l=>{
   const r=l.reservations.find(x=>x.id===id);
   if(!r||r.status!=='RESERVED')throw new CostGuardError('예약을 찾을 수 없음 또는 중복 정산');
   if(actualUsd!==undefined){r.measuredMicros=micros(actualUsd);r.liabilityMicros=0;}
   else {r.measuredMicros=0;r.liabilityMicros=r.reservedMicros;}
   r.status='SETTLED';
  });
 }
 stats(now=new Date()){
  return this.transaction(l=>{
   const pending=l.reservations.filter(r=>r.status==='RESERVED').reduce((s,r)=>s+r.reservedMicros,0);
   const measured=l.reservations.reduce((s,r)=>s+r.measuredMicros,0);
   const liability=l.legacyLiabilityMicros+l.reservations.reduce((s,r)=>s+r.liabilityMicros,0);
   const today=day(now.toISOString());const total=measured+liability+pending;
   const overruns=l.reservations.filter(r=>r.status==='SETTLED'&&r.measuredMicros>r.reservedMicros).length;
   return {spentUsd:measured/1e6,measuredUsageUsd:measured/1e6,liabilityUsd:liability/1e6,pendingUsd:pending/1e6,exposureUsd:total/1e6,
    dailyUsd:l.reservations.filter(r=>day(r.openedAt)===today).reduce((s,r)=>s+exposure(r),0)/1e6,
    overrunCount:overruns,unsettled:l.reservations.filter(r=>r.status==='RESERVED').length,uncertain:l.reservations.filter(r=>r.liabilityMicros>0).length+(l.legacyLiabilityMicros>0?1:0),
    approvedCapUsd:Math.min(this.config.totalUsd,this.config.initialApprovedUsd),
    remainingApprovedUsd:Math.max(0,Math.min(this.config.totalUsd,this.config.initialApprovedUsd)-total/1e6),
    liveAllowed:this.config.liveEnabled&&this.config.spendApproved&&!this.config.killSwitch&&overruns===0&&liability===0&&pending===0&&total<=micros(Math.min(this.config.totalUsd,this.config.initialApprovedUsd))};
  });
 }
}
const envNumber=(name:string,fallback:number)=>{const v=process.env[name];const n=v===undefined?fallback:Number(v);return Number.isFinite(n)&&n>=0?n:0;};
export function serverCostGuard():CostGuard {
 return new CostGuard({file:resolve(process.cwd(),'.safecall-private','usage-ledger.json'),totalUsd:Math.min(110,envNumber('META_APP_TOTAL_CAP_USD',110)),
  initialApprovedUsd:Math.min(110,envNumber('META_INITIAL_APPROVED_CAP_USD',5)),dailyUsd:envNumber('META_DAILY_CAP_USD',5),sessionUsd:envNumber('META_SESSION_CAP_USD',1),
  maxConcurrent:1,killSwitch:process.env.META_BUDGET_KILL_SWITCH!=='false',liveEnabled:process.env.META_LIVE_ENABLED==='true',spendApproved:process.env.META_SPEND_APPROVED==='true'});
}
