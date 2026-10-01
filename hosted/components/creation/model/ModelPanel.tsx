"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_SEEDS_PLANNED,
  type BudgetResponse,
  type CatalogModelView,
  type CatalogResponse,
  type CreationDocumentV2,
  type SlideV2,
} from "@/lib/contract";
import { CreationApiError } from "../api";
import type { SlidePanelProps } from "../panels";
import { BillingAck } from "./BillingAck";
import { modelClient, money } from "./client";
import { ModelSelector } from "./ModelSelector";
import s from "./model.module.css";

const TAKES = DEFAULT_SEEDS_PLANNED;

/** A slide that can be generated: layers passed their checks and a motion is chosen. */
export const canGenerate = (slide: SlideV2) => Boolean(slide.layers.backgroundAssetId && slide.checks?.ok && slide.motion);
const modelFor = (document: CreationDocumentV2, slide: SlideV2) => slide.modelId ?? document.defaults.modelId;
const ordered = (document: CreationDocumentV2) => [...document.slides].sort((a, b) => a.order - b.order);

type Notice = { tone: "ok" | "error"; text: string } | null;

/** Which model makes the video, what it will cost, and the buttons that start generation (B3). */
export function ModelPanel({ creation, slide, ready, api, edit }: SlidePanelProps) {
  const client = useMemo(() => modelClient(api), [api]);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const keys = useRef(new Map<string, string>()); // Slide id -> idempotency key until the server answers.
  const document = creation.document;

  const load = useCallback(async () => {
    try {
      const [nextCatalog, nextBudget] = await Promise.all([
        client.catalog(creation.id, slide.id),
        client.budget().catch(() => null),
      ]);
      setCatalog(nextCatalog);
      setBudget(nextBudget);
      setLoadError("");
    } catch {
      setLoadError("The list of video models couldn't be loaded. Try again.");
    }
  }, [client, creation.id, slide.id]);
  useEffect(() => {
    setNotice(null);
    void load();
  }, [load]);

  const models = catalog?.models ?? [];
  const find = (id: string): CatalogModelView | undefined => models.find((model) => model.id === id);
  const overriding = slide.modelId !== undefined;
  const slideModel = find(modelFor(document, slide));
  const generatable = ordered(document).filter(canGenerate);
  const costOf = (list: SlideV2[]) => list.reduce((sum, item) => sum + (find(modelFor(document, item))?.estimatedClipUsd ?? 0) * TAKES, 0);
  const slideCost = slideModel ? slideModel.estimatedClipUsd * TAKES : 0;
  const allCost = costOf(generatable);
  const remaining = budget?.remainingUsd ?? null;
  const needsAck = (list: SlideV2[]) => [...new Map(list.map((item) => find(modelFor(document, item)))
    .filter((model): model is CatalogModelView => Boolean(model && model.requiresBillingAck && !model.billingAcknowledged))
    .map((model) => [model.provider, model])).values()];
  const ackFor = needsAck(canGenerate(slide) ? [slide] : [])[0] ?? needsAck(generatable)[0];

  const setDefaultModel = (modelId: string) => edit((doc) => ({ ...doc, defaults: { ...doc.defaults, modelId } }));
  const setSlideModel = (modelId: string | undefined) => edit((doc) => ({
    ...doc,
    slides: doc.slides.map((item) => {
      if (item.id !== slide.id) return item;
      const { modelId: _previous, ...rest } = item;
      return modelId === undefined ? rest : { ...rest, modelId };
    }),
  }));

  const start = async (list: SlideV2[]) => {
    setBusy(true);
    setNotice(null);
    const started: Array<[string, string]> = [];
    let failure = "";
    for (const item of list) {
      const key = keys.current.get(item.id) ?? crypto.randomUUID();
      keys.current.set(item.id, key); // Kept until the server answers, so a retry never starts a second run.
      try {
        const run = await client.startRun(creation.id, item.id, {
          idempotencyKey: key,
          modelId: modelFor(document, item),
          motion: item.motion!,
          seeds: TAKES,
          ...(item.textAnimation ? { textAnimation: item.textAnimation } : {}),
        });
        keys.current.delete(item.id);
        started.push([item.id, run.id]);
      } catch (error) {
        if (error instanceof CreationApiError && error.status >= 400 && error.status < 500) keys.current.delete(item.id);
        failure = error instanceof CreationApiError
          ? (list.length > 1 ? `${item.name}: ${error.message}` : error.message)
          : "Generation couldn't start. Try again.";
        if (error instanceof CreationApiError && error.code === "budget_exceeded") break;
      }
    }
    if (started.length) {
      const runs = new Map(started);
      edit((doc) => ({ ...doc, slides: doc.slides.map((item) => (runs.has(item.id) ? { ...item, latestRunId: runs.get(item.id) } : item)) }));
    }
    setNotice(failure
      ? { tone: "error", text: started.length ? `Started ${started.length} of ${list.length}. ${failure}` : failure }
      : { tone: "ok", text: started.length === 1 ? "Generating. The takes will appear here when they're ready." : `Generating ${started.length} slides.` });
    setBusy(false);
    void client.budget().then(setBudget).catch(() => undefined);
  };

  const overBudget = (cost: number) => remaining !== null && cost > remaining + 1e-9;
  const slideBlocked = !ready ? "Fix this slide's upload checks first."
    : !slide.motion ? "Pick a motion first."
      : !slideModel ? "Choose a video model."
        : slideModel.fit?.ok === false ? slideModel.fit.reason ?? "This model can't take this slide."
          : slideModel.requiresBillingAck && !slideModel.billingAcknowledged ? "Confirm the billing note above first."
            : overBudget(slideCost) ? `This would go over this month's budget (${money(remaining ?? 0)} left).`
              : "";
  const allBlocked = !generatable.length ? "No slide has a motion yet."
    : needsAck(generatable).length ? "Confirm the billing note above first."
      : overBudget(allCost) ? `This would go over this month's budget (${money(remaining ?? 0)} left).`
        : "";
  const waiting = ordered(document).length - generatable.length;

  return (
    <div className={s.panel}>
      <h2 className={s.title}>Video model</h2>
      {loadError && (
        <div className={s.failed} role="status">
          <p>{loadError}</p>
          <button className={s.secondary} onClick={() => void load()}>Try again</button>
        </div>
      )}
      {catalog && (
        <>
          <p className={s.muted}>{overriding ? "Only for this slide." : "For every slide in this creation."}</p>
          <ModelSelector
            name={`model-${slide.id}`}
            models={models}
            value={modelFor(document, slide)}
            onChange={(modelId) => (overriding ? setSlideModel(modelId) : setDefaultModel(modelId))}
          />
          <label className={s.override}>
            <input type="checkbox" checked={overriding}
              onChange={(event) => setSlideModel(event.target.checked ? modelFor(document, slide) : undefined)} />
            Use a different model for this slide
          </label>
          {ackFor && (
            <BillingAck model={ackFor} onAcknowledge={async () => {
              await client.acknowledge(ackFor.provider);
              await load();
            }} />
          )}
          <p className={s.cost} aria-live="polite">
            {slideModel ? <>About {money(slideCost)} for {TAKES} takes{budget && budget.capUsd > 0
              ? ` · ${Math.max(0.1, (slideCost / budget.capUsd) * 100).toFixed(1).replace(/\.0$/, "")}% of this month's budget` : ""}</> : null}
            {budget && <span className={s.remaining}>{money(budget.remainingUsd)} of {money(budget.capUsd)} left this month</span>}
          </p>
        </>
      )}
      <div className={s.actions}>
        <button className={s.primary} disabled={busy || Boolean(slideBlocked) || !catalog} onClick={() => void start([slide])}
          aria-describedby={slideBlocked ? `blocked-${slide.id}` : undefined}>
          {busy ? "Starting…" : "Generate this slide"}
        </button>
        <button className={s.secondary} disabled={busy || Boolean(allBlocked) || !catalog} onClick={() => void start(generatable)}>
          Generate all slides{generatable.length ? ` (${generatable.length} · about ${money(allCost)})` : ""}
        </button>
      </div>
      {slideBlocked && catalog && <p id={`blocked-${slide.id}`} className={s.muted}>{slideBlocked}</p>}
      {waiting > 0 && generatable.length > 0 && (
        <p className={s.muted}>{waiting} {waiting === 1 ? "slide still needs" : "slides still need"} a motion or a fix, so “all” starts {generatable.length}.</p>
      )}
      {notice && <p className={notice.tone === "ok" ? s.ok : s.error} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}
    </div>
  );
}
