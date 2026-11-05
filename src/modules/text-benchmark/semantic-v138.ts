/** v1.38 deterministic semantic-intent adapter for SYNTHETIC text.
 * Read-only, evidence-grounded, with no network/model/bank/card/SMS access.
 * This is a safety heuristic, NOT a validated language understanding model.
 */
import {deriveTextAdvisory,type TextAdvisory,type AdvisoryEvidence,type TextAdvisoryLevel} from './advisory.ts';

export type NormalizationStep='NFKC'|'INVISIBLE'|'COMPAT_JAMO'|'TYPO_ALIAS'|'SPACE_FOLD';
export type SpeechAct='PAYMENT_REDIRECT'|'SENSITIVE_ID_COLLECTION'|'VERIFICATION_TRANSFER'|'CREDENTIAL_DISCLOSURE';
export type SpeechContext='DIRECT_REQUEST'|'NEGATED'|'QUOTED_EDUCATIONAL'|'UNRESOLVED';
export type SemanticObservation=Readonly<{
 code:string;action:SpeechAct;target:'FUNDS'|'IDENTITY'|'ONE_TIME_CODE';
 context:'DIRECT_REQUEST';turnIds:string[];normalization:NormalizationStep[];
 intent:'REQUEST';evidenceSource:'OBSERVED_CALLER_TEXT';
}>;
export type SemanticProjection=Readonly<{
 mode:'LOCAL_SEMANTIC_HEURISTIC_V138';observations:SemanticObservation[];
 modelCalled:false;probability:null;financialExecutionAllowed:false;
}>;
export type SemanticInput=Readonly<{turnId:string;speaker:string;text:string}>;

