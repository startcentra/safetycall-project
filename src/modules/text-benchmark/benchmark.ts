/** Deterministic labeled evaluation. Labels are ONLY used here, never in live case policy.
 * Synthetic known-pattern cases do not establish real-world precision, recall, or safety.
 */
import {createCase,applyCaseEvent,getCaseView} from '../case/index.ts';
import {deriveTextAdvisory} from './advisory.ts';
export type TextCorpusCase={id:string;name:string;category:'FRAUD_PATTERN'|'NORMAL'|'AMBIGUOUS';sourceId:string;pattern:string;turns:Array<{speaker:'caller'|'user'|'unknown';text:string;cue:string}>};
export function evaluateTextCorpus(cases:ReadonlyArray<TextCorpusCase>){
 const seen=new Set<string>();const rows=[];
 for(const item of cases){
  if(!/^txt_[a-z0-9_]{2,60}$/.test(item.id)||seen.has(item.id)||item.turns.length<2||item.turns.length>12)throw new Error('INVALID_CORPUS_CASE');
  seen.add(item.id);let state=createCase('corpus_'+item.id);let firstWarningTurn:null|number=null;const timeline=[];
  for(const [i,turn] of item.turns.entries()){
   if(turn.text.length>600||!['caller','user','unknown'].includes(turn.speaker))throw new Error('INVALID_CORPUS_TURN');
   state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:'evt_'+i,turnId:'line_'+i,revision:0,absoluteIndex:i,speaker:turn.speaker,text:turn.text});
   const view=getCaseView(state),advisory=deriveTextAdvisory(item.turns.slice(0,i+1).map((t,k)=>({turnId:'line_'+k,speaker:t.speaker,text:t.text})),{emergency:view.assessment.emergencyFlag});
   const warned=view.assessment.riskBand==='HIGH'||advisory.level!=='NONE';
   if(warned&&firstWarningTurn===null)firstWarningTurn=i+1;
   timeline.push({turn:i+1,canonicalBand:view.assessment.riskBand,canonicalRiskIndex:view.assessment.riskIndex,advisoryLevel:advisory.level,advisoryCodes:advisory.evidence.map(x=>x.code),evidenceIds:[...new Set(advisory.evidence.flatMap(x=>x.turnIds))],warned,automaticFinancialAction:advisory.automaticFinancialAction});
  }
  const expectedPositive=item.category==='FRAUD_PATTERN';
  rows.push({id:item.id,name:item.name,category:item.category,sourceId:item.sourceId,pattern:item.pattern,firstWarningTurn,totalTurns:item.turns.length,detected:firstWarningTurn!==null,
   status:item.category==='AMBIGUOUS'?'REVIEW_NEEDED':(expectedPositive===(firstWarningTurn!==null)?'PASS':'GAP'),timeline});
 }
 const labeled=rows.filter(x=>x.category!=='AMBIGUOUS');const positive=labeled.filter(x=>x.category==='FRAUD_PATTERN');const normal=labeled.filter(x=>x.category==='NORMAL');
 const tp=positive.filter(x=>x.detected).length,fn=positive.length-tp,fp=normal.filter(x=>x.detected).length,tn=normal.length-fp;
 return {mode:'SYNTHETIC_TEXT_REPLAY_NO_AI',modelCalled:false,actualStt:false,source:'PUBLIC_PATTERN_INSPIRED_SYNTHETIC_FIXTURES',noAutomaticFinancialAction:true,
  summary:{cases:rows.length,labeled:labeled.length,positives:positive.length,negatives:normal.length,ambiguous:rows.length-labeled.length,tp,fn,fp,tn,
    syntheticPrecision:tp+fp?tp/(tp+fp):null,syntheticRecall:tp+fn?tp/(tp+fn):null,syntheticFalsePositiveRate:fp+tn?fp/(fp+tn):null},rows};
}
