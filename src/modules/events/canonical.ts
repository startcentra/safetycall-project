/** v1.32 local-only canonical event envelope. Case Coordinator remains authoritative.
 * Metadata only; do not put transcript, audio, keys, exact GPS or PII in this audit projection.
 */
export type DemoSource='SCRIPTED_MOCK'|'SPARSE_CAPTION_OBSERVATION_NOT_STT'|'LOCAL_STT_HUMAN_REVIEWED'|'MOCK_TRANSCRIPT_FIXTURE'|'META_STREAMING_STT';
export type EventKind='UTTERANCE_FINAL'|'UTTERANCE_RETRACT';
export type CanonicalEvent=Readonly<{
 schemaVersion:1;caseId:string;eventId:string;turnId:string;sequence:number;
 kind:EventKind;source:DemoSource;speaker:'caller'|'user'|'unknown';
 revision:number;startMs:number;endMs:number;recordedAt:string;
 status:'HUMAN_REVIEWED'|'CAPTION_ONLY'|'SCRIPTED_DEMO'|'MOCK_FIXTURE'|'ASR_FINAL';
}>;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
export function makeCanonicalEvent(v:Omit<CanonicalEvent,'schemaVersion'|'recordedAt'>):CanonicalEvent{
 if(!v||!ID.test(v.caseId)||!ID.test(v.eventId)||!ID.test(v.turnId)||
 !Number.isSafeInteger(v.sequence)||v.sequence<0||v.sequence>=80||
 !Number.isSafeInteger(v.revision)||v.revision<0||
 !Number.isSafeInteger(v.startMs)||!Number.isSafeInteger(v.endMs)||v.startMs<0||v.endMs<v.startMs||v.endMs>3600000||
 !['caller','user','unknown'].includes(v.speaker)||
 !['UTTERANCE_FINAL','UTTERANCE_RETRACT'].includes(v.kind)||
 !['SCRIPTED_MOCK','SPARSE_CAPTION_OBSERVATION_NOT_STT','LOCAL_STT_HUMAN_REVIEWED','MOCK_TRANSCRIPT_FIXTURE','META_STREAMING_STT'].includes(v.source)||
 !['HUMAN_REVIEWED','CAPTION_ONLY','SCRIPTED_DEMO','MOCK_FIXTURE','ASR_FINAL'].includes(v.status))throw new Error('INVALID_CANONICAL_EVENT');
 if(v.source==='LOCAL_STT_HUMAN_REVIEWED'&&v.status!=='HUMAN_REVIEWED'||
    v.source==='SPARSE_CAPTION_OBSERVATION_NOT_STT'&&v.status!=='CAPTION_ONLY'||
    v.source==='MOCK_TRANSCRIPT_FIXTURE'&&v.status!=='MOCK_FIXTURE'||
    v.source==='META_STREAMING_STT'&&v.status!=='ASR_FINAL')throw new Error('INVALID_EVENT_PROVENANCE');
 return Object.freeze({...v,schemaVersion:1 as const,recordedAt:new Date().toISOString()});
}
