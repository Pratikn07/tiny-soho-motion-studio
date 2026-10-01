import { describe, expect, it, vi } from "vitest";

import type { GenerationInput } from "../src/contract.js";
import { alibabaProviderFromEnv, alibabaRequest, createAlibabaProvider } from "../src/providers/alibaba.js";
import { createProviderRegistry } from "../src/providers/index.js";

const input: GenerationInput = {
  idempotencyKey: "c0ad6b4d-c2ef-4e15-9fd1-8d02f1e0dfcc",
  modelId: "wan2.7-i2v",
  backgroundUrl: "https://signed.example/background.webp",
  outputUploadUrl: "https://signed.example/upload/raw.mp4",
  prompt: "A toddler smiles. The camera remains static throughout, with no zoom, no pan and no cut.",
  seed: 42,
  width: 768,
  height: 960,
  frames: 121,
  fps: 24,
  endFrame: { strength: 0.6 },
};
const config = { apiKey: "sk-test", workspaceId: "ws-test" };

// Recorded DashScope replies (shapes from the Wan 2.7 image-to-video API reference).
const submitted = { request_id: "r1", output: { task_id: "0385dc79-5ff8-4d82-bcb6-xxxxxx", task_status: "PENDING" } };
const pending = { request_id: "r2", output: { task_id: "0385dc79-5ff8-4d82-bcb6-xxxxxx", task_status: "RUNNING" }, usage: null };
const succeeded = {
  request_id: "r3",
  output: { task_id: "0385dc79-5ff8-4d82-bcb6-xxxxxx", task_status: "SUCCEEDED", video_url: "https://dashscope-result-sgp.oss-ap-southeast-1.aliyuncs.com/x.mp4" },
  usage: { duration: 5, input_video_duration: 0, output_video_duration: 5, video_count: 1, SR: 720 },
};
const failed = { request_id: "r4", output: { task_id: "0385dc79-5ff8-4d82-bcb6-xxxxxx", task_status: "FAILED", code: "InvalidParameter", message: "secret detail" } };

describe("Alibaba Wan request", () => {
  it("sends only the background, pinned as first and last frame, with the exact prompt, seed, 720P and 5 s", () => {
    const request = alibabaRequest(input);
    expect(request.path).toBe("/services/aigc/video-generation/video-synthesis");
    expect(request.body).toEqual({
      model: "wan2.7-i2v",
      input: {
        prompt: input.prompt,
        media: [
          { type: "first_frame", url: input.backgroundUrl },
          { type: "last_frame", url: input.backgroundUrl },
        ],
      },
      parameters: { duration: 5, resolution: "720P", prompt_extend: false, watermark: false, seed: 42 },
    });
  });

  it("sends the first frame alone without an end frame, and maps Wan 3 to its contract", () => {
    const { endFrame: _pin, ...unpinned } = input;
    expect(alibabaRequest(unpinned).body.input.media).toEqual([{ type: "first_frame", url: input.backgroundUrl }]);
    expect(alibabaRequest({ ...input, modelId: "wan3-i2v" }).body.model).toBe("wan3.0-video");
    expect(() => alibabaRequest({ ...input, modelId: "ltx-2.5-distilled" })).toThrow("alibaba_model_unsupported");
  });
});

describe("Alibaba provider", () => {
  it("submits once and polls to a priced result", async () => {
    const replies = [submitted, pending, succeeded];
    const fetcher = vi.fn(async () => Response.json(replies.shift()));
    const provider = createAlibabaProvider(config, fetcher);

    const { providerTaskId } = await provider.submit(input);
    expect(providerTaskId).toBe("wan2.7-i2v|0385dc79-5ff8-4d82-bcb6-xxxxxx");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ws-test.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis");
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk-test", "X-DashScope-Async": "enable" });

    expect(await provider.poll(providerTaskId)).toEqual({ state: "running" });
    expect(await provider.poll(providerTaskId)).toEqual({ state: "succeeded", resultUrl: succeeded.output.video_url, costUsd: 0.5 });
    expect(String((fetcher.mock.calls[2] as unknown as [string])[0])).toMatch(/\/tasks\/0385dc79-5ff8-4d82-bcb6-xxxxxx$/);
  });

  it("reports a failed task by code only", async () => {
    const provider = createAlibabaProvider(config, async () => Response.json(failed));
    expect(await provider.poll("wan2.7-i2v|t")).toEqual({ state: "failed", errorCode: "alibaba_invalidparameter" });
  });

  it("raises DashScope's error code, never its message", async () => {
    const provider = createAlibabaProvider(config, async () => Response.json({ code: "InvalidApiKey", message: "key sk-test is invalid" }, { status: 401 }));
    await expect(provider.submit(input)).rejects.toThrow(/^alibaba_InvalidApiKey$/);
  });

  it("registers only with DashScope credentials", () => {
    expect(alibabaProviderFromEnv({})).toBeNull();
    expect(Object.keys(createProviderRegistry({ DASHSCOPE_API_KEY: "k", ALIBABA_WORKSPACE_ID: "w" }))).toEqual(["alibaba"]);
    expect(createProviderRegistry({})).toEqual({});
  });
});
