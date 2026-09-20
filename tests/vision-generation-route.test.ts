import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("VisionGenerationBridge route", () => {
  it("rejects an incomplete request before opening a project or queuing work", async () => {
    const { POST } = await import("@/app/api/vision/motion-packages/generate/route");
    const request = new NextRequest("http://127.0.0.1:3001/api/vision/motion-packages/generate", {
      method: "POST",
      headers: { host: "127.0.0.1:3001", "content-type": "application/json" },
      body: JSON.stringify({ generationAttemptId: "tap-1" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Vision generation request is invalid." });
  });
});
