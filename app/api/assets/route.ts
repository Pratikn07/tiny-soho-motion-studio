import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { saveAsset, toPublicAsset } from "@/lib/assets";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) { const denied = localOnly(request); return denied || NextResponse.json(store().listAssets(request.nextUrl.searchParams.get("projectId") || undefined).map(toPublicAsset)); }
export async function POST(request: NextRequest) { const denied = localOnly(request); if (denied) return denied; try { const form = await request.formData(); const file = form.get("file"); const projectId = form.get("projectId"); const kind = String(form.get("kind") || "image"); if (!(file instanceof File)) throw new Error("A file is required."); const mime = file.type || "application/octet-stream"; if (!["image/png", "image/jpeg", "image/webp", "audio/mpeg", "audio/wav"].includes(mime)) throw new Error("Supported uploads: PNG, JPEG, WebP, MP3, WAV."); const saved = await saveAsset(Buffer.from(await file.arrayBuffer()), file.name, mime); const asset = store().addAsset({ projectId: typeof projectId === "string" && projectId ? projectId : null, kind, name: file.name, mime, path: saved.path, width: saved.width, height: saved.height, duration: saved.duration, hash: saved.hash, provenance: JSON.stringify({ source: "upload" }) }); return NextResponse.json(toPublicAsset(asset), { status: 201 }); } catch (error) { return errorResponse(error); } }
