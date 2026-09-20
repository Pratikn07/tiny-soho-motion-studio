import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { getVideoModelContract } from "@/lib/video-catalog";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

const acknowledgementSchema = z.object({
  modelId: z.string().min(1).max(120),
  contractVersion: z.string().min(1).max(80),
});

const repositoryFor = (owner: Awaited<ReturnType<typeof requireOwner>>) => (
  new StudioRepository(createServiceSupabaseClient(), owner)
);

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const acknowledgements = await repositoryFor(owner).listModelAcknowledgements();
    return Response.json({ acknowledgements });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const parsed = acknowledgementSchema.safeParse(await request.json());
    if (!parsed.success) throw new StudioError(400, "invalid_model_acknowledgement", "Choose a current Studio model contract.");
    const contract = getVideoModelContract(parsed.data.modelId);
    if (!contract || contract.contractVersion !== parsed.data.contractVersion) {
      throw new StudioError(400, "invalid_model_acknowledgement", "Choose a current Studio model contract.");
    }
    const acknowledgement = await repositoryFor(owner).acknowledgeModel(parsed.data);
    return Response.json({ acknowledgement }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
