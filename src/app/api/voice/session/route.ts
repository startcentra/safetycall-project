import {NextResponse} from 'next/server';
import {issueLiveTicket,verifyLiveTicket,originMatchesHost} from '@/modules/security/live-auth';
import {serverCostGuard} from '@/modules/cost/guard';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!originMatchesHost(request.headers.get('origin'),request.headers.get('host')))return NextResponse.json({error:'로컬 브라우저 출처만 허용'}, {status:403,headers});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return NextResponse.json({error:'JSON 요청만 허용'}, {status:415,headers});
 try{
  if(!serverCostGuard().stats().liveAllowed||process.env.META_VOICE_LIVE_ENABLED!=='true')return NextResponse.json({error:'LIVE 비용 사용 승인 비활성'}, {status:403,headers});
  const ticket=issueLiveTicket('VOICE',request.headers.get('x-safecall-local-key'),process.env.SAFECALL_LOCAL_ACCESS_TOKEN,process.env.SAFECALL_SESSION_SIGNING_KEY);
  const sid='voice_'+verifyLiveTicket(ticket,'VOICE',process.env.SAFECALL_SESSION_SIGNING_KEY).sid.replaceAll('-','');
  const experiment=serverCostGuard().beginExperiment(sid,'VOICE',{maxCalls:1,capUsd:0.05,ttlMs:720000});
  return NextResponse.json({ticket,expiresInSeconds:60,experiment},{headers});
 }catch{return NextResponse.json({error:'로컬 인증 또는 장부 검증 실패'}, {status:403,headers});}
}
