import { NextRequest, NextResponse } from "next/server";
import { store, toPublicJob } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; const job = store().getJob((await params).id); return job ? NextResponse.json(toPublicJob(job)) : NextResponse.json({ error: "Job not found" }, { status: 404 }); }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; try { const id = (await params).id; const action = request.nextUrl.searchParams.get("action"); if (action !== "cancel") throw new Error("Unsupported job action."); const canceled = store().cancelQueuedJob(id); if (!canceled) throw new Error("Only queued work can be canceled locally; provider-submitted work may still consume quota."); return NextResponse.json(toPublicJob(canceled)); } catch (error) { return errorResponse(error); } }
