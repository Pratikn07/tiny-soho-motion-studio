import { NextRequest, NextResponse } from "next/server";
import { errorResponse, localOnly } from "@/lib/http";
import { store, toPublicJob } from "@/lib/store";
import { VisionGenerationBridge } from "@/lib/vision/generation-bridge";
import { createMotionPackageV2, motionPackageV2Schema } from "@/lib/vision/motion-package-v2";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({ package: motionPackageV2Schema, generationAttemptId: z.string().min(1).max(128) }).strict();

export async function POST(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Vision generation request is invalid." }, { status: 400 });
    const db = store();
    const eligibleModels = new Set(db.getSetting<string[]>("freeQuotaModels") || []);
    const packageV2 = await createMotionPackageV2(parsed.data.package, { db, eligibleModels });
    const job = new VisionGenerationBridge(db, eligibleModels).queue(packageV2, parsed.data.generationAttemptId);
    return NextResponse.json(toPublicJob(job), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
