import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { validateWorkflow } from "@/lib/workflows";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) { const denied = localOnly(request); return denied || NextResponse.json(store().listWorkflows()); }
export async function POST(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; try { const body = await request.json(); const graph = validateWorkflow(body.graph); return NextResponse.json(store().createWorkflow(String(body.name || "Untitled workflow"), graph), { status: 201 }); } catch (error) { return errorResponse(error); } }
