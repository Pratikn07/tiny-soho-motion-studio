import { NextRequest, NextResponse } from "next/server";
import { localOnly } from "@/lib/http";
import { runVisionOcr } from "@/lib/vision/client";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const formData = await request.formData();
    const image = formData.get("image");
    if (!(image instanceof File) || !SUPPORTED_IMAGE_TYPES.has(image.type) || image.size < 1 || image.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Upload a non-empty PNG, JPEG, or WebP image within the 16 MB limit." }, { status: 400 });
    }
    const upstream = new FormData();
    upstream.append("image", image, image.name || "image");
    const result = await runVisionOcr(upstream);
    if ("status" in result && result.status === "unavailable") return NextResponse.json({ error: result.reason }, { status: 503 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Vision OCR upload could not be read." }, { status: 400 });
  }
}
