import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/media-transport/capabilities/route";

const originalCapability = process.env.TINY_SOHO_BAILIAN_TEMPORARY_UPLOAD_CAPABILITY;
const request = () => new NextRequest("http://127.0.0.1:3001/api/media-transport/capabilities", { headers: { host: "127.0.0.1:3001" } });

afterEach(() => {
  if (originalCapability === undefined) delete process.env.TINY_SOHO_BAILIAN_TEMPORARY_UPLOAD_CAPABILITY;
  else process.env.TINY_SOHO_BAILIAN_TEMPORARY_UPLOAD_CAPABILITY = originalCapability;
});

describe("media transport capability API", () => {
  it("reports inline image availability separately from unavailable local URL-required media", async () => {
    delete process.env.TINY_SOHO_BAILIAN_TEMPORARY_UPLOAD_CAPABILITY;
    const response = GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transport).toMatchObject({ id: "bailian-temporary-upload", state: "probe-required" });
    const r2v = body.models.find((model: { modelId: string }) => model.modelId === "alibaba:wan2.7-r2v");
    expect(r2v).toBeDefined();
    expect(r2v.media.find((item: { role: string }) => item.role === "reference-image")).toMatchObject({ available: true, reason: null });
    expect(r2v.media.find((item: { role: string }) => item.role === "reference-video")).toMatchObject({ available: false, reason: expect.stringMatching(/not .*verified/i) });
    expect(r2v.media.find((item: { role: string }) => item.role === "reference-voice")).toMatchObject({ available: false, reason: expect.stringMatching(/not .*verified/i) });
    expect(r2v.media.find((item: { role: string }) => item.role === "existing-public-url")).toMatchObject({ available: true, reason: null });
  });
});
