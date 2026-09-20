"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import type { MotionPackageV2 } from "@/lib/vision/motion-package-v2";
import type { OcrRegion } from "@/lib/vision/contracts";
import { buildMotionPackageDraft, canComposeFinal, canRunCapability, capabilityDisplay, planJson, selectGenerationAttemptId, stateFromResponse, type VisionLabState } from "./model";

type Project = { id: string; name: string; canvas: string };
type CoreAsset = { id: string; projectId: string | null; kind: string; name: string; mime: string; width: number | null; height: number | null; createdAt: string };
type CoreJob = { id: string; status: string; modelId: string; outputAssetId: string | null; error: string | null; createdAt: string };
type Model = {
  id: string;
  label: string;
  family: string;
  tasks: string[];
  duration?: { min: number; max: number; smartValue?: -1 };
  resolutions?: string[];
  aspectRatios?: string[];
  defaultOptions: Record<string, string | number | boolean>;
  eligible: boolean;
  confirmedAt?: string | null;
  disabledReason?: string | null;
};
type RuntimeStatus = { state: "unloaded" | "loading" | "ready" | "error"; available: boolean; reason: string | null };
type Capability = {
  id: string;
  name: string;
  status: "available" | "planned" | "unavailable";
  runtime: string;
  provider: string;
  version: string;
  inputs: string[];
  outputs: string[];
  unavailableReason?: string;
  runtimeStatus?: RuntimeStatus;
};
type CapabilitiesResponse = { capabilities: Capability[]; sidecar: { status: "ready"; hardware: unknown } | { status: "unavailable"; reason: string } };
type OcrResult = { image: { width: number; height: number }; regions: OcrRegion[]; engine: { provider: string; model: string }; typographySafetyMaskArtifactId: string | null };
type SegmentationResult = { masks: { artifactId: string; boundingBox: { x: number; y: number; width: number; height: number } }[]; engine: { provider: string; model: string } };
type OverlayResult = { artifactId: string; sourceArtifactId: string; width: number; height: number; protectedRegionIds: string[]; paddingPixels: number };
type LayerResult = { layers: { id: string; artifactId: string; zIndex: number; alphaCoverage: number }[]; diagnostics: Record<string, unknown>; backend: { provider: string; model: string } };
type GenerationPlateResult = { artifactId: string; sourceArtifactId: string; typographyOverlayArtifactId: string; mode: "original-with-protected-text" | "layers-text-removed"; textRemoved: boolean; protectedRegionIds: string[]; width: number; height: number; warnings: string[] };
type NormalizedPoint = { x: number; y: number };
type PromotedAssets = {
  source: CoreAsset;
  overlay: CoreAsset;
  plate: CoreAsset;
  segmentation?: CoreAsset;
  layers: CoreAsset[];
};

const stateLabel: Record<VisionLabState, string> = {
  idle: "Choose a project image or upload a local image.",
  validating: "Validating the selected image…",
  "loading-model": "Checking the selected local capability…",
  processing: "Processing locally in the Vision sidecar…",
  success: "The latest local step is ready for review.",
  unavailable: "This optional local capability is unavailable.",
  error: "The latest step could not be completed.",
};

async function responseBody(response: Response) {
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Local request failed.");
  return body as T;
}

