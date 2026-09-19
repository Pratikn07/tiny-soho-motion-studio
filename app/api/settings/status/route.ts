import { NextRequest, NextResponse } from "next/server";
import { configPresent } from "@/lib/config";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; return NextResponse.json({ configured: configPresent(), freeQuotaModels: store().getSetting<string[]>("freeQuotaModels") || [], dataDirectory: process.env.TINY_SOHO_DATA_DIR || "~/Library/Application Support/Tiny Soho Studio" }); }
export async function POST(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; try { const body = await request.json(); if (!Array.isArray(body.freeQuotaModels) || !body.freeQuotaModels.every((id: unknown) => typeof id === "string")) throw new Error("freeQuotaModels must be a list of model IDs."); store().setSetting("freeQuotaModels", body.freeQuotaModels); return NextResponse.json({ ok: true }); } catch (error) { return errorResponse(error); } }
