/** Local developer session issuance for multiple Spark requests in one test call.
 * There is no production identity/account system here. Disabled unless separately approved.
 */
import {NextResponse} from 'next/server';
import {getMetaSettings} from '@/modules/analysis/meta-settings';
import {serverCostGuard} from '@/modules/cost/guard';
import {issueSparkSessionTicket,verifySparkSessionTicket,originMatchesHost} from '@/modules/security/live-auth';
import {readCappedJson,RequestBodyError} from '@/modules/security/request-size';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
const deny=(message:string,status=403)=>NextResponse.json({error:message},{status,headers});
export async function POST(request:Request){
 if(!originMatchesHost(request.headers.get('origin'),request.headers.get('host')))return deny('로컬 브라우저 출처만 허용');
 if(!request.headers.get('content-type')?.startsWith('application/json'))return deny('JSON 요청만 허용',415);
 let body:unknown;
 try{body=await readCappedJson(request,100);}
 catch(error){return deny('세션 요청 크기 또는 JSON 오류',error instanceof RequestBodyError?error.status:400);}
 try{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==0)return deny('빈 JSON 객체만 허용',400);
  const setting=getMetaSettings();
  if(!setting.enabled||!setting.configured||!serverCostGuard().stats().liveAllowed)return deny('LIVE 사용 승인 비활성');
  const ticket=issueSparkSessionTicket(request.headers.get('x-safecall-local-key'),process.env.SAFECALL_LOCAL_ACCESS_TOKEN,process.env.SAFECALL_SESSION_SIGNING_KEY);
  const sid='spark_'+verifySparkSessionTicket(ticket,process.env.SAFECALL_SESSION_SIGNING_KEY).sid.replaceAll('-','');
  const experiment=serverCostGuard().beginExperiment(sid,'SPARK',{maxCalls:1,capUsd:0.05,ttlMs:120000});
  return NextResponse.json({ticket,expiresInSeconds:120,experiment},{headers});
 }catch{return deny('서버 세션 인증 또는 비용 장부 검증 실패');}
}
