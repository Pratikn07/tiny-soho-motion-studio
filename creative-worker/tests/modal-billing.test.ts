import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createModalBillingService, modalBillingResponse } from "../src/modal-billing.js";

const key = "test-signing-key";
const at = Date.parse("2026-10-01T19:00:00Z");
const amounts = { usageUsd: 0.35, creditsAppliedUsd: 0.35, billedUsd: 0 };
const signed = (time = at, url = "/billing/modal?month=2026-10") => ({
  method: "GET", url, headers: {
    "x-tiny-soho-billing-timestamp": String(time),
    "x-tiny-soho-billing-signature": createHmac("sha256", key).update(`GET\n${url}\n${time}`).digest("hex"),
  },
});

describe("Modal billing read service", () => {
  it("serves only authenticated current-cycle summaries", async () => {
    const service = createModalBillingService({ now: () => at, readSummary: async () => amounts });
    const result = await modalBillingResponse(signed(), { key, service, now: () => at });
    expect(result).toEqual({ status: 200, body: { status: "fresh", month: "2026-10", ...amounts, updatedAt: "2026-10-01T19:00:00.000Z" } });
  });

  it("rejects missing, tampered and expired signatures before accessing billing", async () => {
    const service = createModalBillingService({ now: () => at, readSummary: async () => { throw new Error("must not be called"); } });
    for (const req of [
      { method: "GET", url: "/billing/modal?month=2026-10", headers: {} },
      { ...signed(), url: "/billing/modal?month=2026-09" },
      signed(at - 61_000),
    ]) {
      expect((await modalBillingResponse(req, { key, service, now: () => at }))?.status).toBe(401);
    }
    expect((await modalBillingResponse(signed(at, "/billing/modal?month=2026-09"), { key, service, now: () => at }))?.status).toBe(400);
  });

  it("shares in-flight refreshes and keeps a short cache", async () => {
    let now = at;
    let resolve!: (value: typeof amounts) => void;
    let reads = 0;
    const service = createModalBillingService({ now: () => now, readSummary: async () => {
      reads += 1;
      if (reads === 1) return await new Promise<typeof amounts>((done) => { resolve = done; });
      return { ...amounts, usageUsd: 0.4, creditsAppliedUsd: 0.4 };
    } });
    const first = service.get();
    const second = service.get();
    resolve(amounts);
    expect(await first).toEqual(await second);
    expect(await service.get()).toMatchObject({ usageUsd: 0.35 });
    expect(reads).toBe(1);
    now += 60_001;
    expect(await service.get()).toMatchObject({ usageUsd: 0.4 });
  });

  it("retains last successful values as stale and never carries them into a new month", async () => {
    let now = at;
    const service = createModalBillingService({ now: () => now, readSummary: async () => {
      if (now !== at) throw new Error("provider unavailable");
      return amounts;
    } });
    await service.get();
    now += 60_001;
    expect(await service.get()).toMatchObject({ status: "stale", usageUsd: 0.35, updatedAt: "2026-10-01T19:00:00.000Z" });
    now = Date.parse("2026-11-01T00:00:00Z");
    expect(await service.get()).toEqual({ status: "unavailable", month: "2026-11" });
  });

  it("marks malformed provider output unavailable rather than inventing zero usage", async () => {
    const service = createModalBillingService({ now: () => at, readSummary: async () => ({ ...amounts, usageUsd: Number.NaN }) });
    expect(await service.get()).toEqual({ status: "unavailable", month: "2026-10" });
  });
});
