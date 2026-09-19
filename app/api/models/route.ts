import { NextRequest, NextResponse } from "next/server";
import { listModels } from "@/lib/models";
import { store } from "@/lib/store";
import { localOnly } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; const db = store(); const confirmed = new Set(db.getSetting<string[]>("freeQuotaModels") || []); const confirmedAt = db.getSetting<Record<string, string>>("freeQuotaConfirmedAt") || {}; return NextResponse.json(listModels().map((model) => ({ ...model, eligible: confirmed.has(model.id), confirmedAt: confirmedAt[model.id] || null, disabledReason: confirmed.has(model.id) ? null : "Free Quota Only must be confirmed in Alibaba Model Studio." }))); }
