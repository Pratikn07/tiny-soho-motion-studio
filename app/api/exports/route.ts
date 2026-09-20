import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { compositeOverlay, concatenateVideos } from "@/lib/media";
import { adoptAssetFile, toPublicAsset } from "@/lib/assets";
import { validateExportInputs } from "@/lib/export-inputs";
import { store } from "@/lib/store";
import { errorResponse, localOnly } from "@/lib/http";

export const runtime = "nodejs";

function canvasFor(value: unknown) {
  if (value === "reels") return "1080:1920";
  if (value === "feed") return "1080:1350";
  return "1080:1440";
}

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  let sequencePath: string | undefined;
  let finalPath: string | undefined;
  try {
    const body = await request.json();
    const projectId = String(body.projectId || "");
    const videoAssetIds = Array.isArray(body.videoAssetIds) ? body.videoAssetIds.map(String) : [];
    const overlayAssetId = body.overlayAssetId ? String(body.overlayAssetId) : undefined;
    const { videos, overlay } = validateExportInputs(store(), projectId, videoAssetIds, overlayAssetId);
    const canvas = canvasFor(body.canvas);
    sequencePath = await concatenateVideos(videos.map((asset) => asset.path), canvas);
    finalPath = overlay ? await compositeOverlay(sequencePath, overlay.path, canvas) : sequencePath;
    const saved = await adoptAssetFile(finalPath, "video/mp4");
    const asset = store().addAsset({
      projectId,
      kind: "export",
      name: "Tiny Soho export",
      mime: "video/mp4",
      path: saved.path,
      width: saved.width,
      height: saved.height,
      duration: saved.duration,
      hash: saved.hash,
      provenance: JSON.stringify({ source: "ffmpeg", videoAssetIds, overlayAssetId: overlayAssetId || null, media: { codec: saved.codec, container: saved.container } }),
    });
    return NextResponse.json(toPublicAsset(asset), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    const temporaryOutputs = new Set([sequencePath, finalPath].filter((value): value is string => Boolean(value)));
    await Promise.all([...temporaryOutputs].map((filePath) => fs.rm(filePath, { force: true })));
  }
}
