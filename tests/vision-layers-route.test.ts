import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("vision layers upload route", () => {
  it("rejects an oversized image before contacting the sidecar", async () => {
    const { POST } = await import("@/app/api/vision/layers/route");
    const body = new FormData();
    body.append("image", new File([new Uint8Array(16 * 1024 * 1024 + 1)], "image.png", { type: "image/png" }));
    const request = new NextRequest("http://127.0.0.1:3001/api/vision/layers", {
      method: "POST",
      headers: { host: "127.0.0.1:3001" },
      body,
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Upload a non-empty PNG, JPEG, or WebP image within the 16 MB limit." });
  });
});
