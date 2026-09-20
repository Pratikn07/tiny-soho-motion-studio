import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("vision segmentation upload route", () => {
  it("rejects malformed prompt JSON before contacting the sidecar", async () => {
    const { POST } = await import("@/app/api/vision/segment/route");
    const body = new FormData();
    body.append("image", new File(["fake"], "image.png", { type: "image/png" }));
    body.append("prompts", "not-json");
    const request = new NextRequest("http://127.0.0.1:3001/api/vision/segment", {
      method: "POST",
      headers: { host: "127.0.0.1:3001" },
      body,
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Segmentation prompts must be valid JSON." });
  });
});
