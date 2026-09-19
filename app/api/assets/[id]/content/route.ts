import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { store } from "@/lib/store";
import { localOnly } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const denied = localOnly(request); if (denied) return denied; const asset = store().getAsset((await params).id); if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 }); try { return new NextResponse(await fs.readFile(asset.path), { headers: { "Content-Type": asset.mime, "Content-Disposition": `inline; filename="${asset.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"` } }); } catch { return NextResponse.json({ error: "Asset file is missing" }, { status: 410 }); } }
