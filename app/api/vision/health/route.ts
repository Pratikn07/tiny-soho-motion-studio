import { NextRequest, NextResponse } from "next/server";
import { localOnly } from "@/lib/http";
import { getVisionHealth } from "@/lib/vision/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  return NextResponse.json(await getVisionHealth());
}
