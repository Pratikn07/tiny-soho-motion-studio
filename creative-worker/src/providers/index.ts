import type { ProviderId, VideoProvider } from "../contract.js";

/** Builds a provider from the worker's environment, or returns null when its credentials are missing. */
export type ProviderFactory = (env: NodeJS.ProcessEnv) => VideoProvider | null;

export type ProviderRegistry = Partial<Record<ProviderId, VideoProvider>>;

/** One registration line per provider: modal-ltx (P2) and alibaba (P3). */
export const PROVIDER_FACTORIES: Partial<Record<ProviderId, ProviderFactory>> = {};

export function createProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
  factories: Partial<Record<ProviderId, ProviderFactory>> = PROVIDER_FACTORIES,
): ProviderRegistry {
  const registry: ProviderRegistry = {};
  for (const [id, factory] of Object.entries(factories) as Array<[ProviderId, ProviderFactory]>) {
    const provider = factory(env);
    if (provider) registry[id] = provider;
  }
  return registry;
}
