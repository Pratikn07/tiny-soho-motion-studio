import { NextRequest, NextResponse } from "next/server";
import { toPublicAsset } from "@/lib/assets";
import { errorResponse, localOnly } from "@/lib/http";
import { promoteVisionArtifact, promoteVisionArtifactRequestSchema } from "@/lib/vision/promotion";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const parsed = promoteVisionArtifactRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Vision artifact promotion request is invalid." }, { status: 400 });
    return NextResponse.json(toPublicAsset(await promoteVisionArtifact(parsed.data)), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
