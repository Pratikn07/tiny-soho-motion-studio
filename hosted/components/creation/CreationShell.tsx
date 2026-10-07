"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";

import { MAX_SLIDES, type CreationSummary, type SlideV2 } from "@/lib/contract";
import { CreationSidebar } from "@/components/carousel/CreationSidebar";
import Icon from "@/components/carousel/Icons";
import { isConflict, type CreationApi } from "./api";
import { SLIDE_PANELS, TOOLBAR_ITEMS } from "./panels";
import { ordered, useCreation, withOrder, type DocumentEdit } from "./useCreation";
import { CreationUpload, type FilePickerHandle } from "./upload/CreationUpload";
import { LayerPairing } from "./upload/LayerPairing";
import { backgroundOnly, pairFiles, ratioLabel, type LayerPair, type RejectedFile, type UnpairedFile } from "./upload/pairing";
import { slideStatus, statusText } from "./upload/SlideCard";
import { SlideRail } from "./upload/SlideRail";
import { UploadChecks } from "./upload/UploadChecks";
import { useUploads } from "./upload/useUploads";
import { DirectionStatus } from "./direction/DirectionStatus";
import { FinishedUpload, imageFiles } from "./direction/FinishedUpload";
import { useDirection } from "./direction/useDirection";
import c from "./creation.module.css";

const PARAM = "creation";
const WORKFLOW = ["Motion", "Text", "Review", "Results"] as const;
const URL_LIFETIME_MS = 4 * 60 * 1000; // Signed URLs last 300 s; refresh before they expire.

const readParam = () => (typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get(PARAM));
function writeParam(id: string | null, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(PARAM, id);
  else url.searchParams.delete(PARAM);
  if (url.href === window.location.href) return;
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
}

const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const slideName = (file: File) => file.name.replace(/\.[^.]+$/, "").slice(0, 255) || "Slide";

/**
 * The creation page: history, the slide rail, the selected slide, and an inspector whose panels later tasks fill.
 * A new creation starts from finished slides (the motion director separates their words) or from layers.
 * `initialUploadMode` defaults to layers for older entry points; the production page opens on finished slides.
 */
