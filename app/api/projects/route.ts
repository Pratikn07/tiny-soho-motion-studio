import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) { const denied = localOnly(request); return denied || NextResponse.json(store().listProjects()); }
export async function POST(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; try { const body = await request.json(); return NextResponse.json(store().createProject(String(body.name || "Untitled project")), { status: 201 }); } catch (error) { return errorResponse(error); } }