function createAttemptId() {
  return globalThis.crypto?.randomUUID?.() || `vision-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function VisionLab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectAssets, setProjectAssets] = useState<CoreAsset[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [catalog, setCatalog] = useState<CapabilitiesResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [existingImageAssetId, setExistingImageAssetId] = useState("");
  const [state, setState] = useState<VisionLabState>("idle");
  const [notice, setNotice] = useState(stateLabel.idle);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [segmentation, setSegmentation] = useState<SegmentationResult | null>(null);
  const [overlay, setOverlay] = useState<OverlayResult | null>(null);
  const [layers, setLayers] = useState<LayerResult | null>(null);
  const [plate, setPlate] = useState<GenerationPlateResult | null>(null);
  const [promoted, setPromoted] = useState<PromotedAssets | null>(null);
  const [motionPackage, setMotionPackage] = useState<MotionPackageV2 | null>(null);
  const [job, setJob] = useState<CoreJob | null>(null);
  const [finalAsset, setFinalAsset] = useState<CoreAsset | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const inFlightAttemptId = useRef<string | null>(null);
  const [busy, setBusy] = useState<"preparing" | "generating" | "composing" | null>(null);
  const [prompt, setPrompt] = useState("Gentle camera movement with subtle ambient motion around the product.");
  const [modelId, setModelId] = useState("alibaba:wan3-video");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720P");
  const [aspectRatio, setAspectRatio] = useState("adaptive");
  const [layerPrompt, setLayerPrompt] = useState("Separate the primary subject into local RGBA layers.");
  const [layerCount, setLayerCount] = useState(4);
  const [layerSeed, setLayerSeed] = useState("17");
  const [plateMode, setPlateMode] = useState<GenerationPlateResult["mode"]>("original-with-protected-text");
  const [positivePoints, setPositivePoints] = useState<NormalizedPoint[]>([]);
  const [negativePoints, setNegativePoints] = useState<NormalizedPoint[]>([]);
  const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [boxStart, setBoxStart] = useState<NormalizedPoint | null>(null);
  const [subjectDx, setSubjectDx] = useState(0.03);
  const [subjectDy, setSubjectDy] = useState(0);
  const [cameraX, setCameraX] = useState(0);
  const [cameraY, setCameraY] = useState(0);

  const selectedAsset = projectAssets.find((asset) => asset.id === existingImageAssetId) || null;
  const sourcePreviewUrl = localPreviewUrl || (selectedAsset ? `/api/assets/${selectedAsset.id}/content` : null);
  const imageAssets = projectAssets.filter((asset) => asset.mime.startsWith("image/"));
  const wanModels = models.filter((model) => model.family === "wan3" && model.tasks.includes("image-to-video"));
  const selectedModel = wanModels.find((model) => model.id === modelId) || null;
  const sourceSelected = Boolean(file || selectedAsset);
  const capabilities = catalog?.capabilities || [];
  const ocrCapability = capabilities.find((capability) => capability.id === "image.ocr");
  const segmentationCapability = capabilities.find((capability) => capability.id === "image.segment");
  const layersCapability = capabilities.find((capability) => capability.id === "image.layers");
  const ocrAvailable = ocrCapability ? canRunCapability(ocrCapability) : false;
  const segmentationAvailable = segmentationCapability ? canRunCapability(segmentationCapability) : false;
  const layersAvailable = layersCapability ? canRunCapability(layersCapability) : false;
  const sidecarReady = catalog?.sidecar.status === "ready";
  const safePlan = motionPackage?.plan || null;
  const canGenerate = Boolean(motionPackage && selectedModel?.eligible && selectedModel.id === motionPackage.generation.modelId && ["ready", "reduced"].includes(motionPackage.plan.status));

  useEffect(() => {
    let active = true;
    void Promise.all([api<Project[]>("/api/projects"), api<Model[]>("/api/models"), api<CapabilitiesResponse>("/api/capabilities")])
      .then(([nextProjects, nextModels, nextCatalog]) => {
        if (!active) return;
        setProjects(nextProjects);
        setModels(nextModels);
        setCatalog(nextCatalog);
        setProjectId((current) => current || nextProjects[0]?.id || "");
      })
      .catch((error) => active && setNotice(error instanceof Error ? error.message : "Unable to load the local studio."));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!projectId) return setProjectAssets([]);
    let active = true;
    void api<CoreAsset[]>(`/api/assets?projectId=${encodeURIComponent(projectId)}`)
      .then((assets) => active && setProjectAssets(assets))
      .catch((error) => active && setNotice(error instanceof Error ? error.message : "Project assets could not be loaded."));
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!file) return setLocalPreviewUrl(null);
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!job?.id || ["completed", "failed", "needs_attention", "submission_unknown", "canceled"].includes(job.status)) return;
    let active = true;
    const poll = async () => {
      try {
        const nextJob = await api<CoreJob>(`/api/jobs/${job.id}`);
        if (!active) return;
        setJob(nextJob);
        if (nextJob.status === "completed" && nextJob.outputAssetId) setNotice("Raw Wan video is saved locally. Review it, then compose the protected typography.");
        if (["failed", "needs_attention", "submission_unknown", "canceled"].includes(nextJob.status)) setNotice(nextJob.error || `Generation stopped with status ${nextJob.status}.`);
      } catch (error) {
        active && setNotice(error instanceof Error ? error.message : "Generation status could not be refreshed.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [job?.id, job?.status]);

  const resetWorkflow = () => {
    setOcr(null); setSegmentation(null); setOverlay(null); setLayers(null); setPlate(null); setPromoted(null); setMotionPackage(null); setJob(null); setFinalAsset(null); setAttemptId(null); inFlightAttemptId.current = null;
    setPositivePoints([]); setNegativePoints([]); setBoundingBox(null);
    setState("idle"); setNotice(stateLabel.idle);
  };

  async function inputFile(): Promise<File> {
    if (file) return file;
    if (!selectedAsset) throw new Error("Choose an image from this project or upload a local image.");
    const response = await fetch(`/api/assets/${selectedAsset.id}/content`);
    if (!response.ok) throw new Error("The selected project image could not be read locally.");
    return new File([await response.blob()], selectedAsset.name, { type: selectedAsset.mime });
  }

  async function runForm(path: string, body: FormData, workingLabel: string) {
    setState("loading-model");
    setNotice(`Checking ${workingLabel}…`);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    setState("processing");
    setNotice(`Running ${workingLabel} locally…`);
    const { response, body: result } = await fetch(path, { method: "POST", body })
      .then(responseBody)
      .catch(() => ({ response: new Response(null, { status: 503 }), body: { error: "The local Vision sidecar did not respond." } }));
    const nextState = stateFromResponse(response.status);
    setState(nextState);
    setNotice(nextState === "success" ? `${workingLabel} is ready for review.` : String(result.error || stateLabel[nextState]));
    return nextState === "success" ? result : null;
  }

  async function runOcr() {
    try {
      const image = await inputFile();
      const body = new FormData(); body.append("image", image);
      const result = await runForm("/api/vision/ocr", body, "text analysis") as OcrResult | null;
      if (result) { setOcr(result); setOverlay(null); setPlate(null); setPromoted(null); setMotionPackage(null); }
    } catch (error) { setState("error"); setNotice(error instanceof Error ? error.message : stateLabel.error); }
  }

  async function runSegment() {
    if (!positivePoints.length && !boundingBox) {
      setState("validating");
      setNotice("Click the image to add a positive point, or Alt-drag to draw a subject box.");
      return;
    }
    try {
      const image = await inputFile();
      const body = new FormData(); body.append("image", image); body.append("prompts", JSON.stringify({ positivePoints, negativePoints, boundingBox }));
      const result = await runForm("/api/vision/segment", body, "subject analysis") as SegmentationResult | null;
      if (result) { setSegmentation(result); setPromoted(null); setMotionPackage(null); }
    } catch (error) { setState("error"); setNotice(error instanceof Error ? error.message : stateLabel.error); }
  }

  async function runLayers() {
    try {
      const image = await inputFile();
      const body = new FormData(); body.append("image", image); body.append("prompt", layerPrompt); body.append("requestedLayerCount", String(layerCount)); body.append("seed", layerSeed);
      const result = await runForm("/api/vision/layers", body, "layer analysis") as LayerResult | null;
      if (result) { setLayers(result); setPromoted(null); setMotionPackage(null); }
    } catch (error) { setState("error"); setNotice(error instanceof Error ? error.message : stateLabel.error); }
  }

  async function runOverlay() {
    if (!ocr) return;
    try {
      const image = await inputFile();
      const body = new FormData(); body.append("image", image); body.append("regions", JSON.stringify(ocr.regions));
      const result = await runForm("/api/vision/overlay", body, "trusted typography overlay") as OverlayResult | null;
      if (result) { setOverlay(result); setPlate(null); setPromoted(null); setMotionPackage(null); }
    } catch (error) { setState("error"); setNotice(error instanceof Error ? error.message : stateLabel.error); }
  }

  async function runGenerationPlate() {
    if (!overlay || !ocr) return;
    setState("processing"); setNotice("Building a generation plate and validating typography protection…");
    const { response, body: result } = await fetch("/api/vision/plates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceArtifactId: overlay.sourceArtifactId,
        typographyOverlayArtifactId: overlay.artifactId,
        regions: ocr.regions,
        mode: plateMode,
        layerArtifactIds: layers?.layers.map((layer) => layer.artifactId) || [],
      }),
    }).then(responseBody).catch(() => ({ response: new Response(null, { status: 503 }), body: { error: "The local Vision sidecar did not respond." } }));
    const nextState = stateFromResponse(response.status);
    setState(nextState);
    setNotice(nextState === "success" ? "Generation plate is ready. Review the protected preview before preparing motion." : String(result.error || stateLabel[nextState]));
    if (nextState === "success") { setPlate(result as GenerationPlateResult); setPromoted(null); setMotionPackage(null); }
  }

  async function promote(visionArtifactId: string, expectedKind: string, name: string, provenance: Record<string, unknown>) {
    return api<CoreAsset>("/api/vision/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, visionArtifactId, expectedKind, name, provenance }),
    });
  }

  async function prepareMotion() {
    if (!projectId || !ocr || !overlay || !plate || !selectedModel) {
      setNotice("Choose a project, analyze text, build a trusted overlay and generation plate, then select a Wan 3 model.");
      return;
    }
    setBusy("preparing");
    setState("processing");
    setNotice("Saving reviewed Vision artifacts to this project and running safe-motion preflight…");
    try {
      const source = await promote(overlay.sourceArtifactId, "source-image", "vision-source.png", { visionLab: { source: selectedAsset?.id || "local-upload" } });
      const trustedOverlay = await promote(overlay.artifactId, "typography-overlay", "trusted-typography-overlay.png", { sourceAssetId: source.id, ocrProvider: ocr.engine.provider, ocrModel: ocr.engine.model });
      const generationPlate = await promote(plate.artifactId, "generation-plate", "generation-plate.png", { sourceAssetId: source.id, typographyOverlayAssetId: trustedOverlay.id });
      const segmentationMask = segmentation?.masks[0]
        ? await promote(segmentation.masks[0].artifactId, "segmentation-mask", "primary-subject-mask.png", { sourceAssetId: source.id, engine: segmentation.engine })
        : undefined;
      const promotedLayers = layers
        ? await Promise.all(layers.layers.map((layer, index) => promote(layer.artifactId, "rgba-layer", `vision-layer-${index + 1}.png`, { sourceAssetId: source.id, layerId: layer.id, zIndex: layer.zIndex })))
        : [];
      const prepared = { source, overlay: trustedOverlay, plate: generationPlate, ...(segmentationMask ? { segmentation: segmentationMask } : {}), layers: promotedLayers };
      const subjectBounds = segmentation?.masks[0]?.boundingBox || { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
      const draft = buildMotionPackageDraft({
        projectId,
        assets: { sourceAssetId: source.id, generationPlateAssetId: generationPlate.id, typographyOverlayAssetId: trustedOverlay.id, segmentationMaskAssetId: segmentationMask?.id, layerAssetIds: promotedLayers.map((asset) => asset.id) },
        plateMode: plate.mode,
        plateTextRemoved: plate.textRemoved,
        ocr: { provider: ocr.engine.provider, model: ocr.engine.model, regions: ocr.regions },
        ...(segmentation && segmentationMask ? { segmentation: { provider: segmentation.engine.provider, model: segmentation.engine.model, bounds: segmentation.masks.map((mask) => mask.boundingBox) } } : {}),
        ...(layers ? { layers: { provider: layers.backend.provider, model: layers.backend.model, diagnostics: layers.diagnostics } } : {}),
        subjectBounds,
        requested: { subject: { x: subjectDx, y: subjectDy }, camera: { x: cameraX, y: cameraY, zoom: 0, type: "custom" } },
        generation: { modelId: selectedModel.id, duration, resolution, aspectRatio, prompt, audio: false },
      });
      setPromoted(prepared);
      if (draft.plan.status === "rejected") {
        setMotionPackage(null);
        setState("error");
        setNotice(draft.plan.warnings.at(-1) || "Safe Motion rejected this movement before generation.");
        return;
      }
      const result = await api<{ package: MotionPackageV2 }>("/api/vision/motion-packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      setMotionPackage(result.package);
      setAttemptId(null); inFlightAttemptId.current = null; setJob(null); setFinalAsset(null);
      setState("success");
      setNotice("Safe Motion preflight passed. Review the protected preview, then queue one Wan request when ready.");
    } catch (error) {
      setState("error");
      setNotice(error instanceof Error ? error.message : "The project assets could not be prepared.");
    } finally {
      setBusy(null);
    }
  }

  async function queueMotion() {
    if (!motionPackage || !selectedModel?.eligible) return;
    const nextAttemptId = selectGenerationAttemptId(attemptId, inFlightAttemptId.current, createAttemptId);
    inFlightAttemptId.current = nextAttemptId;
    setAttemptId(nextAttemptId);
    setBusy("generating");
    setNotice("Queueing one guarded Wan motion request through the persistent worker…");
    try {
      const queued = await api<CoreJob>("/api/vision/motion-packages/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ package: motionPackage, generationAttemptId: nextAttemptId }),
      });
      setJob(queued);
      setState("success");
      setNotice("One Wan request is queued. Closing this page will not stop the worker or lose the job.");
    } catch (error) {
      setState("error");
      setNotice(error instanceof Error ? error.message : "The guarded generation request could not be queued.");
    } finally {
      setBusy(null);
    }
  }

  async function composeFinal() {
    if (!motionPackage || !canComposeFinal(job) || !job?.outputAssetId) return;
    setBusy("composing");
    setNotice("Compositing the original trusted typography above the saved raw video locally…");
    try {
      const result = await api<CoreAsset>("/api/vision/motion-packages/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ package: motionPackage, rawVideoAssetId: job.outputAssetId }),
      });
      setFinalAsset(result);
      setState("success");
      setNotice("Final MP4 is saved locally with the original typography composited on top.");
    } catch (error) {
      setState("error");
      setNotice(error instanceof Error ? error.message : "Final composition could not be completed.");
    } finally {
      setBusy(null);
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

  const previewPlate = promoted ? `/api/assets/${promoted.plate.id}/content` : plate ? `/api/vision/artifacts/${plate.artifactId}` : sourcePreviewUrl;
  const previewOverlay = promoted ? `/api/assets/${promoted.overlay.id}/content` : overlay ? `/api/vision/artifacts/${overlay.artifactId}` : null;
  const finalMotion = safePlan?.final;

  return <main className="vision-lab">
    <header className="vision-lab__header">
      <div><a className="vision-lab__back" href="/">Back to Studio</a><h1>Experimental Vision Lab</h1><p>Analyze a project image, protect its original typography, then create one reviewable motion clip and a locally composed final.</p></div>
      <p className={`vision-lab__notice vision-lab__notice--${state}`}><strong>{state.replace("-", " ")}</strong>{notice}</p>
    </header>

    <section className="vision-lab__capabilities" aria-label="Capability availability">
      {capabilities.map((capability) => {
        const display = capabilityDisplay(capability);
        return <article key={capability.id} className="vision-lab__capability"><div><strong>{capability.name}</strong><span className={`vision-lab__badge vision-lab__badge--${display.toLowerCase()}`}>{display}</span></div><p>{capability.runtimeStatus?.reason || capability.unavailableReason || `${capability.provider} ${capability.version}`}</p></article>;
      })}
      {!capabilities.length && <p className="vision-lab__empty">Loading the local capability catalog…</p>}
    </section>

    <section className="vision-lab__workflow">
      <div className="vision-lab__controls">
        <div className="vision-lab__section-heading"><h2>1. Choose a project image</h2><p>Select an existing project image or keep the file local until you are ready to save the reviewed Vision artifacts.</p></div>
        <label>Project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setExistingImageAssetId(""); setFile(null); resetWorkflow(); }}><option value="">Choose a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.canvas}</option>)}</select></label>
        {!projects.length && <p className="vision-lab__empty">Create a project in Studio before preparing a production motion package.</p>}
        <label>Existing project image<select value={existingImageAssetId} disabled={!projectId} onChange={(event) => { setExistingImageAssetId(event.target.value); setFile(null); resetWorkflow(); }}><option value="">Choose an existing image</option>{imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</option>)}</select></label>
        <label>Or upload a local image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setExistingImageAssetId(""); resetWorkflow(); }} /></label>
        {sourcePreviewUrl && <div className="vision-lab__source-preview"><img src={sourcePreviewUrl} alt="Selected source image for local Vision analysis" onPointerDown={selectSubjectPoint} onPointerUp={finishSubjectBox} /><p>Click for a positive subject point, Shift-click for a negative point, or Alt-drag a subject box. Positive: {positivePoints.length}; negative: {negativePoints.length}; box: {boundingBox ? "selected" : "none"}.</p><button type="button" onClick={() => { setPositivePoints([]); setNegativePoints([]); setBoundingBox(null); }}>Clear subject prompts</button></div>}
      </div>

      <div className="vision-lab__controls">
        <div className="vision-lab__section-heading"><h2>2. Analyze and protect</h2><p>Text analysis is required. Subject and layer analysis are optional and are shown only when their real local runtime is available.</p></div>
        <div className="vision-lab__actions"><button type="button" className="primary" disabled={!sourceSelected || !sidecarReady || !ocrAvailable || busy !== null} onClick={() => void runOcr()}>Analyze text</button><button type="button" disabled={!sourceSelected || !sidecarReady || !segmentationAvailable || busy !== null} onClick={() => void runSegment()}>Analyze subject</button><button type="button" disabled={!sourceSelected || !sidecarReady || !layersAvailable || busy !== null} onClick={() => void runLayers()}>Analyze layers</button></div>
        {!ocrAvailable && <p className="vision-lab__hint">Text analysis is unavailable until PaddleOCR is configured in the local Vision sidecar.</p>}
        <label>Optional layer guidance<textarea value={layerPrompt} onChange={(event) => setLayerPrompt(event.target.value)} disabled={!layersAvailable} /></label>
        <div className="vision-lab__inline-fields"><label>Layers<select value={layerCount} onChange={(event) => setLayerCount(Number(event.target.value))} disabled={!layersAvailable}><option value={4}>4</option><option value={6}>6</option><option value={8}>8</option></select></label><label>Deterministic seed<input value={layerSeed} inputMode="numeric" onChange={(event) => setLayerSeed(event.target.value)} disabled={!layersAvailable} /></label></div>
        <div className="vision-lab__actions"><button type="button" disabled={!ocr || !sidecarReady || busy !== null} onClick={() => void runOverlay()}>Create trusted overlay</button><label>Generation plate mode<select value={plateMode} onChange={(event) => { setPlateMode(event.target.value as GenerationPlateResult["mode"]); setPromoted(null); setMotionPackage(null); }}><option value="original-with-protected-text">Original image with trusted text fixed above</option><option value="layers-text-removed" disabled={!layers}>Layers with text removed</option></select></label><button type="button" disabled={!overlay || (plateMode === "layers-text-removed" && !layers) || !sidecarReady || busy !== null} onClick={() => void runGenerationPlate()}>Build generation plate</button></div>
        {ocr && <details><summary>Text regions ({ocr.regions.length})</summary><ul className="vision-lab__regions">{ocr.regions.map((region) => <li key={region.id}><strong>{region.text || "Unrecognized text"}</strong> · {Math.round((region.recognitionConfidence || region.detectionConfidence || 0) * 100)}% confidence · protected</li>)}</ul></details>}
        {segmentation && <p className="vision-lab__hint">Subject mask ready: {segmentation.masks.length} candidate mask(s). The first reviewed mask will be used for safe-motion preflight.</p>}
        {layers && <p className="vision-lab__hint">Layer analysis ready: {layers.layers.length} RGBA layers from {layers.backend.provider}. It remains optional; the protected typography overlay is authoritative.</p>}
      </div>

      <div className="vision-lab__controls">
        <div className="vision-lab__section-heading"><h2>3. Review the safe motion plan</h2><p>Only persistent project assets can be sent through the guarded generation path. The plate is the only input sent to Wan; trusted typography remains local.</p></div>
        <label>Wan 3 model<select value={modelId} onChange={(event) => { setModelId(event.target.value); setMotionPackage(null); setAttemptId(null); inFlightAttemptId.current = null; }}><option value="">Choose a Wan 3 model</option>{wanModels.map((model) => <option key={model.id} value={model.id}>{model.label}{model.eligible ? "" : " — Free Quota Only unconfirmed"}</option>)}</select></label>
        {selectedModel?.disabledReason && <p className="vision-lab__hint">{selectedModel.disabledReason}</p>}
        <label>Motion direction<textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setMotionPackage(null); setAttemptId(null); inFlightAttemptId.current = null; }} /></label>
        <div className="vision-lab__inline-fields"><label>Duration<select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setMotionPackage(null); }} disabled={!selectedModel}>{Array.from({ length: Math.max(0, (selectedModel?.duration?.max || 5) - (selectedModel?.duration?.min || 5) + 1) }, (_, index) => (selectedModel?.duration?.min || 5) + index).filter((value) => value >= 3 && value <= 5).map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label><label>Resolution<select value={resolution} onChange={(event) => { setResolution(event.target.value); setMotionPackage(null); }} disabled={!selectedModel}>{(selectedModel?.resolutions || ["720P"]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Aspect ratio<select value={aspectRatio} onChange={(event) => { setAspectRatio(event.target.value); setMotionPackage(null); }} disabled={!selectedModel}>{(selectedModel?.aspectRatios || ["adaptive"]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div>
        <div className="vision-lab__motion-grid"><label>Subject horizontal motion ({subjectDx.toFixed(3)})<input type="range" min="-0.2" max="0.2" step="0.005" value={subjectDx} onChange={(event) => { setSubjectDx(Number(event.target.value)); setMotionPackage(null); }} /></label><label>Subject vertical motion ({subjectDy.toFixed(3)})<input type="range" min="-0.2" max="0.2" step="0.005" value={subjectDy} onChange={(event) => { setSubjectDy(Number(event.target.value)); setMotionPackage(null); }} /></label><label>Camera horizontal motion ({cameraX.toFixed(3)})<input type="range" min="-0.02" max="0.02" step="0.005" value={cameraX} onChange={(event) => { setCameraX(Number(event.target.value)); setMotionPackage(null); }} /></label><label>Camera vertical motion ({cameraY.toFixed(3)})<input type="range" min="-0.02" max="0.02" step="0.005" value={cameraY} onChange={(event) => { setCameraY(Number(event.target.value)); setMotionPackage(null); }} /></label></div>
        <button type="button" className="primary" disabled={!plate || !overlay || !ocr || !projectId || !selectedModel || busy !== null} onClick={() => void prepareMotion()}>{busy === "preparing" ? "Preparing project assets…" : "Save project assets and preflight motion"}</button>
        {safePlan && <div className={`vision-lab__plan vision-lab__plan--${safePlan.status}`}><strong>Safe Motion: {safePlan.status}</strong><p>{safePlan.warnings.join(" ") || "The selected motion avoids protected typography."}</p>{safePlan.collisions.length > 0 && <p>{safePlan.collisions.length} collision(s) found; the planner reduced or blocked unsafe movement.</p>}</div>}
        {finalMotion && previewPlate && <div className="vision-lab__protected-preview"><img src={previewPlate} alt="Generation plate preview" style={{ transform: `translate(${finalMotion.camera.x * 100}%, ${finalMotion.camera.y * 100}%) scale(${1 + finalMotion.camera.zoom})` }} />{previewOverlay && <img src={previewOverlay} alt="Fixed original typography overlay" />}</div>}
      </div>

      <div className="vision-lab__controls">
        <div className="vision-lab__section-heading"><h2>4. Generate and compose</h2><p>Generation remains explicit. Provider audio is disabled; the final composition uses the original transparent typography overlay.</p></div>
        <button type="button" className="primary" disabled={!canGenerate || busy !== null || Boolean(job && !["failed", "needs_attention", "submission_unknown", "canceled"].includes(job.status))} onClick={() => void queueMotion()}>{busy === "generating" ? "Queueing one request…" : selectedModel?.eligible ? "Generate one protected motion clip" : "Confirm Free Quota Only in Settings"}</button>
        {motionPackage && !selectedModel?.eligible && <p className="vision-lab__hint">Generation is blocked until this exact Wan model is user-confirmed in Settings with Alibaba Free Quota Only enabled.</p>}
        {job && <div className="vision-lab__job"><strong>Generation job {job.id.slice(-8)}</strong><span className={`vision-lab__badge vision-lab__badge--${job.status}`}>{job.status}</span><p>{job.error || `Using ${job.modelId}. This state is stored locally and survives page refreshes.`}</p>{job.outputAssetId && <a href={`/api/assets/${job.outputAssetId}/content`} target="_blank" rel="noreferrer">Review locally saved raw video</a>}</div>}
        <button type="button" disabled={!canComposeFinal(job) || busy !== null || Boolean(finalAsset)} onClick={() => void composeFinal()}>{busy === "composing" ? "Compositing original typography…" : finalAsset ? "Final composition saved" : "Compose Final"}</button>
        {finalAsset && <div className="vision-lab__final"><strong>Final MP4 saved</strong><a href={`/api/assets/${finalAsset.id}/content`} target="_blank" rel="noreferrer">Open final local video</a><span>{finalAsset.width}×{finalAsset.height}</span></div>}
      </div>
    </section>

    {promoted && <details className="vision-lab__details"><summary>Persistent project asset provenance</summary><pre>{planJson({ source: promoted.source.id, typographyOverlay: promoted.overlay.id, generationPlate: promoted.plate.id, segmentation: promoted.segmentation?.id || null, layers: promoted.layers.map((asset) => asset.id) })}</pre></details>}
  </main>;
}
