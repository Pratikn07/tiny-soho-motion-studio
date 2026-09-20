import { NextRequest, NextResponse } from "next/server";
import { configuredTransportCapability, effectiveTransportCapability } from "@/lib/media-transport/capability";
import { listModels, type MediaRole } from "@/lib/models";
import { localOnly } from "@/lib/http";

export const runtime = "nodejs";

const inlineRoles = new Set<MediaRole>(["source-image", "start-image", "end-image", "reference-image"]);

export function GET(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  const transport = configuredTransportCapability();
  return NextResponse.json({
    transport,
    models: listModels().map((model) => {
      const effective = effectiveTransportCapability(transport, model.providerModel);
      const media: Array<{ role: MediaRole | "reference-voice" | "existing-public-url"; available: boolean; reason: string | null }> = model.mediaRules.allowedRoles.map((role) => inlineRoles.has(role)
        ? { role, available: true, reason: null }
        : { role, available: effective.state === "verified", reason: effective.state === "verified" ? null : effective.reason || "Free Singapore URL transport is not verified." });
      if (model.family === "wan2.7-r2v") media.push({ role: "reference-voice", available: effective.state === "verified", reason: effective.state === "verified" ? null : effective.reason || "Free Singapore URL transport is not verified." });
      if (model.mediaRules.allowedRoles.some((role) => !inlineRoles.has(role))) media.push({ role: "existing-public-url", available: true, reason: null });
      return { modelId: model.id, providerModel: model.providerModel, media };
    }),
  });
}
