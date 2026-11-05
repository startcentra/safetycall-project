import { NextResponse } from "next/server";
import { getMetaSettings } from "@/modules/analysis/meta-settings";
export const runtime = "nodejs";
export async function GET() {
  const s = getMetaSettings();
  return NextResponse.json({ mode: s.enabled && s.configured ? "READY_FOR_EXPLICIT_LIVE" : "OFFLINE", model: s.model,
    liveEnabled: s.enabled, apiKeyConfigured: s.configured, maxCallsPerProcess: s.maxCalls,
    limitation: "프로세스 로컬 개발용 제한입니다. 서버 재시작·복수 인스턴스에서는 초기화됩니다." },
    {headers:{"Cache-Control":"no-store"}});
}
