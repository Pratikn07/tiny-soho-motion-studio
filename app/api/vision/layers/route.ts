import { NextRequest, NextResponse } from "next/server";
import { localOnly } from "@/lib/http";
import { runVisionLayers } from "@/lib/vision/client";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_PROMPT_CHARS = 1000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SUPPORTED_LAYER_COUNTS = new Set([4, 6, 8]);

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const formData = await request.formData();
    const image = formData.get("image");
    const prompt = formData.get("prompt");
    const requestedLayerCount = Number(formData.get("requestedLayerCount") || 4);
    const seed = formData.get("seed");
    if (!(image instanceof File) || !SUPPORTED_IMAGE_TYPES.has(image.type) || image.size < 1 || image.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Upload a non-empty PNG, JPEG, or WebP image within the 16 MB limit." }, { status: 400 });
    }
    if (prompt !== null && (typeof prompt !== "string" || prompt.length > MAX_PROMPT_CHARS)) {
      return NextResponse.json({ error: "Layer prompt must be at most 1000 characters." }, { status: 400 });
    }
    if (!Number.isInteger(requestedLayerCount) || !SUPPORTED_LAYER_COUNTS.has(requestedLayerCount)) {
      return NextResponse.json({ error: "Requested layer count must be 4, 6, or 8." }, { status: 400 });
    }
    if (seed !== null && (typeof seed !== "string" || !/^-?\d+$/.test(seed))) {
      return NextResponse.json({ error: "Layer seed must be an integer." }, { status: 400 });
    }
    const upstream = new FormData();
    upstream.append("image", image, image.name || "image");
    if (prompt) upstream.append("prompt", prompt);
    upstream.append("requestedLayerCount", String(requestedLayerCount));
    if (seed) upstream.append("seed", seed);
    const result = await runVisionLayers(upstream);
    if ("status" in result && result.status === "unavailable") return NextResponse.json({ error: result.reason }, { status: 503 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Vision layer upload could not be read." }, { status: 400 });
  }
}
