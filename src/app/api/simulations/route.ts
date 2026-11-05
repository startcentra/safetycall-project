import { NextResponse } from "next/server";
import { createDemoSession } from "@/modules/simulation/store";

export const dynamic = "force-dynamic";
export async function POST() {
  return NextResponse.json(createDemoSession(), { status: 201, headers: { "Cache-Control": "no-store" } });
}
