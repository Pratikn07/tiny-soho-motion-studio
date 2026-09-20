import { describe, expect, it } from "vitest";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";

describe("hosted Studio route errors", () => {
  it("returns a safe status and code without exposing an unexpected error", async () => {
    const response = routeErrorResponse(new Error("database password: secret"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "studio_internal_error", message: "Studio service is temporarily unavailable." },
    });
  });

  it("preserves the intended status and safe message of a Studio error", async () => {
    const response = routeErrorResponse(new StudioError(403, "not_allowed", "Studio access is not available."));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_allowed", message: "Studio access is not available." },
    });
  });
});