export function CreationShell({ api, onSignOut, initialUploadMode = "layers", directionPollMs, topbar }: {
  api: CreationApi;
  onSignOut?: () => void;
  /** Replaces the page's own wordmark, tools and sign out, e.g. with the Studio shell's section bar. */
  topbar?: ReactNode;
  initialUploadMode?: "finished" | "layers";
  /** How often to check on the motion director (default 15 s). */
  directionPollMs?: number;
}) {
  const store = useCreation(api);
  const { view } = store;
  const [uploadMode, setUploadMode] = useState(initialUploadMode);
  const uploads = useUploads({ api, step: store.step, creationId: () => store.latest()?.id ?? null });
  const [creations, setCreations] = useState<CreationSummary[]>([]);
  const [listBusy, setListBusy] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tray, setTray] = useState<{ unpaired: UnpairedFile[]; rejected: RejectedFile[] }>({ unpaired: [], rejected: [] });
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [opening, setOpening] = useState(false);
  const [urls, setUrls] = useState<Record<string, { url: string; at: number }>>({});
  const [pageDrop, setPageDrop] = useState(false);
  const addPicker = useRef<FilePickerHandle>(null);
  const replacePicker = useRef<HTMLInputElement>(null);
  const navigation = useRef(false);
  const inspectorBody = useRef<HTMLDivElement>(null);
  const [workflow, setWorkflow] = useState(0);
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const changeStep = (step: number) => {
    setWorkflow(step);
    if (window.matchMedia?.("(max-width: 740px)").matches) inspectorBody.current?.parentElement?.scrollIntoView({ block: "start" });
    else inspectorBody.current?.scrollTo?.({ top: 0 });
  };
  const selectSlide = (id: string) => {
    setSelectedId(id);
    if (view) { try { sessionStorage.setItem(`tiny-soho:slide:${view.id}`, id); } catch {} }
  };

  const direction = useDirection({
    api,
    creationId: view?.id ?? null,
    pollMs: directionPollMs,
    onFinished: async (id) => {
      // The director wrote layers into the saved creation; reload it so the slides show them.
      if (store.latest()?.id === id) {
        await store.flush().catch(() => undefined);
        store.open(await api.getCreation(id));
      }
      void refreshListRef.current();
    },
  });
  const slides = useMemo(() => (view ? ordered(view.document) : []), [view]);
  const selected = slides.find((slide) => slide.id === selectedId) ?? slides[0] ?? null;

  const refreshList = useCallback(async () => {
    try {
      setCreations(await api.listCreations());
    } catch {
      // The list is a convenience; the open creation keeps working without it.
    } finally {
      setListBusy(false);
    }
  }, [api]);

  const refreshListRef = useRef(refreshList);
  refreshListRef.current = refreshList;

  const openCreation = useCallback(async (id: string | null, mode: "push" | "replace" | "none" = "push") => {
    if (navigation.current) return;
    navigation.current = true;
    const previous = store.latest();
    setOpening(true);
    setNotice("");
    try {
      if (store.recoveryDraft) throw new Error("Recover or discard the unsaved draft before switching creations.");
      if (previous) await store.flush();
      const next = id ? await api.getCreation(id) : null;
      uploads.reset();
      setTray({ unpaired: [], rejected: [] });
      store.open(next);
      let remembered: string | null = null;
      try { if (next) remembered = sessionStorage.getItem(`tiny-soho:slide:${next.id}`); } catch {}
      setSelectedId(remembered);
      const slide = next?.document.slides.find(item => item.id === remembered) ?? next?.document.slides[0];
      setWorkflow(slide?.latestRunId ? 3 : 0);
      if (mode !== "none") writeParam(id, mode);
    } catch (error) {
      if (previous) {
        writeParam(previous.id, "replace");
        setNotice(`Stay here until your changes are saved. ${error instanceof Error ? error.message : "Try again."}`);
      } else {
        writeParam(null, "replace");
        setNotice("That creation couldn't be opened. Start a new one or pick another from your creations.");
      }
    } finally { setOpening(false); navigation.current = false; }
  }, [api, store, uploads]);

  const openRef = useRef(openCreation);
  openRef.current = openCreation;
  useEffect(() => {
    void refreshList();
    void openRef.current(readParam(), "none");
    const onPopState = () => void openRef.current(readParam(), "none");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // Mount only: opening reads the URL once, then follows history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (store.saveState === "saved") void refreshList();
  }, [refreshList, store.saveState]);

  useEffect(() => {
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void refreshList()},15000);
    const focus=()=>void refreshList();window.addEventListener('focus',focus);
    return()=>{clearInterval(timer);window.removeEventListener('focus',focus)};
  },[refreshList]);

  // Signed preview URLs for slides whose layers are on the server and not shown from local files.
  useEffect(() => {
    const now = Date.now();
    const needed = [...creations.map(item => item.coverAssetId).filter((id): id is string => Boolean(id)), ...slides.flatMap((slide) => (uploads.uploads[slide.id]
      ? []
      : [slide.layers.backgroundAssetId, slide.layers.textAssetId].filter((id): id is string => Boolean(id))))
      ].filter((id) => !urls[id] || now - urls[id].at > URL_LIFETIME_MS);
    if (!needed.length) return;
    let current = true;
    void Promise.all([...new Set(needed)].map(async (id) => [id, await api.assetUrl(id).catch(() => null)] as const)).then((entries) => {
      if (!current) return;
      setUrls((previous) => {
        const next = { ...previous };
        for (const [id, url] of entries) if (url) next[id] = { url, at: Date.now() };
        return next;
      });
    });
    return () => { current = false; };
  }, [api, creations, slides, uploads.uploads, urls]);

  const previews = useMemo(() => Object.fromEntries(slides.map((slide) => {
    const local = uploads.uploads[slide.id]?.local;
    // A finished slide shows as uploaded until the director replaces it with layers.
    const finished = !slide.layers.backgroundAssetId ? direction.local[slide.id] : undefined;
    const remote = (id: string | null) => (id ? urls[id]?.url ?? null : null);
    return [slide.id, local
      ? { background: local.background, text: local.text }
      : finished ? { background: finished, text: null }
        : { background: remote(slide.layers.backgroundAssetId), text: remote(slide.layers.textAssetId) }];
  })), [direction.local, slides, uploads.uploads, urls]);

  const ensureCreation = useCallback(async (name: string) => {
    const latest = store.latest();
    if (latest) return latest;
    const created = await api.createCreation(name.slice(0, 160) || "New creation");
    store.open(created);
    writeParam(created.id, "push");
    void refreshList();
    return created;
  }, [api, refreshList, store]);

  const addPairs = useCallback(async (pairs: LayerPair[]) => {
    if (!pairs.length) return;
    const room = MAX_SLIDES - (store.latest() ? ordered(store.latest()!.document).length : 0);
    const accepted = pairs.slice(0, Math.max(0, room));
    const overflow = pairs.slice(accepted.length);
    if (overflow.length) {
      setTray((current) => ({ ...current, rejected: [...current.rejected, ...overflow.flatMap((pair) => [pair.background, pair.text])
        .filter((file): file is File => Boolean(file))
        .map((file) => ({ file, reason: `A carousel holds up to ${MAX_SLIDES} slides.` }))] }));
    }
    if (!accepted.length) return;
    try {
      await ensureCreation(accepted[0].name);
      const entries = accepted.map((pair) => ({ slideId: crypto.randomUUID(), pair }));
      // Slides must be saved before their layers can be uploaded.
      await store.edit((document) => ({
        ...document,
        slides: withOrder([...ordered(document), ...entries.map(({ slideId, pair }): SlideV2 => ({
          id: slideId,
          name: pair.name.slice(0, 255) || "Slide",
          order: 0,
          width: null,
          height: null,
          layers: { backgroundAssetId: null, textAssetId: null },
        }))]),
      }), { now: true });
      setSelectedId((current) => current ?? entries[0].slideId);
      setAnnouncement(`Added ${entries.length} ${entries.length === 1 ? "slide" : "slides"}. Uploading now.`);
      await uploads.start(entries);
      setAnnouncement("Upload finished. Each slide shows its checks.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Those slides couldn't be added. Try again.");
    }
  }, [ensureCreation, store, uploads]);

  /** Finished slides: save one slide per image, upload them, and hand them to the motion director. */
  const addFinished = useCallback(async (files: File[]) => {
    setNotice("");
    const images = imageFiles(files);
    if (!images.length) {
      setNotice("Choose PNG, JPG or WebP slides.");
      return;
    }
    const room = MAX_SLIDES - (store.latest() ? ordered(store.latest()!.document).length : 0);
    const accepted = images.slice(0, Math.max(0, room));
    if (accepted.length < images.length) setNotice(`A carousel holds up to ${MAX_SLIDES} slides; the rest were left out.`);
    if (!accepted.length) return;
    try {
      const creation = await ensureCreation(slideName(accepted[0]));
      const entries = accepted.map((file) => ({ slideId: crypto.randomUUID(), file }));
      await store.edit((document) => ({
        ...document,
        slides: withOrder([...ordered(document), ...entries.map(({ slideId, file }): SlideV2 => ({
          id: slideId,
          name: slideName(file),
          order: 0,
          width: null,
          height: null,
          layers: { backgroundAssetId: null, textAssetId: null },
        }))]),
      }), { now: true });
      setSelectedId((current) => current ?? entries[0].slideId);
      setAnnouncement(`Added ${entries.length} ${entries.length === 1 ? "slide" : "slides"}. Sending them to the motion director.`);
      await direction.start(creation.id, entries);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Those slides couldn't be added. Try again.");
    }
  }, [direction, ensureCreation, store]);

  const addFiles = useCallback((files: File[]) => {
    setNotice("");
    // Files still waiting in the tray get another chance to pair with the new ones.
    const waiting = tray.unpaired.map((item) => item.file);
    const known = new Set(waiting.map(fileKey));
    const result = pairFiles([...waiting, ...files.filter((file) => !known.has(fileKey(file)))]);
    setTray((current) => ({ unpaired: result.unpaired, rejected: [...current.rejected, ...result.rejected] }));
    void addPairs(result.pairs);
  }, [addPairs, tray.unpaired]);

  const edit = useCallback((change: DocumentEdit) => void store.edit(change).catch(() => undefined), [store]);
  const editSlide = useCallback((slideId: string, change: (slide: SlideV2) => SlideV2) => edit((document) => ({
    ...document,
    slides: document.slides.map((slide) => (slide.id === slideId ? change(slide) : slide)),
  })), [edit]);

  const move = useCallback((slideId: string, to: number) => {
    edit((document) => {
      const list = ordered(document);
      const from = list.findIndex((slide) => slide.id === slideId);
      if (from < 0 || from === to) return document;
      const [moved] = list.splice(from, 1);
      list.splice(Math.max(0, Math.min(to, list.length)), 0, moved);
      return { ...document, slides: withOrder(list) };
    });
    const name = slides.find((slide) => slide.id === slideId)?.name ?? "Slide";
    setAnnouncement(`${name} moved to position ${to + 1} of ${slides.length}.`);
  }, [edit, slides]);

  const remove = useCallback((slideId: string) => {
    const index = slides.findIndex((slide) => slide.id === slideId);
    edit((document) => ({ ...document, slides: withOrder(ordered(document).filter((slide) => slide.id !== slideId)) }));
    uploads.forget(slideId);
    setSelectedId(slides[index + 1]?.id ?? slides[index - 1]?.id ?? null);
    setAnnouncement("Slide removed.");
  }, [edit, slides, uploads]);

  const replace = useCallback((files: File[]) => {
    if (!selected) return;
    const result = pairFiles(files);
    const only = result.pairs.length === 1 && !result.unpaired.length ? result.pairs[0]
      : !result.pairs.length && result.unpaired.length === 1 && result.unpaired[0].role !== "text" ? backgroundOnly(result.unpaired[0].file)
        : null;
    if (!only) {
      setNotice(`To replace "${selected.name}", choose its background and its text layer, named alike (for example ${selected.name}-background.jpg and ${selected.name}-text.png).`);
      return;
    }
    setNotice("");
    void uploads.start([{ slideId: selected.id, pair: only }]);
  }, [selected, uploads]);

  const updateHistory = async (id: string, change: DocumentEdit) => {
    if (store.latest()) await store.flush();
    if (store.latest()?.id === id) await store.edit(change, { now: true });
    else {
      const save = async (current: Awaited<ReturnType<CreationApi["getCreation"]>>) => api.saveCreation(id, current.revision, change(current.document));
      try { await save(await api.getCreation(id)); }
      catch (error) { if (!isConflict(error)) throw error; await save(await api.getCreation(id)); }
    }
    await refreshList();
  };

  const pageDropProps = {
    onDragOver: (event: DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      setPageDrop(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (event.currentTarget === event.target) setPageDrop(false);
    },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      setPageDrop(false);
      if (uploadMode === "finished") void addFinished(Array.from(event.dataTransfer.files));
      else addFiles(Array.from(event.dataTransfer.files));
    },
  };

  const pairingTray = (
    <LayerPairing
      unpaired={tray.unpaired}
      rejected={tray.rejected}
      onPair={(pair, used) => {
        setTray((current) => ({ ...current, unpaired: current.unpaired.filter((item) => !used.includes(item.file)) }));
        void addPairs([pair]);
      }}
      onDismiss={(file) => setTray((current) => ({
        unpaired: current.unpaired.filter((item) => item.file !== file),
        rejected: current.rejected.filter((item) => item.file !== file),
      }))}
    />
  );
  // Finished slides still uploading for, or waiting on, the motion director.
  const directing = new Set([
    ...Object.entries(direction.uploads).filter(([, upload]) => upload.status !== "error").map(([slideId]) => slideId),
    ...direction.runs.filter((run) => run.status === "running").flatMap((run) => run.slides.map((slide) => slide.slideId)),
  ]);
  const status = selected ? slideStatus(selected, uploads.uploads[selected.id], directing.has(selected.id)) : null;
  const checks = selected ? uploads.uploads[selected.id]?.checks ?? selected.checks : undefined;
  const saveLabel = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved" }[store.saveState];

  return (
    <div className={`${c.app} ${pageDrop ? c.pageDrop : ""}`} {...pageDropProps}>
      <header className={c.topbar}>
        {topbar ?? <>
        <a href="#creation-main" className={c.wordmark} aria-label="Tiny Soho Studio">tiny soho<span>STUDIO</span></a>
        <div className={c.topbarActions}>
          <details className={c.tools}>
            <summary className={c.textButton}>Tools</summary>
            <nav className={c.toolsMenu} aria-label="Studio tools">
              <a href="/?studio=legacy">Old studio</a>
            </nav>
          </details>
          {onSignOut && <button className={c.textButton} onClick={onSignOut}>Sign out</button>}
        </div>
        </>}
      </header>
      <CreationSidebar
        creations={creations}
        activeId={view?.id ?? null}
        busy={listBusy}
        onNew={() => void openCreation(null)}
        onOpen={(id) => void openCreation(id)}
        thumbnails={Object.fromEntries(creations.filter(item => item.coverAssetId && urls[item.coverAssetId]).map(item => [item.id, urls[item.coverAssetId!]!.url]))}
        onRename={(id, name) => updateHistory(id, document => ({ ...document, name }))}
        onArchive={(id, archived) => updateHistory(id, document => ({ ...document, archivedAt: archived ? new Date().toISOString() : null }))}
      />
      <div className={c.content}>
        <div className={c.creationBar}>
          {view && <h1 className={c.visuallyHidden}>{view.document.name}</h1>}
          {view ? (
            <label className={c.titleField}>
              <span className={c.visuallyHidden}>Creation name</span>
              <input
                key={`${view.id}:${view.document.name}`}
                defaultValue={view.document.name}
                maxLength={160}
                disabled={opening}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (!name) event.target.value = view.document.name;
                  else if (name !== view.document.name) edit((document) => ({ ...document, name }));
                }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              />
            </label>
          ) : <span className={c.titlePlaceholder}>New creation</span>}
          <span className={c.barEnd}>
            {TOOLBAR_ITEMS.map(({ id, Component }) => <Component key={id} api={api} creation={view} />)}
            <span className={`${c.saveState} ${store.saveState === "error" ? c.saveError : ""}`} role="status">
              {store.saveState === "saved" && <Icon name="check" size={13} />} {saveLabel}
              {store.saveState === "error" && (
                <button className={c.textButton} onClick={() => void store.flush().catch(() => undefined)}>Try again</button>
              )}
            </span>
          </span>
        </div>
        {store.recoveryDraft && <div className={c.notice} role="alert">A previous unsaved draft differs from the saved version. Recovering replaces the current saved settings with this draft. Discard it to keep the saved version.
          <button className={c.textButton} onClick={store.recoverDraft}>Recover draft</button>
          <button className={c.textButton} onClick={store.discardDraft}>Discard draft</button>
        </div>}
        {(notice || store.saveError) && (
          <p className={c.notice} role="alert">{notice || store.saveError}</p>
        )}
        <p className={c.visuallyHidden} aria-live="polite">{announcement}</p>
        <DirectionStatus
          uploads={direction.uploads}
          runs={direction.runs}
          error={direction.error}
          names={Object.fromEntries(slides.map((slide) => [slide.id, slide.name]))}
          onRetry={(run) => void direction.retry(run)}
          onDismiss={direction.dismiss}
        />

        <main id="creation-main" className={c.main} tabIndex={-1} aria-busy={opening}>
          {opening ? <p className={c.loading}>Opening your creation…</p>
            : !slides.length ? (
              <div className={c.emptyLayout}>
                {uploadMode === "finished"
                  ? <FinishedUpload onFiles={(files) => void addFinished(files)} onUseLayers={() => setUploadMode("layers")} />
                  : <CreationUpload variant="hero" onFiles={addFiles} />}
                {uploadMode === "layers" && pairingTray}
              </div>
            ) : (
              <div className={c.workspace}>
                <SlideRail
                  slides={slides}
                  selectedId={selected?.id ?? null}
                  uploads={uploads.uploads}
                  directing={directing}
                  previews={previews}
                  onSelect={selectSlide}
                  onMove={move}
                  onRetry={(slideId) => void uploads.retry(slideId)}
                  addControl={<CreationUpload ref={addPicker} variant="compact"
                    onFiles={uploadMode === "finished" ? (files) => void addFinished(files) : addFiles}
                    disabled={slides.length >= MAX_SLIDES} />}
                />
                <section className={c.stage} aria-label="Selected slide">
                  {pairingTray}
                  {selected && <SlideStage slide={selected} preview={previews[selected.id]} />}
                </section>
                {selected && view && (
                  <aside className={c.inspector} aria-label={`Slide ${slides.indexOf(selected) + 1}: ${selected.name}`}>
                    <nav className={c.workflow} role="tablist" aria-label="Video creation steps">
                      {WORKFLOW.map((label, index) => <button key={label} id={`step-${index}`} role="tab" aria-selected={workflow === index}
                        aria-controls={`step-panel-${index}`} tabIndex={workflow === index ? 0 : -1}
                        onClick={() => changeStep(index)} onKeyDown={event => {
                          const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : null;
                          if (next !== null) { event.preventDefault(); changeStep(next); document.getElementById(`step-${next}`)?.focus(); }
                        }}>{index + 1}. {label}</button>)}
                    </nav>
                    <div className={c.inspectorBody} ref={inspectorBody}>
                      <p className={c.hint}>Choose motion, preview your text, then generate and pick a take.</p>
                      <p className={c.eyebrow}>SLIDE {String(slides.indexOf(selected) + 1).padStart(2, "0")} OF {slides.length}</p>
                      <label className={c.slideName}>
                        <span className={c.visuallyHidden}>Slide name</span>
                        <input
                          key={selected.id}
                          defaultValue={selected.name}
                          maxLength={255}
                          onBlur={(event) => {
                            const name = event.target.value.trim();
                            if (!name) event.target.value = selected.name;
                            else if (name !== selected.name) editSlide(selected.id, (slide) => ({ ...slide, name }));
                          }}
                          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                        />
                      </label>
                      <details className={c.layerDetails}><summary>{status === "ready" ? "Layers ready" : status && statusText(status, uploads.uploads[selected.id])} · Layer details</summary><dl className={c.facts}>
                        <div><dt>Status</dt><dd>{status && statusText(status, uploads.uploads[selected.id])}</dd></div>
                        {selected.width && selected.height && (
                          <div><dt>Shape</dt><dd>{ratioLabel(selected.width, selected.height)} · {selected.width} × {selected.height} px</dd></div>
                        )}
                        {checks?.generationSize && (
                          <div><dt>Render size</dt><dd>{checks.generationSize.width} × {checks.generationSize.height} px</dd></div>
                        )}
                        <div><dt>Text layer</dt><dd>{selected.layers.textAssetId || uploads.uploads[selected.id]?.pair.text ? "Yes" : "None"}</dd></div>
                      </dl></details>
                      <UploadChecks checks={checks} />
                      {status === "directing" && (
                        <p className={c.hint}>The motion director is lifting this slide&rsquo;s words off the picture and setting them back with motion. It usually takes 2–4 minutes a slide.</p>
                      )}
                      {status === "missing" && (
                        <p className={c.hint}>This slide's upload didn't finish. Choose its two files again with Replace files.</p>
                      )}
                      {SLIDE_PANELS.filter(({id}) => id === ["motion", "text-animation", "model", "takes"][workflow] || !["motion", "text-animation", "model", "takes"].includes(id)).map(({ id, title, Component }) => (
                        <div key={id} id={`step-panel-${workflow}`} role="tabpanel" aria-labelledby={`step-${workflow}`}><section className={c.panel} aria-label={title}>
                          <Component actionHost={actionHost} onGenerated={() => changeStep(3)} beforeGenerate={async () => { if (store.recoveryDraft) throw new Error("Recover or discard the unsaved draft before generating."); await store.flush(); }} onViewResults={() => changeStep(3)} creation={view} slide={selected} ready={status === "ready"} api={api} edit={edit}
                            saveServerStep={async(change)=>{
                              const saved=store.flush();
                              await store.step(async(latest)=>{
                                await saved;
                                let creation;
                                try { creation=await change(latest); }
                                catch(error) { if(!isConflict(error))throw error;creation=await change(await api.getCreation(latest.id)); }
                                return {creation,value:null};
                              });
                            }}
                            editSlide={(change) => editSlide(selected.id, change)} />
                        </section></div>
                      ))}
                    </div>
                    <div className={c.inspectorFoot}>
                      <div className={c.primaryActions} ref={setActionHost} />
                      {workflow < 2 && <button className={c.primary} disabled={status !== "ready" || (workflow === 0 && !selected.motion)} onClick={() => changeStep(workflow + 1)}>Next: {WORKFLOW[workflow + 1]}</button>}
                      {workflow > 0 && <button className={c.quiet} onClick={() => changeStep(workflow - 1)}>Back: {WORKFLOW[workflow - 1]}</button>}
                      <details className={c.fileActions}><summary>Slide files</summary><div>
                      <input ref={replacePicker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
                        aria-hidden="true" tabIndex={-1}
                        onChange={(event) => {
                          const files = Array.from(event.target.files ?? []);
                          event.target.value = "";
                          if (files.length) replace(files);
                        }} />
                      <button className={c.secondary} onClick={() => replacePicker.current?.click()}
                        disabled={status === "uploading" || status === "checking"}>
                        <Icon name="upload" size={15} /> Replace files
                      </button>
                      <RemoveButton name={selected.name} onRemove={() => remove(selected.id)} />
                      </div></details>
                    </div>
                  </aside>
                )}
              </div>
            )}
        </main>
      </div>
    </div>
  );
}

function SlideStage({ slide, preview }: { slide: SlideV2; preview?: { background: string | null; text: string | null } }) {
  const ratio = slide.width && slide.height ? slide.width / slide.height : 4 / 5;
  return (
    <div className={c.canvas}>
      <figure className={c.artwork} style={{ "--ratio": ratio } as CSSProperties}>
        {preview?.background ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.background} alt={`${slide.name}, background layer`} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview.text && <img className={c.textLayer} src={preview.text} alt={`${slide.name}, text layer`} />}
          </>
        ) : <span className={c.artworkEmpty}>Preview appears when the files are uploaded.</span>}
      </figure>
    </div>
  );
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [name]);
  if (!confirming) {
    return <button className={c.quiet} onClick={() => setConfirming(true)}><Icon name="trash" size={15} /> Remove slide</button>;
  }
  return (
    <span className={c.confirm} role="group" aria-label={`Remove ${name}?`}>
      <span>Remove “{name}”?</span>
      <button className={c.danger} onClick={onRemove}>Remove</button>
      <button className={c.quiet} onClick={() => setConfirming(false)}>Keep</button>
    </span>
  );
}
