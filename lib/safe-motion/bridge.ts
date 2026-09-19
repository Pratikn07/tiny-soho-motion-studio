import { buildWanCompatiblePrompt } from "./prompt";
import type { MotionPackage } from "./motion-package";

export type PreparedGenerationDraft = {
  mode: "mock";
  submitted: false;
  prompt: string;
  sourceBackgroundArtifactId: string;
  typographyOverlayArtifactId: string;
};

export class MockVisionGenerationBridge {
  prepare(pkg: MotionPackage): PreparedGenerationDraft {
    return {
      mode: "mock",
      submitted: false,
      prompt: buildWanCompatiblePrompt(pkg),
      sourceBackgroundArtifactId: pkg.sourceBackgroundArtifactId,
      typographyOverlayArtifactId: pkg.typographyOverlay.artifactId,
    };
  }
}
