"use client";

import { lazy, Suspense, useEffect, useState } from "react";

import { HostedStudio } from "@/components/HostedStudio";

// Loaded only for the development preview, so sample data never ships with the production page.
const CreationPreview = lazy(() => import("./CreationPreview"));

type Mode = "studio" | "creation" | "preview";

/**
 * Chooses the creation page or the existing Carousel Studio. `?studio=creation` opens the new page behind the
 * normal sign-in. The server release flag makes creation the default; `?studio=legacy` returns to the old Studio. In development only,
 * `?studio=creation&mock=1` opens it on sample data with no sign-in and no network.
 * The Studio shell (Reels, Carousels, Library, Creations) wraps the creation page when its server flag is on, or
 * with `?shell=1`; `?shell=0` turns it off for one visit. It needs the creation page, so legacy mode skips it.
 */
export function StudioEntry({ creationsV2Enabled = false, studioShellEnabled = false }: { creationsV2Enabled?: boolean; studioShellEnabled?: boolean }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [shell, setShell] = useState(false);
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const shellParam = params.get("shell");
    setShell(shellParam === "1" || (shellParam !== "0" && studioShellEnabled));
    if (params.get("studio") !== "creation") {
      setMode(params.get("studio") === "legacy" ? "studio" : creationsV2Enabled ? "creation" : "studio");
      return;
    }
    setMode(process.env.NODE_ENV === "development" && params.get("mock") === "1" ? "preview" : "creation");
  }, [creationsV2Enabled, studioShellEnabled]);
  if (mode === null) return <main><h1>Tiny Soho Motion Studio</h1><p>Sign in to create typography-safe motion.</p><p role="status">Opening Studio…</p></main>;
  if (mode === "preview") return <Suspense fallback={null}><CreationPreview shell={shell} /></Suspense>;
  return <HostedStudio creation={mode === "creation"} shell={shell && mode === "creation"} />;
}
