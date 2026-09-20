import { describe, expect, it } from "vitest";

describe("experimental Vision Lab state model", () => {
  it("renders unavailable as a distinct non-error state and retains safe plan JSON", async () => {
    const { stateFromResponse, planJson } = await import("@/app/vision-lab/model");

    expect(stateFromResponse(503)).toBe("unavailable");
    expect(stateFromResponse(200)).toBe("success");
    expect(stateFromResponse(400)).toBe("error");
    expect(planJson({ status: "ready", final: { subject: { x: 0, y: 0 }, camera: { x: 0, y: 0 } } })).toContain('"status": "ready"');
  });
});
