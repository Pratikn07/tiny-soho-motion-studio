import { NextRequest, NextResponse } from "next/server";
import { listModels } from "@/lib/models";
import { store } from "@/lib/store";
import { localOnly } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; const confirmed = new Set(store().getSetting<string[]>("freeQuotaModels") || []); return NextResponse.json(listModels().map((model) => ({ ...model, eligible: confirmed.has(model.id), disabledReason: confirmed.has(model.id) ? null : "Free Quota Only must be confirmed in Alibaba Model Studio." }))); }
