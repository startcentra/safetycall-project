import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { buildContext, LiveMetaProvider, MetaProviderError, MockMetaProvider } from "@/modules/analysis/meta-provider";
import { LiveRequestGate, BudgetExceededError } from "@/modules/analysis/meta-gate";
import { serverCostGuard, estimateSparkUsd, CostGuardError } from "@/modules/cost/guard";
import { getMetaSettings,getSparkOutputCap } from "@/modules/analysis/meta-settings";
import {checkLocalAccess,originMatchesHost,verifySparkSessionTicket} from "@/modules/security/live-auth";
import { validateMetaInput, MetaValidationError } from "@/modules/analysis/meta-validation";
import {registerLiveOperation,unregisterLiveOperation} from '@/modules/analysis/live-operations';
import {readCappedJson,RequestBodyError} from "@/modules/security/request-size";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const gate = new LiveRequestGate(getMetaSettings().maxCalls);
const noStore = {"Cache-Control":"no-store"};
const json = (value: object, status = 200) => NextResponse.json(value,{status,headers:noStore});

export async function POST(request: Request) {
  // Basic browser CSRF defense; local dev only. Production deployment needs authentication and a shared durable quota.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try { if (new URL(origin).host !== host) return json({error:"허용되지 않은 출처"},403); }
    catch {return json({error:"Origin 헤더 형식 오류"},403);}
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({error:"JSON만 허용됩니다."},415);
  let body:unknown;
  try{body=await readCappedJson(request,16000);}
  catch(error){return json({error:'입력 크기 또는 JSON 오류'},error instanceof RequestBodyError?error.status:400);}
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json({error:"요청 객체 오류"},400);
  const record = body as Record<string,unknown>;
  if (Object.keys(record).some(k=>!["requestedMode","allowLive","turns","actionEvent"].includes(k))) return json({error:"허용되지 않은 요청 필드"},400);
  if (record.requestedMode !== "MOCK" && record.requestedMode !== "LIVE") return json({error:"MOCK 또는 LIVE를 선택해야 합니다."},400);
  let input;
  try { input = validateMetaInput({ turns: record.turns, actionEvent: record.actionEvent }); }
  catch(err) {return json({error:err instanceof MetaValidationError?err.message:"입력 오류"},400);}
  const ctx = buildContext(input);
  if (record.requestedMode === "MOCK") {
    const output = await new MockMetaProvider().analyze(ctx);
    return json({ ...output, triage:ctx.triage });
  }
  const settings = getMetaSettings();
  if (!settings.enabled || !settings.configured) return json({error:"LIVE 비활성 또는 서버 API 키 없음. 외부 호출하지 않았습니다."},403);
  if(!originMatchesHost(origin,host)||!checkLocalAccess(request.headers.get('x-safecall-local-key'),process.env.SAFECALL_LOCAL_ACCESS_TOKEN))return json({error:'LIVE는 로컬 사용자 인증이 필요합니다.'},403);
  if (record.allowLive !== true || request.headers.get("x-safecall-live-confirm") !== "yes") return json({error:"별도의 명시적 LIVE 실행 확인이 필요합니다."},403);
  let costSessionId:string;
  try { costSessionId=verifySparkSessionTicket(request.headers.get('x-safecall-spark-ticket'),process.env.SAFECALL_SESSION_SIGNING_KEY).sid.replaceAll('-',''); }
  catch { return json({error:'서버가 발급한 유효한 통화별 Spark 세션 승인이 필요합니다.'},403); }
  const outputCap=getSparkOutputCap();
  if(!outputCap)return json({error:'출력 토큰 상한 설정 오류: LIVE 차단'},503);
  // LIVE still requires a risk trigger; no billable full-dataset evaluation in this step.
  if (!ctx.triage.shouldCallMeta) return json({error:"의심 표현 트리거가 없습니다. 자동 LIVE 호출은 하지 않습니다."},422);
  // Consult durable cost approval before consuming the process-local request allowance.
  try {if(!serverCostGuard().stats().liveAllowed) return json({error:"유료 사용 승인이 없거나 Kill Switch가 작동 중입니다.",analysisMode:"OFFLINE"},403);} catch {return json({error:"예산 장부 읽기 실패: LIVE 차단"},503);}
  // Hash only; caller text is not retained in the gate, and no transcript is logged.
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const experimentId="spark_"+costSessionId;
  try { gate.reserve(fingerprint); }
  catch(error) { return json({error:error instanceof BudgetExceededError?error.message:"사용량 제한",usedCalls:gate.stats.used,maxCalls:gate.stats.max},429); }
  let budgetId:string;
  const guard=serverCostGuard();
  try {budgetId=guard.reserveExperiment("SPARK",estimateSparkUsd(16000,outputCap),experimentId,fingerprint);}
  catch(e) {gate.finish(fingerprint);return json({error:e instanceof CostGuardError?e.message:"예산 장부 오류",analysisMode:"OFFLINE"},403);}
  let chargeUsd:number|undefined;
  const operation=registerLiveOperation(experimentId);
  let result:ReturnType<typeof json>;
  try {
    if(guard.experimentStatus(experimentId).status!=='ACTIVE')throw new MetaProviderError('CANCELLED','실험이 종료된 뒤의 요청은 전송하지 않습니다.');
    const response = await new LiveMetaProvider({apiKey:process.env.MODEL_API_KEY ?? "",signal:operation.signal}).analyze(ctx);
    if(response.usage.inputTokens!==null && response.usage.outputTokens!==null) chargeUsd=estimateSparkUsd(response.usage.inputTokens,response.usage.outputTokens);
    result=json({...response,triage:ctx.triage,usedCalls:gate.stats.used,maxCalls:gate.stats.max});
  } catch(error) {
    if (error instanceof MetaProviderError) result=json({error:error.message,errorKind:error.kind,analysisMode:"ERROR",triage:ctx.triage},error.kind==="RATE_LIMIT"?429:error.kind==="TIMEOUT"?504:error.kind==="CANCELLED"?409:502);
    else result=json({error:"Meta 호출이 실패했습니다. 기본 안전 코칭을 유지합니다.",analysisMode:"ERROR",triage:ctx.triage},502);
  }
  try { guard.settle(budgetId,chargeUsd); }
  catch { return json({error:"예산 장부 정산 실패: LIVE 중지 및 공식 청구 내역 확인 필요",analysisMode:"ERROR",triage:ctx.triage},503); }
  finally { unregisterLiveOperation(experimentId,operation);gate.finish(fingerprint); }
  // Termination may happen during an in-flight request. In that case suppress the
  // late model result even if the vendor completed (billing status remains separate).
  try{if(guard.experimentStatus(experimentId).status!=='ACTIVE')return json({error:'실험이 종료되었습니다. 결과는 표시하지 않습니다. 과금 여부는 장부로 확인하세요.',analysisMode:'ERROR'},409);}catch{return json({error:'실험 상태를 확인할 수 없어 결과를 폐기합니다.',analysisMode:'ERROR'},503);}
  return result;
}
