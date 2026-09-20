import { afterEach, describe, expect, it, vi } from "vitest";
import { submitAlibabaJob } from "@/lib/provider";

const media = (role: string, mime: string, value: string, referenceVoice?: string) => ({ role, mime, locator: { kind: value.startsWith("data:") ? "data-url" : "public-url", value }, ...(referenceVoice ? { referenceVoice: { kind: "public-url", value: referenceVoice } } : {}) });

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
    await submitAlibabaJob({ modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: "[]", options: JSON.stringify({ duration: 5, resolution: "720P" }) }, [media("start-image", "image/png", "data:image/png;base64,c3RhcnQ=") as any, media("end-image", "image/png", "data:image/png;base64,ZW5k") as any]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input.media.map((media: { type: string }) => media.type)).toEqual(["first_frame", "last_frame"]);
  });

  it("sends the Wan 3 aspect ratio and smart duration only in its model-aware payload", async () => {
    const fetchMock = queueResponse();
    await submitAlibabaJob({ modelId: "alibaba:wan3-video", task: "text-to-video", prompt: "Move", inputAssetIds: "[]", options: JSON.stringify({ duration: -1, resolution: "1080P", aspectRatio: "3:4" }) }, []);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.parameters).toMatchObject({ duration: -1, resolution: "1080P", ratio: "3:4" });
  });

  it("serializes Wan 2.7 per-reference voice on its reference asset rather than as standalone audio", async () => {
    const fetchMock = queueResponse();
    await submitAlibabaJob({ modelId: "alibaba:wan2.7-r2v", task: "reference-to-video", prompt: "Move", inputAssetIds: "[]", options: JSON.stringify({ duration: 5, resolution: "720P", aspectRatio: "9:16" }) }, [media("reference-image", "image/png", "data:image/png;base64,cmVmZXJlbmNl", "https://media.example.test/voice.mp3") as any, media("reference-video", "video/mp4", "https://media.example.test/reference.mp4") as any]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input.media.map((media: { type: string }) => media.type)).toEqual(["reference_image", "reference_video"]);
    expect(body.input.media[0]).toMatchObject({ reference_voice: "https://media.example.test/voice.mp3" });
    expect(JSON.stringify(body.input.media)).not.toContain("reference_audio");
  });

  it("serializes a Wan 3 first-and-last-frame request with its selected ratio", async () => {
    const fetchMock = queueResponse();
    await submitAlibabaJob({ modelId: "alibaba:wan3-video", task: "image-to-video", prompt: "Move", inputAssetIds: "[]", options: JSON.stringify({ duration: 5, resolution: "720P", aspectRatio: "3:4" }) }, [media("start-image", "image/png", "data:image/png;base64,c3RhcnQ=") as any, media("end-image", "image/png", "data:image/png;base64,ZW5k") as any]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input.media.map((media: { type: string }) => media.type)).toEqual(["first_frame", "last_frame"]);
    expect(body.parameters.ratio).toBe("3:4");
  });

  it("serializes Wan 2.7 I2V driving audio as a URL-only provider media role", async () => {
    const fetchMock = queueResponse();
    await submitAlibabaJob({ modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move with the supplied track", inputAssetIds: "[]", options: JSON.stringify({ duration: 5, resolution: "720P" }) }, [media("start-image", "image/png", "data:image/png;base64,c3RhcnQ=") as any, media("driving-audio", "audio/mpeg", "https://media.example.test/track.mp3") as any]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input.media.map((item: { type: string }) => item.type)).toEqual(["first_frame", "driving_audio"]);
  });
});
