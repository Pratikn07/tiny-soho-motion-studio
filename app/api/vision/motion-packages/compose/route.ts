import { NextRequest, NextResponse } from "next/server";
import { errorResponse, localOnly } from "@/lib/http";
import { store } from "@/lib/store";
import { composeMotionPackageFinal, finalCompositionRequestSchema } from "@/lib/vision/final-composition";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const parsed = finalCompositionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Final typography composition request is invalid." }, { status: 400 });
    const asset = await composeMotionPackageFinal(parsed.data, { db: store() });
    const { path: _path, ...publicAsset } = asset;
    return NextResponse.json(publicAsset, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
