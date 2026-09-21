import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const capabilities = await new StudioRepository(createServiceSupabaseClient(), owner).listVisionCapabilities();
    return Response.json({ capabilities: capabilities.map((capability) => ({
      capabilityId: capability.capability_id,
      serviceVersion: capability.service_version,
      status: capability.status,
      reason: capability.reason,
      refreshedAt: capability.refreshed_at,
    })) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
