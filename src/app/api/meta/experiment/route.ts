/** Terminate a Spark experiment by its signed ticket; never accept raw IDs from browser. */
import {NextResponse} from 'next/server';
import {checkLocalAccess,originMatchesHost,verifySparkSessionTicket} from '@/modules/security/live-auth';
import {serverCostGuard} from '@/modules/cost/guard';
import {readCappedJson,RequestBodyError} from '@/modules/security/request-size';
import {abortLiveExperiment} from '@/modules/analysis/live-operations';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
const fail=(message:string,status=403)=>NextResponse.json({error:message},{status,headers});
export async function POST(request:Request){
 if(!originMatchesHost(request.headers.get('origin'),request.headers.get('host'))||
    !checkLocalAccess(request.headers.get('x-safecall-local-key'),process.env.SAFECALL_LOCAL_ACCESS_TOKEN))return fail('로컬 권한 없음');
 if(!request.headers.get('content-type')?.startsWith('application/json'))return fail('JSON만 허용',415);
 try{
  const body=await readCappedJson(request,100);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length) return fail('빈 JSON 객체만 허용',400);
  const ticket=verifySparkSessionTicket(request.headers.get('x-safecall-spark-ticket'),process.env.SAFECALL_SESSION_SIGNING_KEY);
  const id='spark_'+ticket.sid.replaceAll('-','');
  const state=serverCostGuard().closeExperiment(id);
  abortLiveExperiment(id);
  return NextResponse.json({experiment:state,warning:'기존 외부 요청의 실제 청구 여부는 별도 확인이 필요합니다.'},{headers});
 }catch(e){return fail(e instanceof RequestBodyError?e.message:'실험 티켓 또는 장부 확인 실패',e instanceof RequestBodyError?e.status:403);}
}