const COMPAT_L=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const COMPAT_V=['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const COMPAT_T=['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
/** Only recompose compatibility jamo when a valid syllable L+V exists.
 * Invalid/isolated jamo are preserved; their meaning is never invented.
 */
function composeJamo(input:string):string {
 let result='';
 for(let i=0;i<input.length;){
  const l=COMPAT_L.indexOf(input[i]),v=COMPAT_V.indexOf(input[i+1]);
  if(l<0||v<0){result+=input[i++];continue;}
  let t=0,step=2;
  const c=input[i+2];
  if(c){const ending=COMPAT_T.indexOf(c);
   // If the next jamo can begin another syllable, do not consume it as a final.
   if(ending>0&&COMPAT_V.indexOf(input[i+3])<0){t=ending;step=3;}
  }
  result+=String.fromCharCode(0xac00+(l*21+v)*28+t);i+=step;
 }
 return result;
}
const TYPO:ReadonlyArray<readonly [RegExp,string]>=[
 [/검챨/g,'검찰'],[/송끔/g,'송금'],[/입끔/g,'입금'],[/인쯩/g,'인증'],[/카두/g,'카드']
];
export function canonicalizeText(raw:string):Readonly<{text:string;steps:NormalizationStep[]}> {
 if(typeof raw!=='string'||raw.length>1600)throw new Error('SEMANTIC_TEXT_BOUNDARY');
 const steps:NormalizationStep[]=[];let text=raw;
 const noInvisible=text.replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g,'');
 if(noInvisible!==text){text=noInvisible;steps.push('INVISIBLE');}
 // NFKC converts compatibility jamo to conjoining jamo. Compose L+V(+T)
 // BEFORE NFKC, otherwise e.g. ㅅㅗㅇㄱㅡㅁ becomes 소ᄋ그ᄆ.
 const recomposed=composeJamo(text);if(recomposed!==text){text=recomposed;steps.push('COMPAT_JAMO');}
 const nk=text.normalize('NFKC');if(nk!==text){text=nk;steps.push('NFKC');}
 for(const [pattern,replacement] of TYPO){const next=text.replace(pattern,replacement);if(next!==text){text=next;if(!steps.includes('TYPO_ALIAS'))steps.push('TYPO_ALIAS');}}
 const cleaned=text.replace(/\s+/gu,' ').trim().toLowerCase();
 if(cleaned!==text&&/\s{2,}|\n|\r|\t/.test(text))steps.push('SPACE_FOLD');
 return {text:cleaned,steps};
}
function splitClauses(text:string):string[]{
 // Unlike full-utterance suppression, later imperatives following "대신" remain visible.
 return text.split(/(?:[.!?。！？]+\s*|\n+|\s*(?=대신\s|하지만\s|그런데\s|however\s|instead\s))/iu)
  .map(x=>x.trim()).filter(Boolean).slice(0,20);
}
function classifyContext(clause:string):SpeechContext {
 const educational=/(?:사기범|범인|사례|교육|예방|뉴스|보도|인용|피싱|스미싱|\bexample\b|\beducational\b)/iu.test(clause)
  &&/(?:라고|라며|했다고|했다는|예를|사례|교육|예방|\bexample\b|\beducational\b)/iu.test(clause);
 if(educational)return 'QUOTED_EDUCATIONAL';
 const negated=/(?:하지\s*마|하지\s*않|요구하지\s*않|하지\s*말|금지|금해야|거절|절대\s*(?:보내|송금|입금|공유|입력|알려)|\bnever\b|\bdo\s+not\b|\bdon't\b|\bnot\s+to\b)/iu.test(clause);
 return negated?'NEGATED':'DIRECT_REQUEST';
}
const paymentImperative=/(?:송금|이체|입금|전송|보내).{0,18}(?:하세요|하셔야|해야\s*(?:합니다|해요)|하십시오|해\s*주세요|해줘|해라|주시겠|하라)|(?:송금|이체|입금)\s*하(?:기|시면)\s*바랍/iu;
const englishTransfer=/(?:\b(?:transfer|move|send|wire)\b.{0,50}\b(?:funds|money|balance|savings)\b|\b(?:funds|money)\b.{0,30}\b(?:transfer|move|send|wire)\b)/iu;
const identityField=/(?:주민\s*등록\s*번호|주민\s*번호|신분증|여권\s*번호|social\s+security\s+number|\bssn\b)/iu;
const inputVerb=/(?:작성|기입|입력|제출|등록|업로드|올려|적어|보내|enter|provide|submit|upload)/iu;
const qrMarker=/(?:\bqr\b|qr\s*코드|큐알|초대장|청첩장)/iu;
const requestSixDigits=/(?:여섯\s*자리|6\s*자리|인증\s*코드|verification\s*code|one.time\s*code)/iu;
const readBack=/(?:불러|읽어|말해|알려|전달|send|tell|read\s*out|share)/iu;

export function extractTextSemantics(turns:ReadonlyArray<SemanticInput>):SemanticProjection {
 if(turns.length>256)throw new Error('SEMANTIC_TURN_LIMIT');
 const obs:SemanticObservation[]=[];
 const seen=new Set<string>();
 const recent:{turnId:string;text:string;steps:NormalizationStep[]}[]=[];
 const add=(code:string,action:SpeechAct,target:SemanticObservation['target'],ids:string[],steps:NormalizationStep[])=>{
  const uniqueIds=[...new Set(ids)];const key=code+'|'+uniqueIds.join('|');
  if(seen.has(key))return;seen.add(key);
  obs.push({code,action,target,context:'DIRECT_REQUEST',turnIds:uniqueIds,normalization:[...new Set(steps)],intent:'REQUEST',evidenceSource:'OBSERVED_CALLER_TEXT'});
 };
 for(const turn of turns){
  if(turn.speaker!=='caller'||!turn.turnId||typeof turn.text!=='string')continue;
  const normalized=canonicalizeText(turn.text);
  for(const clause of splitClauses(normalized.text)){
   if(classifyContext(clause)!=='DIRECT_REQUEST')continue;
   const recentContext=[...recent.slice(-3),{turnId:turn.turnId,text:clause,steps:normalized.steps}];
   const contextText=recentContext.map(r=>r.text).join(' ');
   const allSteps=recentContext.flatMap(r=>r.steps);
   if(qrMarker.test(contextText)&&identityField.test(clause)&&inputVerb.test(clause)){
    const other=recentContext.filter(r=>r.turnId!==turn.turnId&&qrMarker.test(r.text));
    add('QR_IDENTITY_COLLECTION','SENSITIVE_ID_COLLECTION','IDENTITY',[...other.map(r=>r.turnId),turn.turnId],allSteps);
   }
   if(englishTransfer.test(clause)&&/(?:verification\s+wallet|secure\s+(?:account|wallet)|tax\s+office|investigator)/iu.test(contextText)){
    const others=recentContext.filter(r=>r.turnId!==turn.turnId&&/(?:investigator|tax\s+office|government)/iu.test(r.text));
    add('ENGLISH_VERIFICATION_TRANSFER','VERIFICATION_TRANSFER','FUNDS',[...others.map(r=>r.turnId),turn.turnId],allSteps);
   }
   if((normalized.steps.includes('COMPAT_JAMO')||normalized.steps.includes('TYPO_ALIAS'))&&paymentImperative.test(clause)){
    add('OBFUSCATED_PAYMENT_DIRECTIVE','PAYMENT_REDIRECT','FUNDS',[turn.turnId],normalized.steps);
   }
   // A safe sentence followed by an independent contradictory payment command
   // must not be suppressed just because the full utterance began negatively.
   if(/^(?:대신|하지만|그러나|instead|however)/iu.test(clause)&&paymentImperative.test(clause)){
    add('CONTRADICTORY_PAYMENT_REQUEST','PAYMENT_REDIRECT','FUNDS',[turn.turnId],normalized.steps);
   }
   if(requestSixDigits.test(clause)&&readBack.test(clause)&&/(?:은행|보안|금융|bank|security)/iu.test(contextText)){
    add('ONE_TIME_CODE_READBACK','CREDENTIAL_DISCLOSURE','ONE_TIME_CODE',[turn.turnId],allSteps);
   }
  }
  recent.push({turnId:turn.turnId,text:normalized.text,steps:normalized.steps});
  if(recent.length>4)recent.shift();
 }
 return {mode:'LOCAL_SEMANTIC_HEURISTIC_V138',observations:obs.slice(0,32),modelCalled:false,probability:null,financialExecutionAllowed:false};
}

const ADVISORY_DETAIL:Record<string,string>={
 QR_IDENTITY_COLLECTION:'QR·초대장 이동과 신분정보 입력 요청이 결합되었습니다. 원본 발화와 별도 확인이 필요합니다.',
 ENGLISH_VERIFICATION_TRANSFER:'영어로 기관·검증 명분의 자금 이동을 요구하는 발화가 관찰되었습니다.',
 OBFUSCATED_PAYMENT_DIRECTIVE:'변형된 표기에서 자금 이동 지시가 관찰되었습니다. 정규화 추정이므로 독립 확인이 필요합니다.',
 ONE_TIME_CODE_READBACK:'인증용 다자리 숫자를 읽어 달라는 요청이 관찰되었습니다.',
 CONTRADICTORY_PAYMENT_REQUEST:'선행 부정·안내와 모순되는 새 송금 요청이 별도 문장에 나타났습니다.'
};
const semanticProtect=new Set(['ENGLISH_VERIFICATION_TRANSFER','ONE_TIME_CODE_READBACK']);
/** Single UI projection: legacy deterministic triage + supplemental advisory, never a new risk score. */
export function deriveUnifiedTextAdvisory(turns:ReadonlyArray<SemanticInput>,options:{emergency?:boolean}={}):TextAdvisory {
 const legacy=deriveTextAdvisory(turns,options);
 const semantic=extractTextSemantics(turns);
 const evidence:AdvisoryEvidence[]=[...legacy.evidence];
 for(const observation of semantic.observations){
  if(evidence.some(e=>e.code===observation.code))continue;
  evidence.push({code:observation.code,turnIds:observation.turnIds,detail:ADVISORY_DETAIL[observation.code]??'검토가 필요한 문맥 근거'});
 }
 const level:TextAdvisoryLevel=legacy.level==='PROTECT'||semantic.observations.some(x=>semanticProtect.has(x.code))?'PROTECT':
 legacy.level==='VERIFY'||semantic.observations.length?'VERIFY':'NONE';
 const guidance=options.emergency?legacy.guidance:level==='PROTECT'? '인증정보·송금·기기 접근 요청을 중단하고 상대방이 제공하지 않은 공식 연락처로 확인하세요.':
 level==='VERIFY'?'상대방이 제시한 링크나 번호를 이용하지 말고 공식 채널로 직접 확인하세요.':'확인된 추가 위험 근거가 없습니다. 안전하다는 보장은 아닙니다.';
 return {...legacy,level,evidence:evidence.slice(0,20),guidance};
}

/** Port contract exists for future approved Meta integration. It is deliberately OFF now. */
export interface TextSemanticAnalysisPort {
 readonly mode:'DISABLED'|'LOCAL_MOCK';
 analyze(turns:ReadonlyArray<SemanticInput>):Promise<SemanticProjection|{mode:'DISABLED';modelCalled:false;observations:[]}>;
}
export const disabledTextSemanticPort:TextSemanticAnalysisPort={mode:'DISABLED',
 async analyze(){return {mode:'DISABLED',modelCalled:false,observations:[]};}};
export const localMockTextSemanticPort:TextSemanticAnalysisPort={mode:'LOCAL_MOCK',
 async analyze(turns){return extractTextSemantics(turns);}};
