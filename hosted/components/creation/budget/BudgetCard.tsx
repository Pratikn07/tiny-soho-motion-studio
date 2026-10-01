"use client";

import { useEffect, useRef, useState } from "react";
import type { BudgetResponse, ProviderId } from "@/lib/contract";
import type { ToolbarItemProps } from "../panels";
import { modelClient, money, PROVIDER_NAMES } from "../model/client";
import c from "./budget.module.css";

const count = (value: number, noun: string) =>
  `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
const monthLabel = (month: string) =>
  month === new Date().toISOString().slice(0, 7)
    ? "This month"
    : new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });

/** O1's owner-only ledger. Spend and available balance come from the server, including open reservations. */
export function BudgetCard({ api, creation }: ToolbarItemProps) {
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    setBudget(null);
    setFailed(false);
    const load = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      setBusy(true);
      try {
        const next = await modelClient(api).budget();
        if (!disposed) {
          setBudget(next);
          setFailed(false);
        }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        inFlight = false;
        if (!disposed) setBusy(false);
      }
    };
    refresh.current = () => {
      void load();
    };
    const resume = () => {
      if (!document.hidden) void load();
    };
    void load();
    const timer = window.setInterval(resume, 30_000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [api, creation?.id]);

  return (
    <span className={c.card}>
      {budget ? (
        <details className={c.details}>
          <summary className={c.summary}>
            <span>
              {monthLabel(budget.month)}: {money(budget.spentUsd)} of{" "}
              {money(budget.capUsd)}
            </span>
            <span className={c.small}>
              {budget.costPerAcceptedClipUsd === null
                ? "No accepted clips yet"
                : `${count(budget.clipsAccepted, "accepted clip")} · ${money(budget.costPerAcceptedClipUsd)} per accepted clip`}
            </span>
          </summary>
          <div className={c.breakdown}>
            <strong>{money(budget.remainingUsd)} available</strong>
            <p>{money(budget.reservedUsd)} reserved for running takes</p>
            <ul>
              {budget.byProvider.map((provider) => (
                <li key={provider.provider}>
                  <strong>
                    {PROVIDER_NAMES[provider.provider as ProviderId] ??
                      provider.provider}
                  </strong>
                  <span>
                    {money(provider.usd)} · {count(provider.clips, "clip")}
                    {provider.gpuSeconds === null
                      ? ""
                      : ` · ${Math.round(provider.gpuSeconds).toLocaleString("en-US")} GPU seconds`}
                  </span>
                </li>
              ))}
            </ul>
            {budget.notes.map((note) => (
              <p className={c.note} key={note}>
                {note}
              </p>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => refresh.current()}
            >
              {busy ? "Refreshing…" : "Refresh budget"}
            </button>
          </div>
        </details>
      ) : !failed ? (
        <span role="status">Loading budget…</span>
      ) : null}
      {failed && (
        <span role="alert" className={c.error}>
          Budget couldn&apos;t be refreshed.{" "}
          {budget && "Showing the last loaded budget."}
          <button
            type="button"
            disabled={busy}
            onClick={() => refresh.current()}
          >
            Try again
          </button>
        </span>
      )}
    </span>
  );
}
