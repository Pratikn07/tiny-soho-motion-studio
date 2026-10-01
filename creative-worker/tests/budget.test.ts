import { describe, expect, it, vi } from "vitest";

import { budgetReserver, monthlyCapUsd, settleJobSpend } from "../src/budget.js";
import type { PipelineRunRow } from "../src/contract.js";

const run = { id: "run-1", owner_user_id: "owner-1" } as PipelineRunRow;

describe("monthly cap", () => {
  it("defaults to $50 and treats an unreadable value as $0", () => {
    expect(monthlyCapUsd({})).toBe(50);
    expect(monthlyCapUsd({ TINY_SOHO_MONTHLY_CAP_USD: "0.10" })).toBe(0.1);
    expect(monthlyCapUsd({ TINY_SOHO_MONTHLY_CAP_USD: "fifty" })).toBe(0);
    expect(monthlyCapUsd({ TINY_SOHO_MONTHLY_CAP_USD: "-5" })).toBe(0);
  });
});

describe("budget reservation", () => {
  it("reserves the catalog estimate for the take's model under the cap", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const reserve = budgetReserver({ rpc }, 0.1);
    expect(await reserve(run, "run-1:1", "ltx-2.5-distilled")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("reserve_creative_studio_budget", {
      p_owner_user_id: "owner-1", p_reservation_key: "run-1:1", p_run_id: "run-1", p_usd: 0.03, p_cap_usd: 0.1,
    });
  });

  it("refuses when the database says the cap would be passed, or the model has no price", async () => {
    const reserve = budgetReserver({ rpc: async () => ({ data: false, error: null }) }, 0.1);
    expect(await reserve(run, "run-1:2", "wan2.7-i2v")).toBe(false);
    const rpc = vi.fn();
    expect(await budgetReserver({ rpc }, 50)(run, "run-1:3", "sora-3")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails loudly rather than spending when the reservation can't be checked", async () => {
    const reserve = budgetReserver({ rpc: async () => ({ data: null, error: { message: "down" } }) }, 50);
    await expect(reserve(run, "run-1:1", "ltx-2.5-distilled")).rejects.toThrow("budget_reserve_failed");
  });

  it("settles a job through the ledger function", async () => {
    const rpc = vi.fn(async () => ({ data: "recorded", error: null }));
    expect(await settleJobSpend({ rpc }, "job-1")).toBe("recorded");
    expect(rpc).toHaveBeenCalledWith("settle_creative_studio_job_spend", { p_job_id: "job-1" });
  });
});
