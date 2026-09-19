import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { localOnly } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; const run = store().getWorkflowRun((await params).id); return run ? NextResponse.json(run) : NextResponse.json({ error: "Workflow run not found" }, { status: 404 }); }
