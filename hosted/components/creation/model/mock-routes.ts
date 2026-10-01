import type { CatalogResponse, CreateRunRequest, ProviderId, RunView } from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import { CreationApiError } from "../api";
import { MOCK_ROUTES } from "../mock-api";

/** Test and preview controls: acknowledged providers, reserved spend and the runs started. */
export const mockModels = {
  acknowledged: new Set<ProviderId>(),
  reservedUsd: 0,
  runs: [] as Array<{ slideId: string; request: CreateRunRequest; run: RunView }>,
  /** Overrides a model's fit for every slide, e.g. to show a model that can't take a slide. */
  fit: {} as Record<string, { ok: boolean; reason?: string }>,
};

const catalog = (): CatalogResponse => {
  const base = contractFixtures.catalog;
  return {
    ...base,
    models: base.models.map((model) => ({
      ...model,
      billingAcknowledged: !model.requiresBillingAck || mockModels.acknowledged.has(model.provider),
      ...(mockModels.fit[model.id] ? { fit: mockModels.fit[model.id] } : {}),
    })),
  };
};
const budget = () => {
  const base = contractFixtures.budget;
  const reservedUsd = Math.round((base.reservedUsd + mockModels.reservedUsd) * 100) / 100;
  return { ...base, reservedUsd, remainingUsd: Math.max(0, Math.round((base.capUsd - base.spentUsd - reservedUsd) * 100) / 100) };
};

/** B5, O1 and B3 endpoints on T0's fixtures. Runs reserve their estimate so the budget line moves. */
MOCK_ROUTES.push(
  { method: "GET", path: /^\/api\/catalog$/, handle: () => catalog() },
  {
    method: "POST",
    path: /^\/api\/catalog\/acknowledgements$/,
    handle: (_match, body) => {
      const provider = (body as { provider: ProviderId }).provider;
      mockModels.acknowledged.add(provider);
      return { provider, version: `${provider}-billing-v1`, acknowledgedAt: new Date().toISOString() };
    },
  },
  { method: "GET", path: /^\/api\/budget$/, handle: () => budget() },
  {
    method: "POST",
    path: /^\/api\/creations\/([0-9a-f-]{36})\/slides\/([0-9a-f-]{36})\/runs$/,
    handle: ([, projectId, slideId], body) => {
      const request = body as CreateRunRequest;
      const replay = mockModels.runs.find((entry) => entry.request.idempotencyKey === request.idempotencyKey);
      if (replay) return { run: replay.run };
      const model = catalog().models.find((candidate) => candidate.id === request.modelId);
      if (!model) throw new CreationApiError(400, "model_unsupported_for_slide", "Choose a model from the list.");
      if (model.requiresBillingAck && !model.billingAcknowledged) {
        throw new CreationApiError(400, "billing_acknowledgement_required", "Confirm this video service's billing before the first take.");
      }
      const cost = model.estimatedClipUsd * (request.seeds ?? 2);
      if (cost > budget().remainingUsd) {
        throw new CreationApiError(402, "budget_exceeded", contractFixtures.budgetExceeded.error.message);
      }
      mockModels.reservedUsd += cost;
      const base = contractFixtures.runGenerating.run;
      const now = new Date().toISOString();
      const run: RunView = {
        ...base,
        id: crypto.randomUUID(),
        projectId,
        slideId,
        status: "queued",
        modelId: model.id,
        provider: model.provider,
        motionStyle: request.motion.motionStyle ?? "calm",
        prompt: request.motion.prompt,
        attemptCount: 0,
        takes: [],
        reasons: [],
        costUsd: 0,
        createdAt: now,
        updatedAt: now,
      };
      mockModels.runs.push({ slideId, request, run });
      return { run };
    },
  },
);
