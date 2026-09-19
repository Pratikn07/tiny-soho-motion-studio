"use client";

import { useEffect, useMemo, useState } from "react";
import { createMotionPackage } from "@/lib/safe-motion/motion-package";
import { createSafeMotionPlan } from "@/lib/safe-motion/planner";
import { MockVisionGenerationBridge } from "@/lib/safe-motion/bridge";
import { planJson, stateFromResponse, type VisionLabState } from "./model";

type OcrRegion = { id: string; text: string; boundingBox: { x: number; y: number; width: number; height: number } };
type OcrResult = { image: { width: number; height: number }; regions: OcrRegion[]; typographySafetyMaskArtifactId: string | null };
type SegmentationResult = { masks: { artifactId: string; boundingBox: { x: number; y: number; width: number; height: number } }[] };
type OverlayResult = { artifactId: string; sourceArtifactId: string; width: number; height: number; protectedRegionIds: string[]; paddingPixels: number; mode: "original-region-patch" };

const stateLabel: Record<VisionLabState, string> = {
  idle: "Choose a local image to begin.",
  validating: "Validating local image input…",
  "loading-model": "Checking local capability…",
  processing: "Processing with the local vision sidecar…",
  success: "Local result ready.",
  unavailable: "This optional local capability is unavailable.",
  error: "The local request could not be completed.",
};

async function responseBody(response: Response) {
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

export default function VisionLab() {
  const [file, setFile] = useState<File | null>(null);
  const [capabilities, setCapabilities] = useState<unknown>(null);
  const [state, setState] = useState<VisionLabState>("idle");
  const [notice, setNotice] = useState(stateLabel.idle);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [segmentation, setSegmentation] = useState<SegmentationResult | null>(null);
  const [overlay, setOverlay] = useState<OverlayResult | null>(null);
  const [layers, setLayers] = useState<unknown>(null);
  const [plan, setPlan] = useState<unknown>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [prompt, setPrompt] = useState("Separate the primary subject into local RGBA layers.");

  useEffect(() => {
    void fetch("/api/capabilities", { cache: "no-store" })
      .then(responseBody)
      .then(({ body }) => setCapabilities(body))
      .catch(() => setCapabilities({ status: "unavailable", reason: "Capability catalog could not be loaded." }));
  }, []);

  const canInspect = Boolean(file);
  const regions = ocr?.regions || [];
  const artifactIds = useMemo(() => [
    ocr?.typographySafetyMaskArtifactId,
    segmentation?.masks[0]?.artifactId,
    overlay?.sourceArtifactId,
    overlay?.artifactId,
  ].filter((value): value is string => Boolean(value)), [ocr, segmentation, overlay]);

  async function runForm(path: string, body: FormData) {
    setState("processing");
    setNotice(stateLabel.processing);
    const { response, body: result } = await fetch(path, { method: "POST", body }).then(responseBody).catch(() => ({ response: new Response(null, { status: 503 }), body: { error: "Local sidecar did not respond." } }));
    const nextState = stateFromResponse(response.status);
    setState(nextState);
    setNotice(nextState === "success" ? stateLabel.success : String(result.error || stateLabel[nextState]));
    return nextState === "success" ? result : null;
  }

  async function runOcr() {
    if (!file) return;
    setState("validating");
    setNotice(stateLabel.validating);
    const body = new FormData(); body.append("image", file);
    const result = await runForm("/api/vision/ocr", body) as OcrResult | null;
    if (result) setOcr(result);
  }

  async function runSegment() {
    if (!file) return;
    const body = new FormData(); body.append("image", file); body.append("prompts", JSON.stringify({ positivePoints: [{ x: 0.5, y: 0.5 }] }));
    const result = await runForm("/api/vision/segment", body) as SegmentationResult | null;
    if (result) setSegmentation(result);
  }

  async function runLayers() {
    if (!file) return;
    const body = new FormData(); body.append("image", file); body.append("prompt", prompt);
    const result = await runForm("/api/vision/layers", body);
    if (result) setLayers(result);
  }

  async function runOverlay() {
    if (!file || !ocr) return;
    const body = new FormData(); body.append("image", file); body.append("regions", JSON.stringify(ocr.regions));
    const result = await runForm("/api/vision/overlay", body) as OverlayResult | null;
    if (result) setOverlay(result);
  }

  function buildSafePlan() {
    const subject = segmentation?.masks[0]?.boundingBox || { x: 0.2, y: 0.35, width: 0.2, height: 0.2 };
    const nextPlan = createSafeMotionPlan({
      subject: { id: "primary-subject", bounds: subject },
      typography: regions.map((region) => ({ id: region.id, bounds: region.boundingBox })),
      requested: { subject: { x: 0.08, y: 0 }, camera: { x: 0, y: -0.015 } },
    });
    setPlan(nextPlan);
    if (overlay && ocr && nextPlan.final) {
      const pkg = createMotionPackage({
        sourceBackgroundArtifactId: overlay.sourceArtifactId,
        typographyOverlay: overlay,
        plan: nextPlan,
      });
      setDraft(new MockVisionGenerationBridge().prepare(pkg));
    }
  }

  return <main className="board"><a href="/">← Studio</a><p className="eyebrow">EXPERIMENTAL · LOCAL VISION ONLY</p><h1>Vision Lab</h1><p>Inspect OCR, segmentation, RGBA layer contracts, typography overlays, and Safe Motion drafts. This page has no cloud-generation control and never installs models or downloads weights.</p><p className="board-notice"><b>{state.toUpperCase()}</b> · {notice}</p><section className="board-form"><label>Local image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setState("idle"); setNotice(stateLabel.idle); }} /></label><label>Layer guidance<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><button type="button" className="batch" disabled={!canInspect} onClick={() => void runOcr()}>Run OCR contract</button><button type="button" className="batch" disabled={!canInspect} onClick={() => void runSegment()}>Run segmentation contract</button><button type="button" className="batch" disabled={!canInspect} onClick={() => void runLayers()}>Inspect layers contract</button><button type="button" className="batch" disabled={!ocr} onClick={() => void runOverlay()}>Create trusted overlay</button><button type="button" className="batch" disabled={!canInspect} onClick={buildSafePlan}>Build Safe Motion draft</button></section><section className="director-card"><h2>Capability catalog</h2><pre>{planJson(capabilities)}</pre></section>{ocr && <section className="director-card"><h2>OCR protection</h2><p>{ocr.regions.length} detected text region(s); low-confidence regions remain protected rather than discarded.</p><pre>{planJson(ocr)}</pre></section>}{segmentation && <section className="director-card"><h2>Segmentation mask</h2><pre>{planJson(segmentation)}</pre></section>}{layers !== null && <section className="director-card"><h2>Layer diagnostics</h2><pre>{planJson(layers)}</pre></section>}{overlay && <section className="director-card"><h2>Trusted typography overlay</h2><a href={`/api/vision/artifacts/${overlay.artifactId}`} target="_blank">Open local PNG overlay</a><pre>{planJson(overlay)}</pre></section>}{artifactIds.length > 0 && <section className="director-card"><h2>Owned local artifacts</h2>{artifactIds.map((artifactId) => <p key={artifactId}><a href={`/api/vision/artifacts/${artifactId}`} target="_blank">{artifactId}</a></p>)}</section>}{plan !== null && <section className="director-card"><h2>Safe Motion plan</h2><pre>{planJson(plan)}</pre></section>}{draft !== null && <section className="director-card"><h2>Draft-only generation bridge</h2><pre>{planJson(draft)}</pre></section>}</main>;
}
