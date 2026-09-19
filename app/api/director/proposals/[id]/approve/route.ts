import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { approveProposalJobs } from "@/lib/proposals";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; try { const confirmed = new Set(store().getSetting<string[]>("freeQuotaModels") || []); const jobs = approveProposalJobs(store(), (await params).id, confirmed); return NextResponse.json({ jobs }, { status: 201 }); } catch (error) { return errorResponse(error); } }
