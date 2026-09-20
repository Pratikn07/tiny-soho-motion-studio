import { NextRequest, NextResponse } from "next/server";
import { localOnly } from "@/lib/http";
import { runVisionSegmentation } from "@/lib/vision/client";
import { segmentationPromptsSchema } from "@/lib/vision/segmentation";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const formData = await request.formData();
    const image = formData.get("image");
    const prompts = formData.get("prompts");
    if (!(image instanceof File) || !SUPPORTED_IMAGE_TYPES.has(image.type) || image.size < 1 || image.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Upload a non-empty PNG, JPEG, or WebP image within the 16 MB limit." }, { status: 400 });
    }
    if (typeof prompts !== "string") return NextResponse.json({ error: "Segmentation prompts are required." }, { status: 400 });
    let parsedPrompts: unknown;
    try {
      parsedPrompts = JSON.parse(prompts);
    } catch {
      return NextResponse.json({ error: "Segmentation prompts must be valid JSON." }, { status: 400 });
    }
    if (!segmentationPromptsSchema.safeParse(parsedPrompts).success) {
      return NextResponse.json({ error: "Segmentation prompts are invalid." }, { status: 400 });
    }
    const upstream = new FormData();
    upstream.append("image", image, image.name || "image");
    upstream.append("prompts", JSON.stringify(parsedPrompts));
    const result = await runVisionSegmentation(upstream);
    if ("status" in result && result.status === "unavailable") return NextResponse.json({ error: result.reason }, { status: 503 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Vision segmentation upload could not be read." }, { status: 400 });
  }
}
