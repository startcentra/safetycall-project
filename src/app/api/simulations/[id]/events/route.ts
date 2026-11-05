import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceDemoSession } from "@/modules/simulation/store";
import {readCappedJson,RequestBodyError} from "@/modules/security/request-size";

const eventSchema = z.object({
  action: z.enum(["NEXT_LINE", "REQUEST_TRANSFER", "CANCEL_TRANSFER", "VERIFY_CLAIM", "END_CASE"]),
}).strict();

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f\d-]{36}$/.test(id)) return NextResponse.json({ error: "유효하지 않은 세션입니다." }, { status: 400 });
  let payload: unknown;
  try { payload = await readCappedJson(request,2048); }
  catch (e) { return NextResponse.json({ error: e instanceof RequestBodyError ? e.message : "JSON 형식이 아닙니다." }, { status: e instanceof RequestBodyError ? e.status : 400 }); }
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "허용되지 않은 작업입니다." }, { status: 400 });
  try {
    return NextResponse.json(advanceDemoSession(id, parsed.data.action), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "시뮬레이션 처리 오류" }, { status: 409 });
  }
}
