import { NextResponse } from "next/server";
import { healthSnapshot } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(healthSnapshot(), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
