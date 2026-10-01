import type { ProviderId, VideoProvider } from "./contract.js";
import type { ProviderRegistry } from "./providers/index.js";

export const DEFAULT_MODEL_ID = "ltx-2.5-distilled";

/** Which provider runs each catalog model; kept equal to `hosted/lib/catalog/models.ts` by a hosted test. */
export const MODEL_PROVIDERS: Readonly<Record<string, ProviderId>> = {
  "ltx-2.5-distilled": "modal-ltx",
  "wan2.7-i2v": "alibaba",
  "wan3-i2v": "alibaba",
};

/** The model tried when a run allows falling back to the other provider. */
const FALLBACK_MODEL: Readonly<Record<ProviderId, string>> = {
  "modal-ltx": "wan2.7-i2v",
  alibaba: DEFAULT_MODEL_ID,
};

export type RoutedModel = { modelId: string; provider: ProviderId };

export class RouteError extends Error {
  constructor(readonly code: "model_unsupported_for_slide" | "provider_not_configured", message: string) {
    super(message);
    this.name = "RouteError";
  }
}

function routed(modelId: string): RoutedModel {
  const provider = MODEL_PROVIDERS[modelId];
  if (!provider) throw new RouteError("model_unsupported_for_slide", `Unknown model ${modelId}.`);
  return { modelId, provider };
}

/** The creator's per-slide choice, then the creation default, then LTX. */
export function chooseModel(choice: { slideModelId?: string | null; creationModelId?: string | null }): RoutedModel {
  return routed(choice.slideModelId || choice.creationModelId || DEFAULT_MODEL_ID);
}

/**
 * The model for the next attempt after a provider failure. Without the creator's permission for this run the
 * answer is null: a failed LTX take is never silently re-sent to a far more expensive provider.
 */
export function fallbackModel(run: { modelId: string; allowFallback: boolean }): RoutedModel | null {
  if (!run.allowFallback) return null;
  return routed(FALLBACK_MODEL[routed(run.modelId).provider]);
}

/** The configured provider for a model, for submitting and polling its jobs. */
export function providerFor(registry: ProviderRegistry, modelId: string): VideoProvider {
  const { provider } = routed(modelId);
  const instance = registry[provider];
  if (!instance) throw new RouteError("provider_not_configured", `The ${provider} provider is not configured on this worker.`);
  return instance;
}
