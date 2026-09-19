import { NextRequest, NextResponse } from "next/server";
import { listCapabilities } from "@/lib/capabilities";
import { localOnly } from "@/lib/http";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  return NextResponse.json({ capabilities: listCapabilities() });
}
