"use client";

import { useMemo } from "react";

import { createMockCreationApi } from "./mock-api";
import { CreationShell } from "./CreationShell";

/** Development-only preview on T0's sample data. Files stay in this browser tab; nothing is uploaded. */
export default function CreationPreview() {
  const api = useMemo(() => createMockCreationApi({ seed: true, uploadDelayMs: 350 }), []);
  return (
    <>
      <p role="note" style={{ position: "fixed", right: 12, top: 12, zIndex: 60, maxWidth: 260, margin: 0, padding: "8px 12px", font: "600 11px/1.4 system-ui, sans-serif", color: "#6d3a26", background: "#f4f1e7", border: "1px solid #e7dccb", borderRadius: 4 }}>
        Local preview with sample data. Files stay in this tab and nothing is uploaded.
      </p>
      <CreationShell api={api} />
    </>
  );
}
