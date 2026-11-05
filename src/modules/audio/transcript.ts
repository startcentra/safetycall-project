/** Streaming ASR state. Final transcript is never silently truncated.
 * A complete event without speechStart is accepted because upstream event ordering
 * is not guaranteed; it is recorded as a recovered event, not as a verified sequence.
 */
export type VoiceEvent = {type:string;turnId?:number;transcript?:string;final?:boolean;audioProcessedMs?:number;label?:string;revision?:number};
export type SpeakerRole = 'caller'|'user'|'unknown'|'multiple';
export type VoiceTurn = {turnId:string;text:string;audioProcessedMs:number;speaker:'unknown';recovered:boolean;revision?:number};
export interface VoiceAccumulator {partial:string;activeId:number|null;finalized:VoiceTurn[];seenIds:string[];warnings:string[];openedIds:number[];}
export function emptyVoiceState():VoiceAccumulator {return {partial:'',activeId:null,finalized:[],seenIds:[],warnings:[],openedIds:[]};}
const validId=(x:unknown):x is number=>Number.isSafeInteger(x)&&(x as number)>=0;
const MAX_TEXT=100_000;
export function applyVoiceEvent(state:VoiceAccumulator,event:VoiceEvent):VoiceAccumulator {
 const next:VoiceAccumulator={...state,finalized:[...state.finalized],seenIds:[...state.seenIds],warnings:[...state.warnings],openedIds:[...state.openedIds]};
 if(event.type==='speechStart' && validId(event.turnId)) {
   if(!next.openedIds.includes(event.turnId))next.openedIds.push(event.turnId);
   next.activeId=event.turnId;next.partial='';
 }
 if(event.type==='transcript' && next.activeId!==null && typeof event.transcript==='string') {
   if(event.transcript.length>MAX_TEXT){next.partial='';next.warnings.push('부분 전사 길이 초과: 분석 미완료');}
   else next.partial=event.transcript;
 }
 // Local correction hook: explicit revision required; not a claim that Meta emits this event.
 if(event.type==='speechCorrection' && validId(event.turnId) && typeof event.transcript==='string') {
   const id='asr-'+event.turnId;
   const old=next.finalized.find(v=>v.turnId===id);
   const revision=event.revision;
   if(!old||!Number.isSafeInteger(revision)||(revision as number)<=0||(revision as number)<=(old.revision??0))return next;
   const text=event.transcript.trim();
   if(!text||text.length>MAX_TEXT){next.warnings.push('정정 전사 길이/내용 오류: 이전 완료 유지');return next;}
   next.finalized=next.finalized.map(v=>v.turnId===id?{...v,text,revision}:v);
   next.warnings.push('명시적 정정 발화 적용: 기존 위험 근거 재평가 필요');
   return next;
 }
 if(event.type==='speechComplete' && validId(event.turnId) && typeof event.transcript==='string') {
   const id='asr-'+event.turnId;
   if(next.seenIds.includes(id))return next;
   const text=event.transcript.trim();
   if(text.length>MAX_TEXT){next.warnings.push('완료 전사 길이 초과: 분석 미완료');return next;}
   const recovered=!next.openedIds.includes(event.turnId);
   if(recovered)next.openedIds.push(event.turnId);
   if(recovered)next.warnings.push('시작 정보 없는 완료 발화: 순서 복구 기록');
   const ms=event.audioProcessedMs;
   const validMs=typeof ms==='number'&&Number.isFinite(ms)&&ms>=0?ms:0;
   if(ms!==undefined && validMs===0 && ms!==0)next.warnings.push('잘못된 음성 시간 정보');
   if(text){next.seenIds.push(id);next.finalized.push({turnId:id,text,audioProcessedMs:validMs,speaker:'unknown',recovered});
     // A later turn can open before an earlier turn's final arrives. Preserve speechStart order.
     next.finalized.sort((a,b)=>next.openedIds.indexOf(Number(a.turnId.slice(4)))-next.openedIds.indexOf(Number(b.turnId.slice(4))));}
   if(next.activeId===event.turnId){next.activeId=null;next.partial='';}
 }
 return next;
}
