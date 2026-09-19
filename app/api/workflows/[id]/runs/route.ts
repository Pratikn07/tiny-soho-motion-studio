import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { executeWorkflowRun } from "@/lib/workflows";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; try { const workflow = store().getWorkflow((await params).id); if (!workflow) throw new Error("Workflow not found"); const body = await request.json(); const run = store().createWorkflowRun(workflow.id, String(body.projectId), JSON.parse(workflow.graph)); const result = executeWorkflowRun(store(), run.id, new Set(store().getSetting<string[]>("freeQuotaModels") || [])); return NextResponse.json({ run: store().getWorkflowRun(run.id), ...result }, { status: 201 }); } catch (error) { return errorResponse(error); } }
