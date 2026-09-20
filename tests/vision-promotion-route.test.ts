import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("vision promotion route", () => {
  it("rejects an invalid promotion request before calling the optional sidecar", async () => {
    const { POST } = await import("@/app/api/vision/promote/route");
    const request = new NextRequest("http://127.0.0.1:3001/api/vision/promote", {
      method: "POST",
      headers: { host: "127.0.0.1:3001", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_test", visionArtifactId: "f02f4249-e793-41d0-b075-ef0c0a9d2ebe", expectedKind: "not-a-kind", name: "artifact.png", provenance: {} }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Vision artifact promotion request is invalid." });
  });
});
