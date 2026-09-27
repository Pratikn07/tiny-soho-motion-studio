"use client";

import { useEffect, useMemo, useState } from "react";

import type { StudioVisionCapabilityView, StudioVisionJobView } from "@/lib/api";
import type { StudioAssetView, StudioProjectView } from "@/components/MotionStudio";

const operations = ["inspect", "overlay", "plate", "compose", "ocr", "segment", "layers"] as const;
type Operation = (typeof operations)[number];
type VisionApi = {
  listProjects: () => Promise<StudioProjectView[]>;
  listAssets: (projectId: string) => Promise<StudioAssetView[]>;
  listVisionCapabilities: () => Promise<StudioVisionCapabilityView[]>;
  createVisionJob: (input: { projectId: string; sourceAssetId: string; operation: Operation; options: Record<string, unknown>; inputAssetIds: string[]; idempotencyKey: string }) => Promise<StudioVisionJobView>;
  getVisionJob: (jobId: string) => Promise<StudioVisionJobView>;
};

export function VisionStudio({ api }: { api: VisionApi }) {
  const [projects, setProjects] = useState<StudioProjectView[]>([]);
  const [projectId, setProjectId] = useState("");
  const [assets, setAssets] = useState<StudioAssetView[]>([]);
  const [capabilities, setCapabilities] = useState<StudioVisionCapabilityView[]>([]);
  const [operation, setOperation] = useState<Operation>("overlay");
  const [sourceAssetId, setSourceAssetId] = useState("");
  const [overlayAssetId, setOverlayAssetId] = useState("");
  const [regions, setRegions] = useState("[]");
  const [job, setJob] = useState<StudioVisionJobView | null>(null);
  const [message, setMessage] = useState("");
  const sourceAssets = useMemo(() => assets.filter((asset) => operation === "compose" ? ["source-video", "generated-video", "derived-video"].includes(asset.kind) : ["source-image", "derived-image"].includes(asset.kind)), [assets, operation]);
  const imageAssets = useMemo(() => assets.filter((asset) => ["source-image", "derived-image"].includes(asset.kind)), [assets]);
  const unavailable = capabilities.find((capability) => capability.capabilityId === operation)?.status === "unavailable";

  useEffect(() => { void api.listProjects().then((items) => { setProjects(items); setProjectId((current) => current || items[0]?.id || ""); }).catch(() => setMessage("Projects could not be loaded.")); }, [api]);
  useEffect(() => { if (projectId) void Promise.all([api.listAssets(projectId), api.listVisionCapabilities()]).then(([nextAssets, nextCapabilities]) => { setAssets(nextAssets); setCapabilities(nextCapabilities); }).catch(() => setMessage("Vision resources could not be loaded.")); }, [api, projectId]);
  useEffect(() => { if (!job || ["completed", "failed", "needs_attention", "canceled"].includes(job.status)) return; const timer = window.setInterval(() => { void api.getVisionJob(job.id).then(setJob).catch(() => setMessage("Vision status could not be refreshed.")); }, 10_000); return () => window.clearInterval(timer); }, [api, job]);

  const queue = async () => {
    if (!projectId || !sourceAssetId || unavailable) return;
    let options: Record<string, unknown> = {};
    try { options = operation === "overlay" ? { regions: JSON.parse(regions) } : {}; } catch { setMessage("Overlay regions must be valid JSON."); return; }
    try {
      const next = await api.createVisionJob({ projectId, sourceAssetId, operation, options, inputAssetIds: operation === "compose" && overlayAssetId ? [overlayAssetId] : [], idempotencyKey: crypto.randomUUID() });
      setJob(next); setMessage("Vision job queued in the isolated CPU-safe service.");
    } catch { setMessage("Vision job could not be queued for these project assets."); }
  };

  return <section className="suite-view" aria-label="Vision Lab"><div><p className="eyebrow">Prepare safely</p><h2>Vision Lab</h2><p>CPU-safe inspect, typography overlay, plate, and composition jobs run outside Vercel. OCR, segmentation, and layers stay unavailable until explicitly configured.</p></div><div className="panel"><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Operation<select value={operation} onChange={(event) => { setOperation(event.target.value as Operation); setSourceAssetId(""); }}>{operations.map((item) => <option key={item} value={item} disabled={capabilities.find((capability) => capability.capabilityId === item)?.status === "unavailable"}>{item}{capabilities.find((capability) => capability.capabilityId === item)?.status === "unavailable" ? " — unavailable" : ""}</option>)}</select></label><label>Source asset<select value={sourceAssetId} onChange={(event) => setSourceAssetId(event.target.value)}><option value="">Select source asset</option>{sourceAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>{operation === "overlay" ? <label>OCR regions JSON<textarea value={regions} onChange={(event) => setRegions(event.target.value)} /></label> : null}{operation === "compose" ? <label>Typography overlay<select value={overlayAssetId} onChange={(event) => setOverlayAssetId(event.target.value)}><option value="">Select overlay image</option>{imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label> : null}<button type="button" disabled={!projectId || !sourceAssetId || unavailable || (operation === "compose" && !overlayAssetId)} onClick={() => void queue()}>Queue Vision job</button></div><div className="panel"><h3>Capability status</h3><ul>{capabilities.length ? capabilities.map((capability) => <li key={capability.capabilityId}>{capability.capabilityId}: {capability.status}{capability.reason ? ` — ${capability.reason}` : ""}</li>) : <li>Vision service has not reported yet.</li>}</ul></div>{job ? <div className="panel"><h3>Vision job</h3><p>{job.operation}: {job.status}{job.errorMessage ? ` — ${job.errorMessage}` : ""}</p></div> : null}{message ? <p role="status">{message}</p> : null}</section>;
}
