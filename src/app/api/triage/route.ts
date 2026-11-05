import { NextResponse } from "next/server";
import { z } from "zod";
import { assessTriage } from "@/modules/risk-triage";
import {readCappedJson,RequestBodyError} from "@/modules/security/request-size";

const bodySchema = z.object({
  turns: z.array(z.object({
    speaker: z.enum(["caller", "user", "unknown", "multiple"]),
    text: z.string().trim().min(1).max(10000),
  })).min(1).max(64),
  actionEvent: z.enum(["NONE", "TRANSFER_PREPARED", "OTP_SHARE_ATTEMPT"]).optional(),
}).strict();

/** Local demo endpoint. The response is a candidate AI trigger, not a Meta API call. */
export async function POST(request: Request) {
  let payload:unknown;
  try{payload=await readCappedJson(request,65536);}
  catch(error){return NextResponse.json({error:'입력 크기 또는 JSON 오류'},{status:error instanceof RequestBodyError?error.status:400});}
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "입력 형식 오류" }, { status: 400 });
  return NextResponse.json(assessTriage(parsed.data), {
    headers: { "Cache-Control": "no-store" },
  });
}
