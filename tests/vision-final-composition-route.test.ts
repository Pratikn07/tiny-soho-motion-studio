import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("final typography composition route", () => {
  it("rejects an incomplete request before reading persistent project assets", async () => {
    const { POST } = await import("@/app/api/vision/motion-packages/compose/route");
    const request = new NextRequest("http://127.0.0.1:3001/api/vision/motion-packages/compose", {
      method: "POST",
      headers: { host: "127.0.0.1:3001", "content-type": "application/json" },
      body: JSON.stringify({ rawVideoAssetId: "asset_raw" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Final typography composition request is invalid." });
  });
});
