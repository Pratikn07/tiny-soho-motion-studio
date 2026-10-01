"use client";

import { useState } from "react";

import type { CatalogModelView } from "@/lib/contract";
import { money, PROVIDER_NAMES } from "./client";
import s from "./model.module.css";

const HOW_BILLED: Record<CatalogModelView["provider"], string> = {
  "modal-ltx": "Modal charges by the second of GPU time while a clip is made.",
  alibaba: "Alibaba Cloud charges per second of video made.",
};

/** The first time a paid video service is used, say in plain words who charges what. Shown once per provider. */
export function BillingAck({ model, onAcknowledge }: { model: CatalogModelView; onAcknowledge: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const provider = PROVIDER_NAMES[model.provider];
  return (
    <section className={s.ack} aria-labelledby={`ack-${model.provider}`}>
      <h3 id={`ack-${model.provider}`}>Before the first video from {provider}</h3>
      <p>
        {HOW_BILLED[model.provider]} A clip costs about {money(model.estimatedClipUsd)}, and each slide makes 2 takes
        so you can choose. Charges go to the {provider} account connected to this studio, and generation stops at
        this month&rsquo;s budget.
      </p>
      <button className={s.primary} disabled={busy} onClick={async () => {
        setBusy(true);
        setError("");
        try {
          await onAcknowledge();
        } catch {
          setError("That didn't save. Try again.");
        } finally {
          setBusy(false);
        }
      }}>
        {busy ? "Saving…" : "I understand, continue"}
      </button>
      {error && <p className={s.error} role="alert">{error}</p>}
    </section>
  );
}
