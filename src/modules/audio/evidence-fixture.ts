/** Offline ASR *fixture* adapter; never claims to decode audio, use STT or identify a real voice. */
import {applyCaseEvent,type CaseState} from '../case/index.ts';
export type FixtureUtterance=Readonly<{
  source:'SCRIPTED_TEXT'|'MOCK_ASR_FIXTURE';caseId:string;eventId:string;turnId:string;
  index:number;revision:number;speaker:'caller'|'user'|'unknown';text:string;
  final:boolean;quality:'OK'|'UNCERTAIN'|'LOW_QUALITY';
}>;
export function applyFixtureUtterance(state:CaseState,segment:FixtureUtterance):CaseState {
  if(!segment||!['SCRIPTED_TEXT','MOCK_ASR_FIXTURE'].includes(segment.source)||
    !['caller','user','unknown'].includes(segment.speaker)||
    !['OK','UNCERTAIN','LOW_QUALITY'].includes(segment.quality)||
    !Number.isSafeInteger(segment.index)||segment.index<0||
    !Number.isSafeInteger(segment.revision)||segment.revision<0||
    typeof segment.text!=='string'||segment.text.length>2000)throw new Error('Invalid offline transcription fixture');
  if(!segment.final||segment.quality!=='OK'||segment.speaker==='unknown')return state;
  return applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:segment.caseId,eventId:segment.eventId,
    turnId:segment.turnId,revision:segment.revision,absoluteIndex:segment.index,
    speaker:segment.speaker,text:segment.text});
}
