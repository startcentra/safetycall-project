/** Reference-only STT error measurement. No model calls, audio files or raw transcripts logged.
 * Korean whitespace-based WER is supplementary; grapheme-level CER is primary.
 */
export type EvalLanguage='ko-KR'|'en-US';
export interface EvaluationPair {id:string;language:EvalLanguage;reference:string;hypothesis:string;independentlyLabeled:true}
export interface EvaluationSummary {
 sampleCount:number;referenceWords:number;wordErrors:number;WER:number|null;
 referenceCharacters:number;characterErrors:number;CER:number|null;
 byLanguage:Record<EvalLanguage,{samples:number;WER:number|null;CER:number|null}>;
 incompleteReferenceCount:number;
}
const words=(text:string)=>text.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/\s+/gu,' ').split(' ').filter(Boolean);
const chars=(text:string)=>Array.from(text.normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu,' ').trim());
export function editDistance<T>(a:readonly T[],b:readonly T[]):number{
 const row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  let prev=row[0];row[0]=i;
  for(let j=1;j<=b.length;j++){
   const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old;
  }
 }
 return row[b.length];
}
export function evaluateTranscripts(pairs:readonly EvaluationPair[]):EvaluationSummary{
 if(!Array.isArray(pairs)||pairs.length>1000)throw new Error('invalid dataset size');
 const items:readonly EvaluationPair[]=pairs;
 const seen=new Set<string>();
 const total={samples:0,wr:0,we:0,cr:0,ce:0};
 const group:{[k in EvalLanguage]:typeof total}={'ko-KR':{...total},'en-US':{...total}};
 let incomplete=0;
 for(const p of items){
  if(!p||typeof p.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(p.id)||seen.has(p.id)||
    !['ko-KR','en-US'].includes(p.language)||p.independentlyLabeled!==true||
    typeof p.reference!=='string'||typeof p.hypothesis!=='string'||p.reference.length>1500||p.hypothesis.length>1500)
    throw new Error('invalid independent test pair');
  seen.add(p.id);
  if(!p.reference.trim()){incomplete++;continue;}
  const refWords=words(p.reference),hypWords=words(p.hypothesis),refChars=chars(p.reference),hypChars=chars(p.hypothesis);
  const target=group[p.language];
  for(const t of [total,target]){t.samples++;t.wr+=refWords.length;t.we+=editDistance(refWords,hypWords);t.cr+=refChars.length;t.ce+=editDistance(refChars,hypChars);}
 }
 const rate=(n:number,d:number)=>d>0?n/d:null;
 return {sampleCount:total.samples,referenceWords:total.wr,wordErrors:total.we,WER:rate(total.we,total.wr),
   referenceCharacters:total.cr,characterErrors:total.ce,CER:rate(total.ce,total.cr),
   byLanguage:{'ko-KR':{samples:group['ko-KR'].samples,WER:rate(group['ko-KR'].we,group['ko-KR'].wr),CER:rate(group['ko-KR'].ce,group['ko-KR'].cr)},
    'en-US':{samples:group['en-US'].samples,WER:rate(group['en-US'].we,group['en-US'].wr),CER:rate(group['en-US'].ce,group['en-US'].cr)}},
   incompleteReferenceCount:incomplete};
}
