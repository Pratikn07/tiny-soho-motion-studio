import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("vision OCR upload route", () => {
  it("rejects an unsupported image type before calling the local sidecar", async () => {
    const { POST } = await import("@/app/api/vision/ocr/route");
    const body = new FormData();
    body.append("image", new File(["not an image"], "copy.svg", { type: "image/svg+xml" }));
    const request = new NextRequest("http://127.0.0.1:3001/api/vision/ocr", {
      method: "POST",
      headers: { host: "127.0.0.1:3001" },
      body,
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Upload a non-empty PNG, JPEG, or WebP image within the 16 MB limit.",
    });
  });
});
