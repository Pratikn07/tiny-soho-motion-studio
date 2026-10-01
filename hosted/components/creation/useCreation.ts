"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CreationDocumentV2, CreationView, SlideV2 } from "@/lib/contract";
import { isConflict, type CreationApi } from "./api";

export type SaveState = "idle" | "saving" | "saved" | "error";
export type DocumentEdit = (document: CreationDocumentV2) => CreationDocumentV2;

const SAVE_DELAY_MS = 500;

/** Renumbers `order` from 0 so the saved document always has unique, gap-free positions. */
export const withOrder = (slides: SlideV2[]): SlideV2[] => slides.map((slide, order) => ({ ...slide, order }));
export const ordered = (document: CreationDocumentV2) => [...document.slides].sort((a, b) => a.order - b.order);

/**
 * The open creation. Every write (autosave, adding slides, finalising layers) runs one at a time through a queue
 * and uses the newest revision, so finalising ten slides and renaming one never conflict with each other.
 * Edits show at once: the screen shows the last saved document with any unsaved edits applied on top.
 */
export function useCreation(api: CreationApi) {
  const [server, setServer] = useState<CreationView | null>(null);
  const [edits, setEdits] = useState<DocumentEdit[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const serverRef = useRef<CreationView | null>(null);
  const editsRef = useRef<DocumentEdit[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0); // Bumped when another creation opens, so late replies are dropped.

  const accept = useCallback((view: CreationView) => {
    serverRef.current = view;
    setServer(view);
  }, []);

  const enqueue = useCallback(<T,>(task: (latest: CreationView) => Promise<T>): Promise<T> => {
    const owner = generation.current;
    const run = queue.current.then(async () => {
      if (owner !== generation.current || !serverRef.current) throw new Error("This creation is no longer open.");
      return task(serverRef.current);
    });
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  /** Saves every unsaved edit. On a revision conflict it reloads once and applies the edits again. */
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return enqueue(async (latest) => {
      const pending = editsRef.current;
      if (!pending.length) return latest;
      setSaveState("saving");
      const save = (base: CreationView) => api.saveCreation(base.id, base.revision, pending.reduce((doc, edit) => edit(doc), base.document));
      try {
        let saved: CreationView;
        try {
          saved = await save(latest);
        } catch (error) {
          if (!isConflict(error)) throw error;
          saved = await save(await api.getCreation(latest.id));
        }
        editsRef.current = editsRef.current.slice(pending.length);
        setEdits(editsRef.current);
        accept(saved);
        setSaveState(editsRef.current.length ? "saving" : "saved");
        setSaveError("");
        return saved;
      } catch (error) {
        setSaveState("error");
        setSaveError(error instanceof Error ? error.message : "Your changes couldn't be saved.");
        throw error;
      }
    });
  }, [accept, api, enqueue]);

  const edit = useCallback((change: DocumentEdit, options: { now?: boolean } = {}) => {
    editsRef.current = [...editsRef.current, change];
    setEdits(editsRef.current);
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    if (options.now) return flush();
    timer.current = setTimeout(() => void flush().catch(() => undefined), SAVE_DELAY_MS);
    return Promise.resolve(serverRef.current);
  }, [flush]);

  /** Runs a server step (for example finalising a slide) after earlier writes, with the newest revision. */
  const step = useCallback(<T,>(task: (latest: CreationView) => Promise<{ creation: CreationView; value: T }>) => (
    enqueue(async (latest) => {
      const { creation, value } = await task(latest);
      accept(creation);
      return value;
    })
  ), [accept, enqueue]);

  const open = useCallback((view: CreationView | null) => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    editsRef.current = [];
    setEdits([]);
    queue.current = Promise.resolve();
    serverRef.current = view;
    setServer(view);
    setSaveState("idle");
    setSaveError("");
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const view = useMemo<CreationView | null>(() => server && {
    ...server,
    document: edits.reduce((doc, change) => change(doc), server.document),
  }, [edits, server]);

  return { view, saveState, saveError, edit, flush, step, open, latest: () => serverRef.current };
}
