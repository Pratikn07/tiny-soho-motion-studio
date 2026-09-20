import { describe, expect, it } from "vitest";
import { createSingleFlightRunner } from "@/lib/worker-loop";

describe("worker single-flight execution", () => {
  it("coalesces overlapping tick requests into one active tick", async () => {
    let runs = 0;
    let finish: (() => void) | undefined;
    const runner = createSingleFlightRunner(async () => {
      runs += 1;
      if (runs === 1) await new Promise<void>((resolve) => { finish = resolve; });
    });

    const first = runner();
    const second = runner();
    expect(runs).toBe(1);
    expect(second).toBe(first);
    finish?.();
    await first;
    await runner();
    expect(runs).toBe(2);
  });
});
