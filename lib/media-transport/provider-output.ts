export const providerOutputTtlMs = 24 * 60 * 60 * 1000;

export function providerOutputProvenance(url: string, observedAt = Date.now()) {
  return {
    url,
    expiresAt: new Date(observedAt + providerOutputTtlMs).toISOString(),
  };
}
