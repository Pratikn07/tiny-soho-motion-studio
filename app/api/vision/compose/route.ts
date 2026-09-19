import { NextRequest, NextResponse } from "next/server";
import { localOnly } from "@/lib/http";
import { composeVisionTypography } from "@/lib/vision/client";
import { typographyCompositionRequestSchema } from "@/lib/vision/composer";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const parsed = typographyCompositionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Typography composition requires valid local artifact IDs." }, { status: 400 });
    const result = await composeVisionTypography(parsed.data);
    if ("status" in result && result.status === "unavailable") return NextResponse.json({ error: result.reason }, { status: 503 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Typography composition request could not be read." }, { status: 400 });
  }
}
