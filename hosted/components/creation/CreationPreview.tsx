"use client";

import { useMemo, useState } from "react";

import { createMockCreationApi } from "./mock-api";
import "./motion/mock-routes";
import "./model/mock-routes";
import "./direction/mock-routes";
import { getMockRunningSlides, mockTakes } from "./takes/mock-routes";
import { contractFixtures } from "@/lib/contract/fixtures";
import type { RunView } from "@/lib/contract";
import { CreationShell } from "./CreationShell";

/** Development-only preview on T0's sample data. Files stay in this browser tab; nothing is uploaded. */
export default function CreationPreview() {
  const api = useMemo(() => createMockCreationApi({ seed: true, uploadDelayMs: 350, running:getMockRunningSlides }), []);
  const [version, setVersion] = useState(0);
  const [sample, setSample] = useState("completed");
  return (
    <>
      <details style={{ position: "fixed", left: "50%", top: 8, transform: "translateX(-50%)", zIndex: 60, maxWidth: 270, padding: "6px 10px", font: "11px/1.4 system-ui, sans-serif", color: "#6d3a26", background: "#f4f1e7", border: "1px solid #e7dccb", borderRadius: 4 }}>
        <summary>Local preview · Sample data</summary>
        <p>Files stay in this tab. Nothing is uploaded.</p>
        <label>Sample run state <select value={sample} onChange={event => {
          const status = event.target.value as RunView["status"];
          const run = structuredClone(status === "completed" ? contractFixtures.runCompleted.run : contractFixtures.runGenerating.run);
          run.id = contractFixtures.runCompleted.run.id;
          run.slideId = contractFixtures.creation.document.slides[0].id;
          run.status = status;
          if (status === "failed") { run.takes[0].stage = "failed"; run.reasons = ["The video service could not finish this take. Try another take."]; }
          if (status === "queued") { run.takes = []; run.attemptCount = 0; }
          mockTakes.runs.set(run.id, run);
          setSample(status); setVersion(value => value + 1);
        }}><option value="completed">Completed</option><option value="queued">Waiting</option><option value="generating">Animating</option><option value="failed">Failed</option></select></label>
      </details>
      <CreationShell key={version} api={api} initialUploadMode="finished" />
    </>
  );
}
