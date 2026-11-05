/** SafeCall v1.31: an OFFLINE, CAPTION-ONLY, sparse observational benchmark.
 * Not ASR, realtime interception, fraud certainty or a transaction policy.
 * Retains the existing risk-triage engine without reweighting it.
 */
import {assessTriage, type TriageTurn} from '../risk-triage/index.ts';

export type CaptionObservation = Readonly<{observedAtMs:number;speaker:'caller'|'user'|'unknown';text:string}>;
export type VideoFixture = Readonly<{id:string;durationMs:number;observations:readonly CaptionObservation[]}>;
export type ContextSignal = 'NAVIGATION_PROMPT' | 'CRIME_INVOLVEMENT_CLAIM' | 'PERSONAL_DATA_SOLICITATION';
export type ContextEvidence = Readonly<{code:ContextSignal;observedAtMs:number;observationIndex:number;excerpt:string}>;
export type BenchmarkCheckpoint = Readonly<{
 atMs:number;observationCount:number;riskIndex:number;riskBand:'LOW'|'CAUTION'|'HIGH';
 existingSignals:readonly string[];contextEvidence:readonly ContextEvidence[];
 protection:'NO_AUTO_ACTION'|'VERIFY_OFFICIAL_CHANNEL';
 mode:'SPARSE_CAPTION_OBSERVATION_NOT_STT';
}>;

const MAX_TEXT=800,MAX_OBS=500;
const negatedOrQuoted=(s:string)=>/(?:하지\s?마|하지\s?마세요|알려\s?주지\s?마|말씀\s?하지\s?마|하면\s?안\s?됩|보이스피싱\s?(?:예방|교육|사례)|교육\s?영상|주의하|경고하|따르지\s?마)/i.test(s);
export function extractContextEvidence(rows:readonly CaptionObservation[]):ContextEvidence[]{
 const out:ContextEvidence[]=[];
 rows.forEach((row,idx)=>{
  if(row.speaker!=='caller')return;
  const normalized=row.text.normalize('NFKC').replace(/\s+/g,' ').trim();
  if(negatedOrQuoted(normalized))return;
  const matches:Array<[ContextSignal,RegExp]>=[
   ['NAVIGATION_PROMPT',/(?:인터넷\s?주소창|주소창에|사이트에\s?접속|웹사이트에\s?접속|https?:\/\/|(?:[a-z0-9-]+\.)+(?:kr|com|net|org)\b).{0,100}(?:입력|들어가|접속|지우|조회)|(?:입력|접속|들어가).{0,40}(?:주소창|사이트)/i],
   ['CRIME_INVOLVEMENT_CLAIM',/(?:본인|명의|고객|당신).{0,70}(?:범죄|대포\s?통장|불법|명의\s?도용)|(?:범죄|대포\s?통장).{0,70}(?:연루|사용|개설)/i],
   ['PERSONAL_DATA_SOLICITATION',/(?:주민등록번호|계좌번호|통장\s?비밀번호|신분증|개인정보).{0,50}(?:알려|말씀해|입력해|보내|읽어|제공해)/i],
  ];
  for(const [code,re] of matches){if(re.test(normalized))out.push({code,observedAtMs:row.observedAtMs,observationIndex:idx,excerpt:normalized.slice(0,180)});}
 });
 return out;
}
export function validateVideoFixture(v:VideoFixture):void{
 if(!v||typeof v.id!=='string'||!/^[-a-z0-9]{1,80}$/.test(v.id)||!Number.isSafeInteger(v.durationMs)||v.durationMs<5000||v.durationMs>3600000||!Array.isArray(v.observations)||v.observations.length>MAX_OBS)throw Error('INVALID_FIXTURE');
 let previous=-1;
 for(const o of v.observations){if(!o||!Number.isSafeInteger(o.observedAtMs)||o.observedAtMs<0||o.observedAtMs>v.durationMs||o.observedAtMs<=previous||!['caller','user','unknown'].includes(o.speaker)||typeof o.text!=='string'||!o.text.trim()||o.text.length>MAX_TEXT)throw Error('INVALID_OBSERVATION');previous=o.observedAtMs;}
}
/** No peekahead: each checkpoint sees only observations at or before the cutoff. */
export function evaluateCaptionTimeline(v:VideoFixture,stepMs=5000,endMs=v.durationMs):BenchmarkCheckpoint[]{
 validateVideoFixture(v);
 if(!Number.isSafeInteger(stepMs)||stepMs<1000||stepMs>10000||!Number.isSafeInteger(endMs)||endMs<0||endMs>v.durationMs)throw Error('INVALID_WINDOW');
 const output:BenchmarkCheckpoint[]=[];
 for(let atMs=stepMs;atMs<=endMs;atMs+=stepMs){
  const rows=v.observations.filter(o=>o.observedAtMs<=atMs);
  const turns:TriageTurn[]=rows.map(o=>({speaker:o.speaker,text:o.text}));
  const risk=assessTriage({turns});
  const contextEvidence=extractContextEvidence(rows);
  const needsVerify=contextEvidence.some(e=>e.code==='NAVIGATION_PROMPT'||e.code==='CRIME_INVOLVEMENT_CLAIM')||risk.riskBand!=='LOW';
  output.push({atMs,observationCount:rows.length,riskIndex:risk.riskIndex,riskBand:risk.riskBand,
   existingSignals:risk.signals.map(s=>s.code),contextEvidence,protection:needsVerify?'VERIFY_OFFICIAL_CHANNEL':'NO_AUTO_ACTION',mode:'SPARSE_CAPTION_OBSERVATION_NOT_STT'});
 }
 return output;
}
