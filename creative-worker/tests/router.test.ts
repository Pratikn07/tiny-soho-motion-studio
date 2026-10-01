import { describe, expect, it } from "vitest";

import type { ProviderId, VideoProvider } from "../src/contract.js";
import { createProviderRegistry } from "../src/providers/index.js";
import { RouteError, chooseModel, fallbackModel, providerFor } from "../src/router.js";

const fakeProvider = (id: ProviderId): VideoProvider => ({
  id,
  submit: async () => ({ providerTaskId: `${id}-task` }),
  poll: async () => ({ state: "running" }),
});

const registry = createProviderRegistry({}, {
  "modal-ltx": () => fakeProvider("modal-ltx"),
  alibaba: () => fakeProvider("alibaba"),
});

describe("model choice", () => {
  it("routes a Wan take to Alibaba and a take with no choice to LTX", () => {
    expect(providerFor(registry, chooseModel({ slideModelId: "wan2.7-i2v" }).modelId).id).toBe("alibaba");
    expect(chooseModel({})).toEqual({ modelId: "ltx-2.5-distilled", provider: "modal-ltx" });
    expect(providerFor(registry, chooseModel({}).modelId).id).toBe("modal-ltx");
  });

  it("prefers the slide's choice, then the creation default", () => {
    expect(chooseModel({ slideModelId: "wan3-i2v", creationModelId: "wan2.7-i2v" }).modelId).toBe("wan3-i2v");
    expect(chooseModel({ slideModelId: null, creationModelId: "wan2.7-i2v" }).modelId).toBe("wan2.7-i2v");
  });

  it("rejects a model that is not in the catalog", () => {
    expect(() => chooseModel({ slideModelId: "sora-3" })).toThrow(RouteError);
  });
});

describe("fallback", () => {
  it("never re-sends a failed LTX take to Alibaba unless the run allows it", () => {
    expect(fallbackModel({ modelId: "ltx-2.5-distilled", allowFallback: false })).toBeNull();
    expect(fallbackModel({ modelId: "wan2.7-i2v", allowFallback: false })).toBeNull();
  });

  it("switches provider when the creator allowed it for this run", () => {
    expect(fallbackModel({ modelId: "ltx-2.5-distilled", allowFallback: true })).toEqual({ modelId: "wan2.7-i2v", provider: "alibaba" });
    expect(fallbackModel({ modelId: "wan3-i2v", allowFallback: true })).toEqual({ modelId: "ltx-2.5-distilled", provider: "modal-ltx" });
  });
});

describe("provider registry", () => {
  it("leaves out providers without credentials", () => {
    const partial = createProviderRegistry({}, { "modal-ltx": () => fakeProvider("modal-ltx"), alibaba: () => null });
    expect(Object.keys(partial)).toEqual(["modal-ltx"]);
    expect(() => providerFor(partial, "wan2.7-i2v")).toThrow(expect.objectContaining({ code: "provider_not_configured" }));
  });
});
