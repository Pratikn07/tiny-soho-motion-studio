"use client";

import { useState } from "react";

import { DirectorStudio } from "@/components/DirectorStudio";
import { MotionStudio } from "@/components/MotionStudio";
import { VisionStudio } from "@/components/VisionStudio";
import { WorkflowStudio } from "@/components/WorkflowStudio";
import type { createStudioApi } from "@/lib/api";

type StudioApi = ReturnType<typeof createStudioApi>;
type View = "motion" | "director" | "workflows" | "vision";

export function StudioShell({ api }: { api: StudioApi }) {
  const [view, setView] = useState<View>("motion");
  return <main className="studio-shell"><header><p className="eyebrow">Tiny Soho</p><h1>Creative Studio</h1><p>Owner-only creative production. Motion, Director, Workflows, and Vision remain isolated from Instagram automation.</p><nav className="studio-nav" aria-label="Creative Studio views"><button type="button" className={view === "motion" ? "active" : ""} onClick={() => setView("motion")}>Motion</button><button type="button" className={view === "director" ? "active" : ""} onClick={() => setView("director")}>Creative Director</button><button type="button" className={view === "workflows" ? "active" : ""} onClick={() => setView("workflows")}>Workflows</button><button type="button" className={view === "vision" ? "active" : ""} onClick={() => setView("vision")}>Vision Lab</button></nav></header>{view === "motion" ? <MotionStudio api={api} /> : null}{view === "director" ? <DirectorStudio api={api} /> : null}{view === "workflows" ? <WorkflowStudio api={api} /> : null}{view === "vision" ? <VisionStudio api={api} /> : null}</main>;
}
