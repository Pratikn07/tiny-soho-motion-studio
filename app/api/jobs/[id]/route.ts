import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; const job = store().getJob((await params).id); return job ? NextResponse.json(job) : NextResponse.json({ error: "Job not found" }, { status: 404 }); }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; try { const id = (await params).id; const job = store().getJob(id); if (!job) throw new Error("Job not found"); const action = request.nextUrl.searchParams.get("action"); if (action !== "cancel" || !["queued", "submitting"].includes(job.status)) throw new Error("Only queued work can be canceled locally."); return NextResponse.json(store().updateJob(id, { status: "canceled" })); } catch (error) { return errorResponse(error); } }
