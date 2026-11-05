/** Explicitly consented, local MOCK transcript fixture ingestion. NO microphone or STT.
 * A provider can later produce these events only after separate source authentication,
 * consent, quality checks and real audio/privacy review. Never trust LLM supplied events.
 */
import {applyCaseEvent, type CaseState} from '../case/index.ts';
import {applyFixtureUtterance} from './evidence-fixture.ts';

export type VoiceFixtureCommand=Readonly<{
  source:'MOCK_ASR_FIXTURE';consented:true;operation:'INTERIM'|'FINAL'|'RETRACT';
  turnId:string;revision:number; speaker?:'caller'|'user'|'unknown';
  text?:string;quality?:'OK'|'UNCERTAIN'|'LOW_QUALITY';
}>;
const TURN=/^voice_[a-zA-Z0-9_-]{1,48}$/;
const OWN_KEYS=new Set(['source','consented','operation','turnId','revision','speaker','text','quality']);
export class FixtureValidationError extends Error{constructor(message:string){super(message);this.name='FixtureValidationError';}}
export function validateFixtureCommand(value:unknown):VoiceFixtureCommand{
  const fail=(message:string):never=>{throw new FixtureValidationError(message);};
  if(!value||typeof value!=='object'||Array.isArray(value))return fail('fixture object required');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!OWN_KEYS.has(k))||v.source!=='MOCK_ASR_FIXTURE'||v.consented!==true||
     !['INTERIM','FINAL','RETRACT'].includes(String(v.operation))||typeof v.turnId!=='string'||!TURN.test(v.turnId)||
     !Number.isSafeInteger(v.revision)||(v.revision as number)<0||(v.revision as number)>1000)return fail('invalid fixture metadata or consent');
  if(v.operation==='RETRACT'){
    if(v.speaker!==undefined||v.text!==undefined||v.quality!==undefined)return fail('retraction must not carry transcript or speaker');
  }else {
    if(!['caller','user','unknown'].includes(String(v.speaker))||typeof v.text!=='string'||v.text.trim().length===0||v.text.length>800||
      !['OK','UNCERTAIN','LOW_QUALITY'].includes(String(v.quality)))return fail('invalid mock transcript, speaker or quality');
  }
  return v as VoiceFixtureCommand;
}
export function applyValidatedFixture(state:CaseState, raw:unknown):{state:CaseState;status:'IGNORED_INTERIM'|'IGNORED_QUALITY'|'APPLIED_FINAL'|'APPLIED_RETRACT'|'REPLAY';turnId:string}{
  const event=validateFixtureCommand(raw);
  const old=state.checkpoint.turns.find(t=>t.turnId===event.turnId);
  if(event.operation==='INTERIM')return {state,status:'IGNORED_INTERIM',turnId:event.turnId};
  if(event.operation==='FINAL'&& (event.quality!=='OK'||event.speaker==='unknown'))return {state,status:'IGNORED_QUALITY',turnId:event.turnId};
  if(event.operation==='RETRACT'&&!old)throw new FixtureValidationError('retraction of unknown fixture turn');
  if(old&&event.revision<old.revision)throw new FixtureValidationError('stale fixture revision');
  // Same revision with different text is intentionally rejected by the case event ledger.
  const id=`v128_${event.turnId}_${event.revision}_${event.operation}`;
  const next=event.operation==='RETRACT'
    ?applyCaseEvent(state,{type:'UTTERANCE_RETRACT',caseId:state.caseId,eventId:id,turnId:event.turnId,revision:event.revision})
    :applyFixtureUtterance(state,{source:'MOCK_ASR_FIXTURE',caseId:state.caseId,eventId:id,turnId:event.turnId,
      index:old?.absoluteIndex??Math.max(-1,...state.checkpoint.turns.map(t=>t.absoluteIndex))+1,
      revision:event.revision,speaker:event.speaker!,text:event.text!,final:true,quality:'OK'});
  return {state:next,status:next===state?'REPLAY':event.operation==='RETRACT'?'APPLIED_RETRACT':'APPLIED_FINAL',turnId:event.turnId};
}
