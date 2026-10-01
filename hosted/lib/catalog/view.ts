import {
  DEFAULT_MODEL_ID,
  catalogResponseSchema,
  type CatalogResponse,
  type SlideV2,
} from "@/lib/contract";
import { getVideoModelContract } from "@/lib/video-catalog";
import {
  acknowledgementKey,
  hasProviderAcknowledgement,
  type StoredModelAcknowledgement,
} from "@/lib/model-acknowledgements";

import { fitForSlide } from "./fit";
import { ALIBABA_CONTRACT_IDS, CATALOG_MODELS } from "./models";

/** Legacy per-model Alibaba acknowledgements that still count for the Alibaba provider. */
const legacyAlibabaKeys = Object.values(ALIBABA_CONTRACT_IDS).flatMap((contractId) => {
  const contract = getVideoModelContract(contractId);
  return contract ? [acknowledgementKey(contract.id, contract.contractVersion)] : [];
});

/** `GET /api/catalog`: enabled models, the owner's acknowledgements and, with a slide, each model's fit. */
export function catalogView(input: {
  acknowledgements: readonly StoredModelAcknowledgement[];
  slide?: SlideV2;
}): CatalogResponse {
  return catalogResponseSchema.parse({
    defaultModelId: DEFAULT_MODEL_ID,
    models: CATALOG_MODELS.filter((model) => model.enabled).map((model) => ({
      ...model,
      isDefault: model.id === DEFAULT_MODEL_ID,
      billingAcknowledged: !model.requiresBillingAck
        || hasProviderAcknowledgement(input.acknowledgements, model.provider, legacyAlibabaKeys),
      ...(input.slide ? { fit: fitForSlide(model, input.slide) } : {}),
    })),
  });
}
