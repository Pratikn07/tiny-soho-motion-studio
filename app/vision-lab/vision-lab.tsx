"use client";

import { type PointerEvent, useEffect, useMemo, useState } from "react";
import { createMotionPackage } from "@/lib/safe-motion/motion-package";
import { createSafeMotionPlan } from "@/lib/safe-motion/planner";
import { MockVisionGenerationBridge } from "@/lib/safe-motion/bridge";
import type { SafeMotionPlan } from "@/lib/safe-motion/schema";
import { planJson, stateFromResponse, type VisionLabState } from "./model";

type OcrRegion = { id: string; text: string; boundingBox: { x: number; y: number; width: number; height: number } };
type OcrResult = { image: { width: number; height: number }; regions: OcrRegion[]; typographySafetyMaskArtifactId: string | null };
type SegmentationResult = { masks: { artifactId: string; boundingBox: { x: number; y: number; width: number; height: number } }[] };
type OverlayResult = { artifactId: string; sourceArtifactId: string; width: number; height: number; protectedRegionIds: string[]; paddingPixels: number; mode: "original-region-patch" };
type NormalizedPoint = { x: number; y: number };
type LayerResult = { layers: { id: string; artifactId: string; zIndex: number; alphaCoverage: number }[]; diagnostics: unknown; options: unknown };

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
  const [layers, setLayers] = useState<LayerResult | null>(null);
  const [plan, setPlan] = useState<SafeMotionPlan | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [prompt, setPrompt] = useState("Separate the primary subject into local RGBA layers.");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [positivePoints, setPositivePoints] = useState<NormalizedPoint[]>([]);
  const [negativePoints, setNegativePoints] = useState<NormalizedPoint[]>([]);
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [boxStart, setBoxStart] = useState<NormalizedPoint | null>(null);
  const [layerCount, setLayerCount] = useState(4);
  const [layerSeed, setLayerSeed] = useState("17");
  const [subjectDx, setSubjectDx] = useState(0.08);
  const [subjectDy, setSubjectDy] = useState(0);
  const [cameraX, setCameraX] = useState(0);
  const [cameraY, setCameraY] = useState(-0.015);

  useEffect(() => {
    void fetch("/api/capabilities", { cache: "no-store" })
      .then(responseBody)
      .then(({ body }) => setCapabilities(body))
      .catch(() => setCapabilities({ status: "unavailable", reason: "Capability catalog could not be loaded." }));
  }, []);

  useEffect(() => {
    if (!file) return setPreviewUrl(null);
    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

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
    if (!positivePoints.length && !boundingBox) {
      setState("validating");
      setNotice("Click the local image to add a positive point, or Alt-drag to draw a subject box.");
      return;
    }
    const body = new FormData(); body.append("image", file); body.append("prompts", JSON.stringify({ positivePoints, negativePoints, boundingBox }));
    const result = await runForm("/api/vision/segment", body) as SegmentationResult | null;
    if (result) setSegmentation(result);
  }

  async function runLayers() {
    if (!file) return;
    const body = new FormData(); body.append("image", file); body.append("prompt", prompt); body.append("requestedLayerCount", String(layerCount)); body.append("seed", layerSeed);
    const result = await runForm("/api/vision/layers", body) as LayerResult | null;
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
      requested: { subject: { x: subjectDx, y: subjectDy }, camera: { x: cameraX, y: cameraY } },
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

  function normalizedPointer(event: PointerEvent<HTMLImageElement>): NormalizedPoint {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)), y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) };
  }

  function selectSubjectPoint(event: PointerEvent<HTMLImageElement>) {
    const point = normalizedPointer(event);
    if (event.altKey) return setBoxStart(point);
    if (event.shiftKey) setNegativePoints((current) => [...current, point]);
    else setPositivePoints((current) => [...current, point]);
  }

  function finishSubjectBox(event: PointerEvent<HTMLImageElement>) {
    if (!boxStart || !event.altKey) return;
    const end = normalizedPointer(event);
    const x = Math.min(boxStart.x, end.x); const y = Math.min(boxStart.y, end.y);
    const width = Math.abs(boxStart.x - end.x); const height = Math.abs(boxStart.y - end.y);
    if (width > 0.01 && height > 0.01) setBoundingBox({ x, y, width, height });
    setBoxStart(null);
  }

  return <main className="board">
    <a href="/">← Studio</a>
    <p className="eyebrow">EXPERIMENTAL · LOCAL VISION ONLY</p>
    <h1>Vision Lab</h1>
    <p>Inspect OCR, segmentation, RGBA layer contracts, typography overlays, and Safe Motion drafts. This page has no cloud-generation control and never installs models or downloads weights.</p>
    <p className="board-notice"><b>{state.toUpperCase()}</b> · {notice}</p>
    <section className="board-form">
      <label>Local image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setPositivePoints([]); setNegativePoints([]); setBoundingBox(null); setState("idle"); setNotice(stateLabel.idle); }} /></label>
      <label>Layer guidance<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
      <label>Requested local layers<select value={layerCount} onChange={(event) => setLayerCount(Number(event.target.value))}><option value={4}>4</option><option value={6}>6</option><option value={8}>8</option></select></label>
      <label>Deterministic layer seed<input value={layerSeed} inputMode="numeric" onChange={(event) => setLayerSeed(event.target.value)} /></label>
      <label>Subject horizontal motion ({subjectDx.toFixed(3)})<input type="range" min="-0.2" max="0.2" step="0.005" value={subjectDx} onChange={(event) => setSubjectDx(Number(event.target.value))} /></label>
      <label>Subject vertical motion ({subjectDy.toFixed(3)})<input type="range" min="-0.2" max="0.2" step="0.005" value={subjectDy} onChange={(event) => setSubjectDy(Number(event.target.value))} /></label>
      <label>Camera horizontal motion ({cameraX.toFixed(3)})<input type="range" min="-0.1" max="0.1" step="0.005" value={cameraX} onChange={(event) => setCameraX(Number(event.target.value))} /></label>
      <label>Camera vertical motion ({cameraY.toFixed(3)})<input type="range" min="-0.1" max="0.1" step="0.005" value={cameraY} onChange={(event) => setCameraY(Number(event.target.value))} /></label>
      <button type="button" className="batch" disabled={!canInspect} onClick={() => void runOcr()}>Run OCR contract</button>
      <button type="button" className="batch" disabled={!canInspect} onClick={() => void runSegment()}>Run segmentation contract</button>
      <button type="button" className="batch" disabled={!canInspect} onClick={() => void runLayers()}>Inspect layers contract</button>
      <button type="button" className="batch" disabled={!ocr} onClick={() => void runOverlay()}>Create trusted overlay</button>
      <button type="button" className="batch" disabled={!canInspect} onClick={buildSafePlan}>Build Safe Motion draft</button>
    </section>
    {previewUrl && <section className="director-card">
      <h2>Subject prompt canvas</h2>
      <p>Click for a positive point, Shift-click for a negative point, or Alt-drag to draw a bounding box. All coordinates remain local and normalized.</p>
      <img src={previewUrl} alt="Click to select a segmentation subject" onPointerDown={selectSubjectPoint} onPointerUp={finishSubjectBox} style={{ display: "block", width: 320, maxWidth: "100%", cursor: "crosshair", borderRadius: 10 }} />
      <p>Positive: {positivePoints.length} · Negative: {negativePoints.length} · Box: {boundingBox ? "selected" : "none"}</p>
      <button type="button" onClick={() => { setPositivePoints([]); setNegativePoints([]); setBoundingBox(null); }}>Clear subject prompts</button>
    </section>}
    <section className="director-card"><h2>Capability catalog</h2><pre>{planJson(capabilities)}</pre></section>
    {ocr && <section className="director-card"><h2>OCR protection</h2><p>{ocr.regions.length} detected text region(s); low-confidence regions remain protected rather than discarded.</p><pre>{planJson(ocr)}</pre></section>}
    {segmentation && <section className="director-card"><h2>Segmentation mask</h2><pre>{planJson(segmentation)}</pre></section>}
    {layers && <section className="director-card"><h2>Layer diagnostics</h2><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{layers.layers.map((layer) => <a key={layer.artifactId} href={`/api/vision/artifacts/${layer.artifactId}`} target="_blank"><img src={`/api/vision/artifacts/${layer.artifactId}`} alt={`${layer.id} RGBA layer`} style={{ width: 120, height: 90, objectFit: "contain", background: "#ddd7cd" }} /><small>{layer.id} · z{layer.zIndex} · α {layer.alphaCoverage.toFixed(2)}</small></a>)}</div><pre>{planJson(layers)}</pre></section>}
    {overlay && <section className="director-card"><h2>Trusted typography overlay</h2><a href={`/api/vision/artifacts/${overlay.artifactId}`} target="_blank">Open local PNG overlay</a><pre>{planJson(overlay)}</pre></section>}
    {previewUrl && plan?.final && <section className="director-card"><h2>Deterministic local preview</h2><p>Camera movement is previewed locally; the trusted overlay remains fixed above it. Subject safety is enforced by the plan’s collision report.</p><div style={{ position: "relative", width: 320, maxWidth: "100%", overflow: "hidden", borderRadius: 10, background: "#171a20" }}><img src={previewUrl} alt="Selected local source" style={{ display: "block", width: "100%", transform: `translate(${plan.final.camera.x * 100}%, ${plan.final.camera.y * 100}%)`, transition: "transform 180ms linear" }} />{overlay && <img src={`/api/vision/artifacts/${overlay.artifactId}`} alt="Trusted typography overlay" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" }} />}</div><pre>{planJson(plan.collisions)}</pre></section>}
    {artifactIds.length > 0 && <section className="director-card"><h2>Owned local artifacts</h2>{artifactIds.map((artifactId) => <p key={artifactId}><a href={`/api/vision/artifacts/${artifactId}`} target="_blank">{artifactId}</a></p>)}</section>}
    {plan && <section className="director-card"><h2>Safe Motion plan</h2><pre>{planJson(plan)}</pre></section>}
    {draft !== null && <section className="director-card"><h2>Draft-only generation bridge</h2><pre>{planJson(draft)}</pre></section>}
  </main>;
}
