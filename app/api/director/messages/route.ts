import { NextRequest, NextResponse } from "next/server";
import { askDirector, directorAssetManifest, draftProposal } from "@/lib/director";
import { validateDirectorProposal } from "@/lib/proposals";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
import { retrieveCreativeKnowledge } from "@/lib/knowledge";
export const runtime = "nodejs";
export async function POST(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; try { const body = await request.json(); if (!body.projectId || !body.prompt?.trim()) throw new Error("A project and brief are required."); const db = store(); if (!db.getProject(body.projectId)) throw new Error("Project not found."); const assets = db.listAssets(body.projectId); const knowledge = await retrieveCreativeKnowledge(body.prompt); const scope = { projectId: body.projectId, allowedAssetIds: new Set(assets.map((asset) => asset.id)), allowedEvidenceRefs: new Set(knowledge.evidence.map((item) => `${item.source}:${item.sourceId}`)) }; const draft = await askDirector(body.prompt, body.projectId, knowledge.evidence, directorAssetManifest(assets)); let proposal; try { proposal = validateDirectorProposal({ ...(draft as object), evidence: knowledge }, scope); } catch { proposal = validateDirectorProposal({ ...draftProposal(body.prompt, body.projectId), evidence: knowledge }, scope); } return NextResponse.json(db.createProposal(body.projectId, body.prompt, proposal), { status: 201 }); } catch (error) { return errorResponse(error); } }
