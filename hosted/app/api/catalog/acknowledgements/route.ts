import { requireOwner } from "@/lib/auth";
import { billingAcknowledgementRequestSchema, type BillingAcknowledgementResponse } from "@/lib/contract";
import { routeErrorResponse } from "@/lib/http";
import { PROVIDER_BILLING_VERSIONS, providerAcknowledgementKey } from "@/lib/model-acknowledgements";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const { provider } = billingAcknowledgementRequestSchema.parse(await request.json());
    const key = providerAcknowledgementKey(provider);
    const stored = await new StudioRepository(createServiceSupabaseClient(), owner).acknowledgeModel({
      modelId: key.modelId,
      contractVersion: key.contractVersion,
      textVersion: PROVIDER_BILLING_VERSIONS[provider],
    });
    const body: BillingAcknowledgementResponse = {
      provider,
      version: key.contractVersion,
      acknowledgedAt: new Date(stored.billing_acknowledged_at).toISOString(),
    };
    return Response.json(body, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
