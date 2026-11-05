/** v1.38 read-only synthetic benchmark, strictly prefix-only at each turn.
 * Evaluation labels are NEVER passed to Case Coordinator or to the classifier.
 */
import {createCase,applyCaseEvent,getCaseView} from '../case/index.ts';
import {deriveUnifiedTextAdvisory} from './semantic-v138.ts';
import type {TextCorpusCase} from './benchmark.ts';
export function evaluateSemanticCorpus(cases:ReadonlyArray<TextCorpusCase>){
 const seen=new Set<string>();const rows=[];
 for(const item of cases){
  if(!/^txt_[a-z0-9_]{2,90}$/.test(item.id)||seen.has(item.id)||item.turns.length<2||item.turns.length>12)throw new Error('INVALID_SEMANTIC_CORPUS');
  seen.add(item.id);
  let state=createCase('v138_'+item.id),firstWarningTurn:null|number=null;
  const timeline=[];
  for(const [i,t] of item.turns.entries()){
   if(t.text.length>600||!['caller','user','unknown'].includes(t.speaker))throw new Error('INVALID_SEMANTIC_TURN');
   state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:'evt_'+i,turnId:'line_'+i,revision:0,absoluteIndex:i,speaker:t.speaker,text:t.text});
   const prefix=item.turns.slice(0,i+1).map((row,k)=>({turnId:'line_'+k,speaker:row.speaker,text:row.text}));
   const view=getCaseView(state),advisory=deriveUnifiedTextAdvisory(prefix,{emergency:view.assessment.emergencyFlag});
   if(advisory.evidence.some(e=>e.turnIds.some(id=>!prefix.some(t=>t.turnId===id))))throw new Error('FUTURE_OR_FABRICATED_EVIDENCE');
   const warned=view.assessment.riskBand==='HIGH'||advisory.level!=='NONE';
   if(warned&&firstWarningTurn===null)firstWarningTurn=i+1;
   timeline.push({turn:i+1,riskIndex:view.assessment.riskIndex,band:view.assessment.riskBand,
     advisory:advisory.level,codes:advisory.evidence.map(e=>e.code),
     evidenceIds:[...new Set(advisory.evidence.flatMap(e=>e.turnIds))],warned,
     modelCalled:false,financialAction:false});
  }
  rows.push({id:item.id,category:item.category,pattern:item.pattern,
   firstWarningTurn,detected:firstWarningTurn!==null,totalTurns:item.turns.length,
   status:item.category==='AMBIGUOUS'?'REVIEW_NEEDED':
    ((item.category==='FRAUD_PATTERN')===(firstWarningTurn!==null)?'PASS':'GAP'),timeline});
 }
 const positive=rows.filter(r=>r.category==='FRAUD_PATTERN'),negative=rows.filter(r=>r.category==='NORMAL');
 const tp=positive.filter(r=>r.detected).length,fn=positive.length-tp;
 const fp=negative.filter(r=>r.detected).length,tn=negative.length-fp;
 return {mode:'OFFLINE_SYNTHETIC_TEXT_SEMANTIC_V138',modelCalled:false,actualStt:false,noAutomaticFinancialAction:true,
  reliability:'NOT_REAL_WORLD_VALIDATED',
  summary:{cases:rows.length,positives:positive.length,negatives:negative.length,ambiguous:rows.length-positive.length-negative.length,
   tp,fn,fp,tn,syntheticRecall:tp+fn?tp/(tp+fn):null,syntheticFalsePositiveRate:fp+tn?fp/(fp+tn):null},rows};
}
