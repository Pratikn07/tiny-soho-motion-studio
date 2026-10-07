"use client";

import { useEffect, useState } from "react";

import type { MacState } from "./ShellBar";

const POLL_MS = 30_000;

/**
 * The Studio Mac runner's status for the shell's chip, refreshed every 30 seconds while signed in. Any failure
 * (signed out, network, runner not set up) shows as "not set up" rather than a guess.
 */
export function useRunnerStatus(getAccessToken: (() => Promise<string | null>) | null, enabled: boolean): MacState {
  const [state, setState] = useState<MacState>("not-set-up");
  useEffect(() => {
    if (!enabled || !getAccessToken) return;
    let alive = true;
    const read = async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const response = await fetch("/api/runner/status", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
        const body = response.ok ? await response.json() as { state?: MacState } : null;
        if (alive) setState(body?.state === "online" || body?.state === "asleep" ? body.state : "not-set-up");
      } catch {
        if (alive) setState("not-set-up");
      }
    };
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [enabled, getAccessToken]);
  return state;
}
