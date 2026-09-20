import { describe, expect, it } from "vitest";
import { findTrackedModelArtifacts, parseUpstreamProvenance } from "@/lib/capabilities/provenance";

describe("Vision upstream provenance", () => {
  it("requires separate code and checkpoint licensing for every declared optional runtime", () => {
    const provenance = parseUpstreamProvenance({
      verifiedAt: "2026-09-20",
      dependencies: [{
        capability: "image.ocr",
        name: "PaddleOCR",
        upstreamRepository: "https://github.com/PaddlePaddle/PaddleOCR",
        pinnedCommit: "dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf",
        packageVersion: "3.7.0",
        codeLicense: "Apache-2.0",
        checkpointIdentifier: "PP-OCRv5_mobile_det",
        checkpointSource: "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det",
        checkpointLicense: "Apache-2.0",
        status: "explicit-provisioning-required",
      }],
    });

    expect(provenance.dependencies[0]).toMatchObject({
      capability: "image.ocr",
      codeLicense: "Apache-2.0",
      checkpointLicense: "Apache-2.0",
    });
    expect(() => parseUpstreamProvenance({
      verifiedAt: "2026-09-20",
      dependencies: [{
        capability: "image.ocr",
        name: "PaddleOCR",
        upstreamRepository: "https://github.com/PaddlePaddle/PaddleOCR",
        pinnedCommit: "dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf",
        packageVersion: "3.7.0",
        codeLicense: "Apache-2.0",
        checkpointIdentifier: "PP-OCRv5_mobile_det",
        checkpointSource: "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det",
        status: "explicit-provisioning-required",
      }],
    })).toThrow(/checkpointLicense/i);
  });

  it("blocks tracked model and checkpoint artifacts while allowing small media fixtures", () => {
    expect(findTrackedModelArtifacts([
      "tests/fixtures/vision/parenting-carousel.png",
      "docs/assets/demo.mp4",
      "app/api/models/route.ts",
      "models/sam2.1_hiera_tiny.pt",
      "services/vision/checkpoints/layers.safetensors",
      "weights/model.onnx",
    ])).toEqual([
      "models/sam2.1_hiera_tiny.pt",
      "services/vision/checkpoints/layers.safetensors",
      "weights/model.onnx",
    ]);
  });
});
