export type AcknowledgementKey = Readonly<{
  modelId: string;
  contractVersion: string;
}>;

export type StoredModelAcknowledgement = Readonly<{
  model_id: string;
  contract_version: string;
}>;

export function acknowledgementKey(modelId: string, contractVersion: string): AcknowledgementKey {
  return { modelId, contractVersion };
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
