import {
  billingAcknowledgementResponseSchema,
  budgetResponseSchema,
  catalogResponseSchema,
  runResponseSchema,
  type BudgetResponse,
  type CatalogResponse,
  type CreateRunRequest,
  type ProviderId,
  type RunView,
} from "@/lib/contract";
import type { CreationApi } from "../api";

/** B5's catalog and acknowledgements, O1's budget and B3's run start, through the creation API's sign-in. */
export function modelClient(api: CreationApi) {
  return {
    async catalog(creationId?: string, slideId?: string): Promise<CatalogResponse> {
      const query = creationId && slideId ? `?creationId=${creationId}&slideId=${slideId}` : "";
      return catalogResponseSchema.parse(await api.fetchJson(`/api/catalog${query}`));
    },
    async acknowledge(provider: ProviderId) {
      return billingAcknowledgementResponseSchema.parse(
        await api.fetchJson("/api/catalog/acknowledgements", { method: "POST", body: { provider } }));
    },
    async budget(): Promise<BudgetResponse> {
      return budgetResponseSchema.parse(await api.fetchJson("/api/budget"));
    },
    async startRun(creationId: string, slideId: string, request: CreateRunRequest): Promise<RunView> {
      const body = await api.fetchJson(`/api/creations/${creationId}/slides/${slideId}/runs`, { method: "POST", body: request });
      return runResponseSchema.parse(body).run;
    },
  };
}

export const PROVIDER_NAMES: Record<ProviderId, string> = { "modal-ltx": "Modal", alibaba: "Alibaba Cloud" };

/** Cents for small amounts ("$0.06", "$1.00"); whole dollars from $10 ("$50"). */
export const money = (usd: number) => (usd >= 10 ? `$${usd.toFixed(2).replace(/\.00$/, "")}` : `$${usd.toFixed(2)}`);
