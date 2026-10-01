"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";

import { MAX_SLIDES, type CreationSummary, type SlideV2 } from "@/lib/contract";
import { CreationSidebar } from "@/components/carousel/CreationSidebar";
import Icon from "@/components/carousel/Icons";
import type { CreationApi } from "./api";
import { SLIDE_PANELS, TOOLBAR_ITEMS } from "./panels";
import { ordered, useCreation, withOrder, type DocumentEdit } from "./useCreation";
import { CreationUpload, type FilePickerHandle } from "./upload/CreationUpload";
import { LayerPairing } from "./upload/LayerPairing";
import { backgroundOnly, pairFiles, ratioLabel, type LayerPair, type RejectedFile, type UnpairedFile } from "./upload/pairing";
import { slideStatus, statusText } from "./upload/SlideCard";
import { SlideRail } from "./upload/SlideRail";
import { UploadChecks } from "./upload/UploadChecks";
import { useUploads } from "./upload/useUploads";
import c from "./creation.module.css";

const PARAM = "creation";
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

/** The creation page: history, the slide rail, the selected slide, and an inspector whose panels later tasks fill. */
export function CreationShell({ api, onSignOut }: { api: CreationApi; onSignOut?: () => void }) {
  const store = useCreation(api);
  const { view } = store;
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

  const openCreation = useCallback(async (id: string | null, mode: "push" | "replace" | "none" = "push") => {
    uploads.reset();
    setTray({ unpaired: [], rejected: [] });
    setNotice("");
    setSelectedId(null);
    if (mode !== "none") writeParam(id, mode);
    if (!id) {
      store.open(null);
      return;
    }
    setOpening(true);
    try {
      store.open(await api.getCreation(id));
    } catch {
      store.open(null);
      writeParam(null, "replace");
      setNotice("That creation couldn't be opened. Start a new one or pick another from your creations.");
    } finally {
      setOpening(false);
    }
  }, [api, store, uploads]);

  useEffect(() => {
    void refreshList();
    void openCreation(readParam(), "none");
    const onPopState = () => void openCreation(readParam(), "none");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // Mount only: opening reads the URL once, then follows history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (store.saveState === "saved") void refreshList();
  }, [refreshList, store.saveState]);

  // Signed preview URLs for slides whose layers are on the server and not shown from local files.
  useEffect(() => {
    const now = Date.now();
    const needed = slides.flatMap((slide) => (uploads.uploads[slide.id]
      ? []
      : [slide.layers.backgroundAssetId, slide.layers.textAssetId].filter((id): id is string => Boolean(id))))
      .filter((id) => !urls[id] || now - urls[id].at > URL_LIFETIME_MS);
    if (!needed.length) return;
    let current = true;
    void Promise.all(needed.map(async (id) => [id, await api.assetUrl(id).catch(() => null)] as const)).then((entries) => {
      if (!current) return;
      setUrls((previous) => {
        const next = { ...previous };
        for (const [id, url] of entries) if (url) next[id] = { url, at: Date.now() };
        return next;
      });
    });
    return () => { current = false; };
  }, [api, slides, uploads.uploads, urls]);

  const previews = useMemo(() => Object.fromEntries(slides.map((slide) => {
    const local = uploads.uploads[slide.id]?.local;
    const remote = (id: string | null) => (id ? urls[id]?.url ?? null : null);
    return [slide.id, local
      ? { background: local.background, text: local.text }
      : { background: remote(slide.layers.backgroundAssetId), text: remote(slide.layers.textAssetId) }];
  })), [slides, uploads.uploads, urls]);

  const ensureCreation = useCallback(async () => {
    const latest = store.latest();
    if (latest) return latest;
    const created = await api.createCreation("New creation");
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
      await ensureCreation();
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
      addFiles(Array.from(event.dataTransfer.files));
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
  const status = selected ? slideStatus(selected, uploads.uploads[selected.id]) : null;
  const checks = selected ? uploads.uploads[selected.id]?.checks ?? selected.checks : undefined;
  const saveLabel = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved" }[store.saveState];

  return (
    <div className={`${c.app} ${pageDrop ? c.pageDrop : ""}`} {...pageDropProps}>
      <header className={c.topbar}>
        <a href="#creation-main" className={c.wordmark} aria-label="Tiny Soho Studio">tiny soho<span>STUDIO</span></a>
        {onSignOut && <button className={c.textButton} onClick={onSignOut}>Sign out</button>}
      </header>
      <CreationSidebar
        creations={creations}
        activeId={view?.id ?? null}
        busy={listBusy}
        onNew={() => void openCreation(null)}
        onOpen={(id) => void openCreation(id)}
      />
      <div className={c.content}>
        <div className={c.creationBar}>
          {view ? (
            <label className={c.titleField}>
              <span className={c.visuallyHidden}>Creation name</span>
              <input
                key={view.id}
                defaultValue={view.document.name}
                maxLength={160}
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
        {(notice || store.saveError) && (
          <p className={c.notice} role="alert">{notice || store.saveError}</p>
        )}
        <p className={c.visuallyHidden} aria-live="polite">{announcement}</p>

        <main id="creation-main" className={c.main} aria-busy={opening}>
          {opening ? <p className={c.loading}>Opening your creation…</p>
            : !slides.length ? (
              <div className={c.emptyLayout}>
                <CreationUpload variant="hero" onFiles={addFiles} />
                {pairingTray}
              </div>
            ) : (
              <div className={c.workspace}>
                <SlideRail
                  slides={slides}
                  selectedId={selected?.id ?? null}
                  uploads={uploads.uploads}
                  previews={previews}
                  onSelect={setSelectedId}
                  onMove={move}
                  onRetry={(slideId) => void uploads.retry(slideId)}
                  addControl={<CreationUpload ref={addPicker} variant="compact" onFiles={addFiles} disabled={slides.length >= MAX_SLIDES} />}
                />
                <section className={c.stage} aria-label="Selected slide">
                  {pairingTray}
                  {selected && <SlideStage slide={selected} preview={previews[selected.id]} />}
                </section>
                {selected && view && (
                  <aside className={c.inspector} aria-label={`Slide ${slides.indexOf(selected) + 1}: ${selected.name}`}>
                    <div className={c.inspectorBody}>
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
                      <dl className={c.facts}>
                        <div><dt>Status</dt><dd>{status && statusText(status, uploads.uploads[selected.id])}</dd></div>
                        {selected.width && selected.height && (
                          <div><dt>Shape</dt><dd>{ratioLabel(selected.width, selected.height)} · {selected.width} × {selected.height} px</dd></div>
                        )}
                        {checks?.generationSize && (
                          <div><dt>Moves at</dt><dd>{checks.generationSize.width} × {checks.generationSize.height} px</dd></div>
                        )}
                        <div><dt>Text layer</dt><dd>{selected.layers.textAssetId || uploads.uploads[selected.id]?.pair.text ? "Yes" : "None"}</dd></div>
                      </dl>
                      <UploadChecks checks={checks} />
                      {status === "missing" && (
                        <p className={c.hint}>This slide's upload didn't finish. Choose its two files again with Replace files.</p>
                      )}
                      {SLIDE_PANELS.map(({ id, title, Component }) => (
                        <section key={id} className={c.panel} aria-label={title}>
                          <Component creation={view} slide={selected} ready={status === "ready"} api={api} edit={edit}
                            editSlide={(change) => editSlide(selected.id, change)} />
                        </section>
                      ))}
                    </div>
                    <div className={c.inspectorFoot}>
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
