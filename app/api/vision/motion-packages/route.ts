import { NextRequest, NextResponse } from "next/server";
import { errorResponse, localOnly } from "@/lib/http";
import { store } from "@/lib/store";
import { createMotionPackageV2, motionPackageV2Fingerprint, motionPackageV2Schema } from "@/lib/vision/motion-package-v2";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const parsed = motionPackageV2Schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "MotionPackageV2 request is invalid." }, { status: 400 });
    const db = store();
    const packageV2 = await createMotionPackageV2(parsed.data, { db, eligibleModels: new Set(db.getSetting<string[]>("freeQuotaModels") || []) });
    return NextResponse.json({ package: packageV2, fingerprint: motionPackageV2Fingerprint(packageV2) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
