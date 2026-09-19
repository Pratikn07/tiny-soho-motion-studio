import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; const project = store().getProject((await params).id); return project ? NextResponse.json(project) : NextResponse.json({ error: "Project not found" }, { status: 404 }); }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; try { const body = await request.json(); return NextResponse.json(store().updateProject((await params).id, { name: body.name, canvas: body.canvas, storyboard: body.storyboard ? JSON.stringify(body.storyboard) : undefined })); } catch (error) { return errorResponse(error); } }
