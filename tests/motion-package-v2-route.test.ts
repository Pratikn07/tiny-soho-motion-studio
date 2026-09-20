import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("MotionPackageV2 validation route", () => {
  it("rejects an invalid package before reading local media or creating a job", async () => {
    const { POST } = await import("@/app/api/vision/motion-packages/route");
    const request = new NextRequest("http://127.0.0.1:3001/api/vision/motion-packages", {
      method: "POST",
      headers: { host: "127.0.0.1:3001", "content-type": "application/json" },
      body: JSON.stringify({ version: "2", projectId: "project_test" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "MotionPackageV2 request is invalid." });
  });
});
