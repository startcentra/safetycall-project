/** v1.34: server-authoritative limits for explicitly consented long-audio MOCK research.
 * This is NOT STT recognition, real-time interception, or permission to make financial calls.
 */
export const REPLAY_POLICY = Object.freeze({
 STANDARD_40S: Object.freeze({mode:'STANDARD_40S' as const,maxSegments:8,maxDurationMs:40_000,maxRequests:12}),
 EXTENDED_120S: Object.freeze({mode:'EXTENDED_120S' as const,maxSegments:24,maxDurationMs:120_000,maxRequests:32}),
});
export type ReplayMode = keyof typeof REPLAY_POLICY;
export function getReplayPolicy(mode: ReplayMode = 'STANDARD_40S') {
 if(!Object.hasOwn(REPLAY_POLICY,mode)) throw new Error('INVALID_REPLAY_POLICY');
 return REPLAY_POLICY[mode];
}
/** Opt-in must be a user-initiated server command on a pristine, open, ordinary benign demo case. */
export function mayEnableExtendedReplay(args:{scenarioId:string;step:number;endedAt:string|null;
 voiceMode:string;eventCount:number;localSegmentCount:number;captionActive:boolean;
 hasPending:boolean;inFlight:boolean;transcriptCount:number;hasCanonicalEvents:boolean}):boolean{
 return args.scenarioId==='benign'&&args.step===0&&!args.endedAt&&args.voiceMode==='SCRIPTED'&&
  args.eventCount===0&&args.localSegmentCount===0&&!args.captionActive&&!args.hasPending&&
  !args.inFlight&&args.transcriptCount===0&&!args.hasCanonicalEvents;
}
