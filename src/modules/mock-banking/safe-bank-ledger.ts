/** SafeBank local MOCK ledger. Never accepts card numbers, balances, payees or bank credentials. */
export type DemoBankStatus = 'READY'|'HELD'|'CANCELLED';
export type DemoBankState = Readonly<{
 caseId:string; caseVersion:number; revision:number; status:DemoBankStatus;
 processedIds:readonly string[]; processedCommands:readonly Readonly<{id:string;fingerprint:string}>[]; activity:readonly Readonly<{id:string;kind:'HOLD'|'CANCEL';revision:number}>[];
}>;
export type DemoBankCommand = Readonly<{
 id:string; type:'HOLD'|'CANCEL';caseId:string;caseVersion:number;expectedRevision:number;
 userConfirmed:boolean;caseOpen:boolean;
}>;
export type DemoBankResult = Readonly<{state:DemoBankState;applied:boolean;reason:'APPLIED'|'DUPLICATE'|'CONFLICT'|'INVALID'|'STALE'|'CLOSED'|'CONSENT_REQUIRED'|'NOT_HELD'}>;
const validId=(v:string)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
export function createDemoBankState(caseId:string,caseVersion:number):DemoBankState {
 if(!validId(caseId)||!Number.isSafeInteger(caseVersion)||caseVersion<0)throw new Error('invalid case identity');
 return {caseId,caseVersion,revision:0,status:'READY',processedIds:[],processedCommands:[],activity:[]};
}
/** Canonical fields represent the exact operation that was authorized, never client-side JSON ordering. */
export function bankCommandFingerprint(cmd:DemoBankCommand):string {
 return JSON.stringify([cmd.type,cmd.caseId,cmd.caseVersion,cmd.expectedRevision,cmd.userConfirmed,cmd.caseOpen]);
}
/** Case revisions are pinned. Any change of scenario, case, language context or evidence invalidates old commands. */
export function applyDemoBankCommand(state:DemoBankState,cmd:DemoBankCommand):DemoBankResult {
 const deny=(reason:DemoBankResult['reason']):DemoBankResult=>({state,applied:false,reason});
 if(!validId(cmd.id)||!validId(cmd.caseId)||!['HOLD','CANCEL'].includes(cmd.type)||
    !Number.isSafeInteger(cmd.caseVersion)||!Number.isSafeInteger(cmd.expectedRevision))return deny('INVALID');
 const recorded=state.processedCommands.find(item=>item.id===cmd.id);
 if(recorded)return deny(recorded.fingerprint===bankCommandFingerprint(cmd)?'DUPLICATE':'CONFLICT');
 // Reject legacy/inconsistent state rather than silently accepting an ambiguous replay.
 if(state.processedIds.includes(cmd.id))return deny('CONFLICT');
 if(cmd.caseId!==state.caseId||cmd.caseVersion!==state.caseVersion||cmd.expectedRevision!==state.revision)return deny('STALE');
 if(!cmd.caseOpen)return deny('CLOSED');
 if(cmd.userConfirmed!==true)return deny('CONSENT_REQUIRED');
 if(cmd.type==='CANCEL'&&state.status!=='HELD')return deny('NOT_HELD');
 if(cmd.type==='HOLD'&&state.status!=='READY')return deny('INVALID');
 const revision=state.revision+1;
 return {applied:true,reason:'APPLIED',state:{
   ...state,revision,status:cmd.type==='HOLD'?'HELD':'CANCELLED',
   processedIds:[...state.processedIds,cmd.id],
   processedCommands:[...state.processedCommands,{id:cmd.id,fingerprint:bankCommandFingerprint(cmd)}],
   activity:[...state.activity,{id:cmd.id,kind:cmd.type,revision}]
 }};
}
