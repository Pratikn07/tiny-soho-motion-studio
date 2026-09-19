import { NextRequest, NextResponse } from "next/server";
import { askDirector } from "@/lib/director";
import { validateDirectorProposal } from "@/lib/proposals";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; try { const body = await request.json(); if (!body.projectId || !body.prompt?.trim()) throw new Error("A project and brief are required."); if (!store().getProject(body.projectId)) throw new Error("Project not found."); const proposal = validateDirectorProposal(await askDirector(body.prompt, body.projectId)); return NextResponse.json(store().createProposal(body.projectId, body.prompt, proposal), { status: 201 }); } catch (error) { return errorResponse(error); } }
