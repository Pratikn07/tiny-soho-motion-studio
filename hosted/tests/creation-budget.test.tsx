// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetCard } from "@/components/creation/budget/BudgetCard";
import { createMockCreationApi } from "@/components/creation/mock-api";
import { contractFixtures } from "@/lib/contract/fixtures";

const budget = () => ({
  ...structuredClone(contractFixtures.budget),
  month: new Date().toISOString().slice(0, 7),
});
const setup = (fetchJson = vi.fn().mockResolvedValue(budget())) => {
  const api = createMockCreationApi();
  api.fetchJson = fetchJson;
  render(<BudgetCard api={api} creation={null} />);
  return fetchJson;
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("creation budget", () => {
  it("loads authoritative spend, reservations, providers and accepted-clip cost", async () => {
    const fetchJson = setup();
    expect(screen.getByText("Loading budget…")).toBeInTheDocument();
    expect(
      await screen.findByText("This month: $6.40 of $50"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("188 accepted clips · $0.03 per accepted clip"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("This month: $6.40 of $50"));
    expect(screen.getByText("$43.54 available")).toBeInTheDocument();
    expect(
      screen.getByText("$0.06 reserved for running takes"),
    ).toBeInTheDocument();
    expect(screen.getByText("Modal").parentElement).toHaveTextContent(
      "$5.90 · 196 clips · 7,007 GPU seconds",
    );
    expect(screen.getByText("Alibaba Cloud").parentElement).toHaveTextContent(
      "$0.50 · 1 clip",
    );
    expect(screen.getByText(/credit is not guaranteed/)).toBeInTheDocument();
    expect(fetchJson).toHaveBeenCalledWith("/api/budget");
  });

  it("recovers from an unavailable budget without showing made-up zero spend", async () => {
    const fetchJson = setup(
      vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(budget()),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Budget couldn't be refreshed.",
    );
    expect(screen.queryByText(/of \$50/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("This month: $6.40 of $50"),
    ).toBeInTheDocument();
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("refreshes on returning to the tab and marks retained values as stale on failure", async () => {
    const fetchJson = setup();
    await screen.findByText("This month: $6.40 of $50");
    fetchJson.mockRejectedValueOnce(new Error("offline"));
    fireEvent(window, new Event("focus"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Showing the last loaded budget.",
    );
    expect(screen.getByText("This month: $6.40 of $50")).toBeInTheDocument();
    fetchJson.mockResolvedValue({
      ...budget(),
      spentUsd: 7,
      reservedUsd: 1,
      remainingUsd: 42,
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("This month: $7.00 of $50");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("$42 available")).toBeInTheDocument();
  });

  it("keeps the monthly ledger current without overlapping requests", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const fetchJson = setup(
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValue(budget()),
    );
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(budget());
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("names the actual ledger month and avoids a fictitious cost when no clips were accepted", async () => {
    setup(
      vi
        .fn()
        .mockResolvedValue({
          ...budget(),
          month: "2025-01",
          clipsAccepted: 0,
          costPerAcceptedClipUsd: null,
        }),
    );
    expect(
      await screen.findByText("January 2025: $6.40 of $50"),
    ).toBeInTheDocument();
    expect(screen.getByText("No accepted clips yet")).toBeInTheDocument();
    expect(screen.queryByText(/per accepted clip/)).not.toBeInTheDocument();
  });

  it("rejects inconsistent budget replies instead of displaying their totals", async () => {
    setup(vi.fn().mockResolvedValue({ ...budget(), remainingUsd: 99 }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Budget couldn't be refreshed.",
    );
    expect(screen.queryByText(/\$99/)).not.toBeInTheDocument();
  });
});
