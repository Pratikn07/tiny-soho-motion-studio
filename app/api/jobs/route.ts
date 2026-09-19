import { NextRequest, NextResponse } from "next/server";
import { getModel, validateGeneration } from "@/lib/models";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) { const denied = localOnly(request); return denied || NextResponse.json(store().listJobs(request.nextUrl.searchParams.get("projectId") || undefined)); }
export async function POST(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; try { const body = await request.json(); const inputRoles = body.inputRoles || []; const model = getModel(body.modelId); const confirmed = (store().getSetting<string[]>("freeQuotaModels") || []).includes(model.id); validateGeneration(model, { task: body.task, prompt: body.prompt, inputRoles, options: body.options || {}, freeQuotaConfirmed: confirmed }); return NextResponse.json(store().createJob({ projectId: body.projectId, idempotencyKey: body.idempotencyKey, modelId: body.modelId, task: body.task, prompt: body.prompt, inputAssetIds: body.inputAssetIds || [], options: { ...body.options, inputRoles } }), { status: 201 }); } catch (error) { return errorResponse(error); } }
