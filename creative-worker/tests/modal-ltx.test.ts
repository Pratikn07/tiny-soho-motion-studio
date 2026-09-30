import { describe, expect, it, vi } from "vitest";
import { createModalLtxProvider, ModalLtxInputError, type GenerationInput, type ModalLtxClient } from "../src/providers/modal-ltx.js";

const input: GenerationInput = {
  idempotencyKey: "66666666-6666-4666-8666-666666666666",
  modelId: "ltx-2.5-distilled",
  backgroundUrl: "https://storage.example/sign/background?token=x",
  outputUploadUrl: "https://storage.example/upload/sign/raw.mp4?token=y",
  prompt: "She smiles. The camera remains static throughout, with no zoom, no pan and no cut.",
  seed: 42,
  width: 768,
  height: 960,
  frames: 121,
  fps: 24,
  endFrame: { strength: 0.6 },
};

function fakeClient(result: Awaited<ReturnType<ModalLtxClient["result"]>>) {
  return { spawn: vi.fn(async () => "fc-01ABC"), result: vi.fn(async () => result) } satisfies ModalLtxClient;
}

describe("Modal LTX provider", () => {
  it("spawns one call per take and passes only the generation input", async () => {
    const client = fakeClient({ state: "running" });
    const provider = createModalLtxProvider({ client, outputExists: async () => false });
    await expect(provider.submit(input)).resolves.toEqual({ providerTaskId: "fc-01ABC" });
    expect(client.spawn).toHaveBeenCalledWith(input);
    await expect(provider.poll("fc-01ABC")).resolves.toEqual({ state: "running" });
  });

  it("does not start a GPU call when the take's raw.mp4 already exists", async () => {
    const client = fakeClient({ state: "running" });
    const provider = createModalLtxProvider({ client, outputExists: async () => true });
    const { providerTaskId } = await provider.submit(input);
    expect(client.spawn).not.toHaveBeenCalled();
    await expect(provider.poll(providerTaskId)).resolves.toEqual({ state: "succeeded", uploaded: true, gpuSeconds: 0, costUsd: 0 });
    expect(client.result).not.toHaveBeenCalled();
  });

  it("records GPU seconds and cost, including the model load paid by the first clip", async () => {
    const provider = createModalLtxProvider({
      client: fakeClient({ state: "done", value: { ok: true, uploaded: true, gpuSeconds: 36.5, loadSeconds: 60, peakGib: 42.62 } }),
    });
    await expect(provider.poll("fc-01ABC")).resolves.toEqual({
      state: "succeeded", uploaded: true, gpuSeconds: 36.5, costUsd: 0.0813, peakGib: 42.62,
    });
  });

  it("charges nothing for a result Modal already had for this take", async () => {
    const provider = createModalLtxProvider({ client: fakeClient({ state: "done", value: { ok: true, reused: true, gpuSeconds: 40 } }) });
    await expect(provider.poll("fc-01ABC")).resolves.toMatchObject({ state: "succeeded", costUsd: 0, gpuSeconds: 0 });
  });

  it("maps refusals and failed calls to error codes", async () => {
    const refused = createModalLtxProvider({ client: fakeClient({ state: "done", value: { ok: false, errorCode: "ltx_upload_failed" } }) });
    await expect(refused.poll("fc-01ABC")).resolves.toEqual({ state: "failed", errorCode: "ltx_upload_failed" });
    const timedOut = createModalLtxProvider({ client: fakeClient({ state: "error", kind: "timeout" }) });
    await expect(timedOut.poll("fc-01ABC")).resolves.toEqual({ state: "failed", errorCode: "ltx_call_timeout" });
    await expect(timedOut.poll("../../etc")).resolves.toEqual({ state: "failed", errorCode: "ltx_call_unknown" });
  });

  it("lets transport errors through so the worker polls again instead of failing the take", async () => {
    const client: ModalLtxClient = { spawn: vi.fn(), result: vi.fn(async () => { throw new Error("UNAVAILABLE"); }) };
    await expect(createModalLtxProvider({ client }).poll("fc-01ABC")).rejects.toThrow("UNAVAILABLE");
  });

  it("refuses sizes LTX cannot render and inputs without an upload URL before spawning", async () => {
    const client = fakeClient({ state: "running" });
    const provider = createModalLtxProvider({ client });
    await expect(provider.submit({ ...input, width: 770 })).rejects.toMatchObject({ code: "model_unsupported_for_slide" });
    await expect(provider.submit({ ...input, outputUploadUrl: undefined })).rejects.toBeInstanceOf(ModalLtxInputError);
    expect(client.spawn).not.toHaveBeenCalled();
  });
});
