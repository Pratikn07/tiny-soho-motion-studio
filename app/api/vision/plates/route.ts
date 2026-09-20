import { NextRequest, NextResponse } from "next/server";
import { localOnly } from "@/lib/http";
import { createVisionGenerationPlate } from "@/lib/vision/client";
import { generationPlateBuildRequestSchema } from "@/lib/vision/plate";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const parsed = generationPlateBuildRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Generation plate request is invalid." }, { status: 400 });
    const result = await createVisionGenerationPlate(parsed.data);
    if ("status" in result && result.status === "unavailable") return NextResponse.json({ error: result.reason }, { status: 503 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Generation plate request could not be read." }, { status: 400 });
  }
}
