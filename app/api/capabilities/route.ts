import { NextRequest, NextResponse } from "next/server";
import { capabilitySchema, listCapabilities, type Capability } from "@/lib/capabilities";
import { localOnly } from "@/lib/http";
import { getVisionCapabilities } from "@/lib/vision/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = localOnly(request);
  if (denied) return denied;
  const catalog = listCapabilities();
  const sidecar = await getVisionCapabilities();
  if ("status" in sidecar) {
    return NextResponse.json({
      capabilities: catalog.map((capability) => withFallbackRuntime(capability, sidecar.reason)),
      sidecar,
    });
  }

  const runtimeById = new Map<string, Capability["runtimeStatus"]>();
  for (const rawCapability of sidecar.capabilities) {
    const parsed = capabilitySchema.safeParse(rawCapability);
    if (parsed.success) runtimeById.set(parsed.data.id, parsed.data.runtimeStatus);
  }
  return NextResponse.json({
    capabilities: catalog.map((capability) => capability.runtime === "ffmpeg"
      ? withFallbackRuntime(capability, null)
      : { ...capability, runtimeStatus: runtimeById.get(capability.id) || withFallbackRuntime(capability, "The vision sidecar did not report this capability.").runtimeStatus }),
    sidecar: { status: "ready", hardware: sidecar.hardware },
  });
}

function withFallbackRuntime(capability: Capability, sidecarReason: string | null) {
  if (capability.runtime === "ffmpeg") {
    return {
      ...capability,
      runtimeStatus: {
        capabilityId: capability.id,
        backend: "Node FFmpeg composition runtime",
        state: "ready" as const,
        available: true,
        reason: null,
      },
    };
  }
  return {
    ...capability,
    runtimeStatus: {
      capabilityId: capability.id,
      backend: "Tiny Soho Vision sidecar",
      state: "unloaded" as const,
      available: false,
      reason: capability.unavailableReason || sidecarReason || "This capability is not available from the vision sidecar.",
    },
  };
}
