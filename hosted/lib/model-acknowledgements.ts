import type { ProviderId } from "@/lib/contract";

export type AcknowledgementKey = Readonly<{
  modelId: string;
  contractVersion: string;
}>;

export type StoredModelAcknowledgement = Readonly<{
  model_id: string;
  contract_version: string;
}>;

/** One billing acknowledgement per provider and price version, required before that provider's first paid job. */
export const PROVIDER_BILLING_VERSIONS: Readonly<Record<ProviderId, string>> = {
  "modal-ltx": "modal-billing-v1",
  alibaba: "alibaba-billing-v1",
};

export function acknowledgementKey(modelId: string, contractVersion: string): AcknowledgementKey {
  return { modelId, contractVersion };
}

/** Stored in `creative_studio_model_acknowledgements` as `model_id = provider:<id>` with the billing version. */
export function providerAcknowledgementKey(provider: ProviderId): AcknowledgementKey {
  return acknowledgementKey(`provider:${provider}`, PROVIDER_BILLING_VERSIONS[provider]);
}

export function hasAcknowledgement(
  acknowledgements: readonly StoredModelAcknowledgement[],
  key: AcknowledgementKey,
) {
  return acknowledgements.some((acknowledgement) => (
    acknowledgement.model_id === key.modelId
    && acknowledgement.contract_version === key.contractVersion
  ));
}

/** The provider acknowledgement, or for Alibaba an existing per-model acknowledgement from the legacy studio. */
export function hasProviderAcknowledgement(
  acknowledgements: readonly StoredModelAcknowledgement[],
  provider: ProviderId,
  legacyKeys: readonly AcknowledgementKey[] = [],
) {
  return hasAcknowledgement(acknowledgements, providerAcknowledgementKey(provider))
    || (provider === "alibaba" && legacyKeys.some((key) => hasAcknowledgement(acknowledgements, key)));
}
