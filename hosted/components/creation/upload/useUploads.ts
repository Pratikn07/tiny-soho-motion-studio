"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CreationView, LayerUploadRequest, UploadCheckResult } from "@/lib/contract";
import { CreationApiError, type CreationApi } from "../api";
import type { LayerPair, LayerRole } from "./pairing";

export type FileUpload = { name: string; progress: number; status: "waiting" | "uploading" | "done" | "error" };
export type SlideUpload = {
  slideId: string;
  phase: "uploading" | "checking" | "done" | "error";
  files: { background: FileUpload; text: FileUpload | null };
  /** Object URLs of the local files, so the card shows the slide before the server has it. */
  local: { background: string; text: string | null };
  pair: LayerPair;
  error?: string;
  checks?: UploadCheckResult;
};

const CONCURRENT_SLIDES = 3;

type Step = <T>(task: (latest: CreationView) => Promise<{ creation: CreationView; value: T }>) => Promise<T>;

const message = (error: unknown) => error instanceof CreationApiError || error instanceof Error
  ? error.message
  : "Something went wrong. Try again.";

/** Upload state for each slide, keyed by slide id. Files go straight to storage through signed URLs. */
export function useUploads(options: {
  api: CreationApi;
  step: Step;
  creationId: () => string | null;
  objectUrl?: (file: File) => string;
  revokeUrl?: (url: string) => void;
}) {
  const { api, step, creationId } = options;
  // Stable across renders: effects and callbacks below must not re-run (and revoke URLs) on every render.
  const urlTools = useRef({
    objectUrl: options.objectUrl ?? ((file: File) => URL.createObjectURL(file)),
    revokeUrl: options.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url)),
  });
  const { objectUrl, revokeUrl } = urlTools.current;
  const [uploads, setUploads] = useState<Record<string, SlideUpload>>({});
  const uploadsRef = useRef(uploads);
  const active = useRef(0);
  const waiting = useRef<Array<() => void>>([]);

  const patch = useCallback((slideId: string, change: (upload: SlideUpload) => SlideUpload) => {
    const upload = uploadsRef.current[slideId];
    if (!upload) return;
    uploadsRef.current = { ...uploadsRef.current, [slideId]: change(upload) };
    setUploads(uploadsRef.current);
  }, []);

  const slot = useCallback(async <T,>(work: () => Promise<T>) => {
    if (active.current >= CONCURRENT_SLIDES) await new Promise<void>((resolve) => waiting.current.push(resolve));
    active.current += 1;
    try {
      return await work();
    } finally {
      active.current -= 1;
      waiting.current.shift()?.();
    }
  }, []);

  const run = useCallback(async (slideId: string) => {
    const pair = uploadsRef.current[slideId]?.pair;
    const id = creationId();
    if (!pair || !id) return;
    const fileUpdate = (role: LayerRole, change: Partial<FileUpload>) => patch(slideId, (upload) => ({
      ...upload,
      files: role === "background"
        ? { ...upload.files, background: { ...upload.files.background, ...change } }
        : { ...upload.files, text: upload.files.text && { ...upload.files.text, ...change } },
    }));
    patch(slideId, (upload) => ({
      ...upload,
      phase: "uploading",
      error: undefined,
      files: {
        background: { ...upload.files.background, progress: 0, status: "waiting" },
        text: upload.files.text && { ...upload.files.text, progress: 0, status: "waiting" },
      },
    }));
    await slot(async () => {
      try {
        // New asset ids on every attempt: a half-finished earlier attempt can never block this one.
        const ids = { background: crypto.randomUUID(), text: pair.text ? crypto.randomUUID() : null };
        // Pairing only lets PNG, JPEG and WebP through, and only a PNG as the text layer.
        const { uploads: signed } = await api.requestLayerUploads(id, slideId, {
          background: { assetId: ids.background, fileName: pair.background.name, size: pair.background.size,
            mime: pair.background.type as LayerUploadRequest["background"]["mime"] },
          ...(pair.text && ids.text
            ? { text: { assetId: ids.text, fileName: pair.text.name, size: pair.text.size, mime: "image/png" as const } }
            : {}),
        });
        const send = async (role: LayerRole, file: File, url: string) => {
          fileUpdate(role, { status: "uploading" });
          try {
            await api.uploadFile(url, file, (progress) => fileUpdate(role, { progress }));
            fileUpdate(role, { progress: 1, status: "done" });
          } catch (error) {
            fileUpdate(role, { status: "error" });
            throw error;
          }
        };
        await Promise.all([
          send("background", pair.background, signed.background.signedUrl),
          ...(pair.text && signed.text ? [send("text", pair.text, signed.text.signedUrl)] : []),
        ]);
        patch(slideId, (upload) => ({ ...upload, phase: "checking" }));
        const checks = await step(async (latest) => {
          const result = await api.finaliseLayers(latest.id, slideId, {
            revision: latest.revision,
            background: { assetId: ids.background },
            text: ids.text ? { assetId: ids.text } : null,
          });
          return { creation: result.creation, value: result.checks };
        });
        patch(slideId, (upload) => ({ ...upload, phase: "done", checks }));
      } catch (error) {
        if (error instanceof CreationApiError && error.code === "slide_not_found") {
          const { [slideId]: _removed, ...rest } = uploadsRef.current;
          uploadsRef.current = rest;
          setUploads(rest);
          return;
        }
        patch(slideId, (upload) => ({ ...upload, phase: "error", error: message(error) }));
      }
    });
  }, [api, creationId, patch, slot, step]);

  /** Starts uploading pairs for slides that are already saved in the document. */
  const start = useCallback((entries: Array<{ slideId: string; pair: LayerPair }>) => {
    // Update the ref before running: `run` reads the pair from it, and React applies state later.
    const next = { ...uploadsRef.current };
    for (const { slideId, pair } of entries) {
      const previous = next[slideId];
      if (previous) {
        revokeUrl(previous.local.background);
        if (previous.local.text) revokeUrl(previous.local.text);
      }
      next[slideId] = {
        slideId,
        pair,
        phase: "uploading",
        files: {
          background: { name: pair.background.name, progress: 0, status: "waiting" },
          text: pair.text ? { name: pair.text.name, progress: 0, status: "waiting" } : null,
        },
        local: { background: objectUrl(pair.background), text: pair.text ? objectUrl(pair.text) : null },
      };
    }
    uploadsRef.current = next;
    setUploads(next);
    return Promise.all(entries.map(({ slideId }) => run(slideId)));
  }, [objectUrl, revokeUrl, run]);

  const retry = useCallback((slideId: string) => run(slideId), [run]);

  const forget = useCallback((slideId: string) => {
    const upload = uploadsRef.current[slideId];
    if (!upload) return;
    revokeUrl(upload.local.background);
    if (upload.local.text) revokeUrl(upload.local.text);
    const { [slideId]: _removed, ...rest } = uploadsRef.current;
    uploadsRef.current = rest;
    setUploads(rest);
  }, [revokeUrl]);

  const reset = useCallback(() => {
    for (const upload of Object.values(uploadsRef.current)) {
      revokeUrl(upload.local.background);
      if (upload.local.text) revokeUrl(upload.local.text);
    }
    uploadsRef.current = {};
    setUploads({});
  }, [revokeUrl]);

  useEffect(() => () => {
    for (const upload of Object.values(uploadsRef.current)) {
      urlTools.current.revokeUrl(upload.local.background);
      if (upload.local.text) urlTools.current.revokeUrl(upload.local.text);
    }
  }, []);

  return { uploads, start, retry, forget, reset };
}
