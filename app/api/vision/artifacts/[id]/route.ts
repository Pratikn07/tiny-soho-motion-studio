import { NextRequest, NextResponse } from "next/server";
import { localOnly } from "@/lib/http";
import { parseVisionArtifactId } from "@/lib/vision/artifacts";
import { getVisionArtifact } from "@/lib/vision/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = localOnly(request);
  if (denied) return denied;
  const artifactId = parseVisionArtifactId((await context.params).id);
  if (!artifactId) return NextResponse.json({ error: "Invalid vision artifact ID." }, { status: 400 });
  const artifact = await getVisionArtifact(artifactId);
  if (artifact.status === "not-found") return NextResponse.json({ error: "Vision artifact was not found." }, { status: 404 });
  if (artifact.status === "unavailable") return NextResponse.json({ error: artifact.reason }, { status: 503 });
  return new NextResponse(artifact.body, { headers: { "Content-Type": artifact.contentType, "Cache-Control": "no-store" } });
}
