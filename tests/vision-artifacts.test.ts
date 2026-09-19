import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

describe("vision artifact proxy", () => {
  it("rejects a path-like artifact ID before contacting the sidecar", async () => {
    const { GET } = await import("@/app/api/vision/artifacts/[id]/route");
    const request = new NextRequest("http://127.0.0.1:3001/api/vision/artifacts/invalid", { headers: { host: "127.0.0.1:3001" } });

    const response = await GET(request, { params: Promise.resolve({ id: "../../etc/passwd" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid vision artifact ID." });
  });
});
