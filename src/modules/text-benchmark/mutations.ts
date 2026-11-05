/** Bounded, deterministic stress perturbations. No generative model, network or PII.
 * Transformations are designed to KEEP the original scenario label, not change its meaning.
 */
import type {TextCorpusCase} from './benchmark.ts';
export const MUTATIONS=['SPACING','ZERO_WIDTH','NO_SPACES','FULLWIDTH_ASCII','TYPO'] as const;
export type MutationName=typeof MUTATIONS[number];
export function mutateText(text:string,mode:MutationName):string{
 if(mode==='SPACING')return text.replace(/ /g,'   ');
 if(mode==='ZERO_WIDTH')return text.replace(/ /g,'\u200b ');
 if(mode==='NO_SPACES')return text.replace(/ /g,'');
 if(mode==='FULLWIDTH_ASCII')return text.replace(/[a-zA-Z0-9]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0));
 if(mode==='TYPO')return text.replace(/검찰|송금|입금|인증|카드/g,w=>({'검찰':'검챨','송금':'송끔','입금':'입끔','인증':'인쯩','카드':'카두'} as Record<string,string>)[w]);
 return text;
}
export function mutateCases(cases:ReadonlyArray<TextCorpusCase>,mode:MutationName):TextCorpusCase[]{
 return cases.map(c=>({...c,id:c.id+'_'+mode.toLowerCase(),turns:c.turns.map(t=>({...t,text:mutateText(t.text,mode)}))}));
}
