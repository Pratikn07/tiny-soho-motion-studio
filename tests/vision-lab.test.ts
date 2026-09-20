import { describe, expect, it } from "vitest";
import type { OcrRegion } from "@/lib/vision/contracts";

describe("experimental Vision Lab state model", () => {
  it("renders unavailable as a distinct non-error state and retains safe plan JSON", async () => {
    const { stateFromResponse, planJson } = await import("@/app/vision-lab/model");

    expect(stateFromResponse(503)).toBe("unavailable");
    expect(stateFromResponse(200)).toBe("success");
    expect(stateFromResponse(400)).toBe("error");
    expect(planJson({ status: "ready", final: { subject: { x: 0, y: 0 }, camera: { x: 0, y: 0 } } })).toContain('"status": "ready"');
  });
});

describe("Vision Lab production workflow", () => {
  const regions: OcrRegion[] = [{
    id: "title",
    text: "Tiny Soho",
    detectionConfidence: 0.99,
    recognitionConfidence: 0.98,
    polygon: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.2 }, { x: 0.1, y: 0.2 }],
    boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
  }];

  it("builds the generation request exclusively from promoted project assets", async () => {
    const { buildMotionPackageDraft } = await import("@/app/vision-lab/model");

    const draft = buildMotionPackageDraft({
      projectId: "project_1",
      assets: {
        sourceAssetId: "asset_source",
        generationPlateAssetId: "asset_plate",
        typographyOverlayAssetId: "asset_overlay",
        segmentationMaskAssetId: "asset_mask",
        layerAssetIds: ["asset_layer_1", "asset_layer_2"],
      },
      plateMode: "original-with-protected-text",
      plateTextRemoved: false,
      ocr: { provider: "PaddleOCR", model: "PP-OCRv5", regions },
      segmentation: { provider: "SAM 2", model: "sam2.1_hiera_tiny" },
      layers: { provider: "Qwen Image Layered", model: "Qwen/Qwen-Image-Layered", diagnostics: { recompositionMatchesInput: true } },
      subjectBounds: { x: 0.55, y: 0.45, width: 0.2, height: 0.2 },
      requested: { subject: { x: 0.03, y: 0 }, camera: { x: 0, y: 0, zoom: 0, type: "subtle-subject" } },
      generation: { modelId: "alibaba:wan3-video", duration: 5, resolution: "720P", aspectRatio: "adaptive", prompt: "Gentle movement around the product", audio: false },
    });

    expect(draft.sourceAssetId).toBe("asset_source");
    expect(draft.generationPlateAssetId).toBe("asset_plate");
    expect(draft.typographyOverlayAssetId).toBe("asset_overlay");
    expect(draft.plan).toMatchObject({ sourceArtifactId: "asset_source", plateArtifactId: "asset_plate", status: "ready" });
    expect(draft.analysis).toMatchObject({
      segmentation: { maskAssetId: "asset_mask" },
      layers: { layerAssetIds: ["asset_layer_1", "asset_layer_2"] },
    });
  });

  it("only enables final composition for a completed job with a locally saved video", async () => {
    const { canComposeFinal } = await import("@/app/vision-lab/model");

    expect(canComposeFinal({ status: "running", outputAssetId: "asset_video" })).toBe(false);
    expect(canComposeFinal({ status: "completed", outputAssetId: null })).toBe(false);
    expect(canComposeFinal({ status: "completed", outputAssetId: "asset_video" })).toBe(true);
  });

  it("reuses a pending generation attempt ID instead of creating a second Wan submission", async () => {
    const { selectGenerationAttemptId } = await import("@/app/vision-lab/model");
    let created = 0;

    expect(selectGenerationAttemptId(null, "attempt_in_flight", () => `attempt_${++created}`)).toBe("attempt_in_flight");
    expect(selectGenerationAttemptId("attempt_saved", "attempt_in_flight", () => `attempt_${++created}`)).toBe("attempt_saved");
    expect(created).toBe(0);
    expect(selectGenerationAttemptId(null, null, () => `attempt_${++created}`)).toBe("attempt_1");
  });

  it("distinguishes sidecar runtime state from registry support", async () => {
    const { canRunCapability, capabilityDisplay } = await import("@/app/vision-lab/model");

    expect(capabilityDisplay({ status: "available", runtimeStatus: { state: "ready", available: true, reason: null } })).toBe("Available");
    expect(capabilityDisplay({ status: "available", runtimeStatus: { state: "unloaded", available: true, reason: "Configured; loading on first use." } })).toBe("Loading");
    expect(canRunCapability({ status: "available", runtimeStatus: { state: "unloaded", available: true, reason: "Configured; loading on first use." } })).toBe(true);
    expect(canRunCapability({ status: "planned", runtimeStatus: { state: "ready", available: true, reason: null } })).toBe(true);
    expect(canRunCapability({ status: "available", runtimeStatus: { state: "unloaded", available: false, reason: "Not configured." } })).toBe(false);
    expect(capabilityDisplay({ status: "planned", runtimeStatus: { state: "ready", available: true, reason: null } })).toBe("Degraded");
    expect(capabilityDisplay({ status: "available", runtimeStatus: { state: "loading", available: false, reason: null } })).toBe("Loading");
    expect(capabilityDisplay({ status: "available", runtimeStatus: { state: "error", available: false, reason: "Model failed." } })).toBe("Error");
    expect(capabilityDisplay({ status: "unavailable", unavailableReason: "Reserved." })).toBe("Unavailable");
  });
});
