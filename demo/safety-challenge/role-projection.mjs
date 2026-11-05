/** Only the minimum data necessary to render the mock-child page.
 * Never send transcripts, finance/recovery records, coaching, or case evidence to child role.
 */
export function projectForRole(state,role){
  if(role!=='child')return state;
  return {
    demoOnly:true, provider:'SCRIPTED_MOCK', metaCalled:false,
    realMoneySent:false,externalActionPerformed:false,
    runId:state.runId,version:state.version,endedAt:state.endedAt,
    verification:state.verification ? {
      requestId:state.verification.requestId,
      status:state.verification.status
    }:null
  };
}
