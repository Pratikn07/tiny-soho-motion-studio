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
 */
export function StudioEntry({ creationsV2Enabled = false }: { creationsV2Enabled?: boolean }) {
  const [mode, setMode] = useState<Mode>(creationsV2Enabled ? "creation" : "studio");
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    if (params.get("studio") !== "creation") {
      setMode(params.get("studio") === "legacy" ? "studio" : creationsV2Enabled ? "creation" : "studio");
      return;
    }
    setMode(process.env.NODE_ENV === "development" && params.get("mock") === "1" ? "preview" : "creation");
  }, [creationsV2Enabled]);
  if (mode === "preview") return <Suspense fallback={null}><CreationPreview /></Suspense>;
  return <HostedStudio creation={mode === "creation"} />;
}
