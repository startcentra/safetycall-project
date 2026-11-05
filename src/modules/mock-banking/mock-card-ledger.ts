/** Fictional card toggle, independent of transfer ledger. No PAN, account or real bank link. */
export type MockCardStatus='ACTIVE'|'LOCKED';
export type MockCardState=Readonly<{
  caseId:string;cardRef:'DEMO_CARD_1';status:MockCardStatus;revision:number;
  processed:readonly Readonly<{id:string;fingerprint:string}>[];
  activity:readonly Readonly<{commandId:string;action:'LOCK'|'UNLOCK';revision:number}>[];
}>;
export type MockCardCommand=Readonly<{
  id:string;caseId:string;cardRef:'DEMO_CARD_1';action:'LOCK'|'UNLOCK';
  expectedRevision:number;userConfirmed:boolean;caseOpen:boolean;
}>;
export type MockCardResult=Readonly<{state:MockCardState;applied:boolean;reason:'APPLIED'|'DUPLICATE'|'CONFLICT'|'STALE'|'INVALID'|'CONSENT_REQUIRED'|'CASE_ENDED'|'NO_CHANGE'}>;
const idOk=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
export function createMockCardState(caseId:string):MockCardState {
  if(!idOk(caseId))throw new Error('Invalid fictional card case ID');
  return {caseId,cardRef:'DEMO_CARD_1',status:'ACTIVE',revision:0,processed:[],activity:[]};
}
function fingerprint(cmd:MockCardCommand){return JSON.stringify([cmd.caseId,cmd.cardRef,cmd.action,cmd.expectedRevision,cmd.userConfirmed,cmd.caseOpen]);}
export function applyMockCardCommand(state:MockCardState,cmd:MockCardCommand):MockCardResult {
  const deny=(reason:MockCardResult['reason']):MockCardResult=>({state,applied:false,reason});
  if(!cmd||!idOk(cmd.id)||!idOk(cmd.caseId)||cmd.cardRef!=='DEMO_CARD_1'||!['LOCK','UNLOCK'].includes(cmd.action)||
    !Number.isSafeInteger(cmd.expectedRevision)||cmd.expectedRevision<0)return deny('INVALID');
  const previous=state.processed.find(p=>p.id===cmd.id);
  if(previous)return deny(previous.fingerprint===fingerprint(cmd)?'DUPLICATE':'CONFLICT');
  if(cmd.caseId!==state.caseId||cmd.expectedRevision!==state.revision)return deny('STALE');
  if(state.processed.length>=120)return deny('INVALID'); // bounded in-memory idempotency ledger
  if(!cmd.caseOpen)return deny('CASE_ENDED');
  if(cmd.userConfirmed!==true)return deny('CONSENT_REQUIRED');
  if((cmd.action==='LOCK'&&state.status==='LOCKED')||(cmd.action==='UNLOCK'&&state.status==='ACTIVE'))return deny('NO_CHANGE');
  const revision=state.revision+1;
  return {applied:true,reason:'APPLIED',state:{...state,status:cmd.action==='LOCK'?'LOCKED':'ACTIVE',revision,
    processed:[...state.processed,{id:cmd.id,fingerprint:fingerprint(cmd)}],
    activity:[...state.activity,{commandId:cmd.id,action:cmd.action,revision}]}};
}
