import { NextRequest, NextResponse } from "next/server";
import { queueGeneration } from "@/lib/generation";
import { store, toPublicJob } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) { const denied = localOnly(request); return denied || NextResponse.json(store().listJobs(request.nextUrl.searchParams.get("projectId") || undefined).map(toPublicJob)); }
export async function POST(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; try { const body = await request.json(); const db = store(); return NextResponse.json(toPublicJob(queueGeneration(db, body, new Set(db.getSetting<string[]>("freeQuotaModels") || []))), { status: 201 }); } catch (error) { return errorResponse(error); } }
