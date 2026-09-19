import { afterEach, describe, expect, it, vi } from "vitest";
import { submitAlibabaJob } from "@/lib/provider";

describe("Alibaba payload serialization", () => {
  const originalKey = process.env.DASHSCOPE_API_KEY;
  const originalWorkspace = process.env.ALIBABA_WORKSPACE_ID;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = originalKey;
    if (originalWorkspace === undefined) delete process.env.ALIBABA_WORKSPACE_ID; else process.env.ALIBABA_WORKSPACE_ID = originalWorkspace;
  });

  const queueResponse = () => {
    process.env.DASHSCOPE_API_KEY = "test-key";
    process.env.ALIBABA_WORKSPACE_ID = "test-workspace";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: { task_id: "provider-task" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("serializes Tiny Soho start and end media as Wan 2.7 first and last frames", async () => {
    const fetchMock = queueResponse();
    await submitAlibabaJob({ modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: "[]", options: JSON.stringify({ duration: 5, resolution: "720P" }) }, [{ role: "start-image", mime: "image/png", bytes: Buffer.from("start") }, { role: "end-image", mime: "image/png", bytes: Buffer.from("end") }]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input.media.map((media: { type: string }) => media.type)).toEqual(["first_frame", "last_frame"]);
  });

  it("sends the Wan 3 aspect ratio and smart duration only in its model-aware payload", async () => {
    const fetchMock = queueResponse();
    await submitAlibabaJob({ modelId: "alibaba:wan3-video", task: "text-to-video", prompt: "Move", inputAssetIds: "[]", options: JSON.stringify({ duration: -1, resolution: "1080P", aspectRatio: "3:4" }) }, []);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.parameters).toMatchObject({ duration: -1, resolution: "1080P", ratio: "3:4" });
  });

  it("serializes a Wan 2.7 reference image with its model-specific ratio", async () => {
    const fetchMock = queueResponse();
    await submitAlibabaJob({ modelId: "alibaba:wan2.7-r2v", task: "reference-to-video", prompt: "Move", inputAssetIds: "[]", options: JSON.stringify({ duration: 5, resolution: "720P", aspectRatio: "9:16" }) }, [{ role: "reference-image", mime: "image/png", bytes: Buffer.from("reference") }]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input.media.map((media: { type: string }) => media.type)).toEqual(["reference_image"]);
    expect(body.parameters.ratio).toBe("9:16");
  });

  it("serializes a Wan 3 first-and-last-frame request with its selected ratio", async () => {
    const fetchMock = queueResponse();
    await submitAlibabaJob({ modelId: "alibaba:wan3-video", task: "image-to-video", prompt: "Move", inputAssetIds: "[]", options: JSON.stringify({ duration: 5, resolution: "720P", aspectRatio: "3:4" }) }, [{ role: "start-image", mime: "image/png", bytes: Buffer.from("start") }, { role: "end-image", mime: "image/png", bytes: Buffer.from("end") }]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input.media.map((media: { type: string }) => media.type)).toEqual(["first_frame", "last_frame"]);
    expect(body.parameters.ratio).toBe("3:4");
  });
});
