import { boundsIntersect, isInsideCanvas, sweptBounds as calculateSweptBounds } from "./collision";
import { segmentationBoundsFromMasks } from "./masks";
import type { CameraMotion, MotionCollision, MotionVector, SafeMotionInput, SafeMotionPlan } from "./schema";
import { typographyLayerPolicy } from "./typography";
import { validateSafeMotionInput } from "./validation";

const REDUCTION_SCALES = [1, 0.75, 0.5, 0.25, 0] as const;

export function sweptBounds(subject: SafeMotionInput["subject"]["bounds"], motion: MotionVector) {
  return calculateSweptBounds(subject, motion);
}

export function createSafeMotionPlan(input: unknown): SafeMotionPlan {
  const parsed = validateSafeMotionInput(input);
  const initialCollisions = findCollisions(
    parsed,
    { subject: { x: 0, y: 0 }, camera: { x: 0, y: 0, zoom: 0, type: "static-subject" } },
    "initial",
  );
  const initialTypographyCollisions = initialCollisions.filter((collision) => collision.kind === "typography");
  if (initialTypographyCollisions.length > 0 && parsed.subjectLayerMode !== "behind-fixed-overlay") {
    return rejectedPlan(parsed, initialCollisions, "The source subject already overlaps protected typography without an explicit behind-overlay mode.");
  }
  if (initialTypographyCollisions.length > 0 && hasMotion(parsed.requested)) {
    return rejectedPlan(parsed, initialCollisions, "An initially overlapping subject must remain stationary behind the fixed typography overlay.");
  }
  if (initialTypographyCollisions.length > 0) {
    return {
      ...basePlan(parsed),
      status: "ready",
      final: parsed.requested,
      camera: parsed.requested.camera,
      collisions: initialCollisions,
      warnings: baseWarnings(parsed, true),
      corrections: [],
    };
  }

  const requestedCollisions = findCollisions(parsed, parsed.requested, "requested");
  if (requestedCollisions.length === 0) return {
    ...basePlan(parsed),
    status: "ready",
    final: parsed.requested,
    camera: parsed.requested.camera,
    collisions: [],
    warnings: baseWarnings(parsed, initialTypographyCollisions.length > 0),
    corrections: [],
  };

  for (const scale of REDUCTION_SCALES.slice(1)) {
    const candidateSubject = scaleMotion(parsed.requested.subject, scale);
    const candidateCamera = scaleCamera(parsed.requested.camera, scale);
    const candidate = { subject: candidateSubject, camera: candidateCamera };
    const collisions = findCollisions(parsed, candidate, "candidate");
    if (collisions.length === 0) {
      return {
        ...basePlan(parsed),
        status: "reduced",
        final: candidate,
        camera: candidateCamera,
        collisions: requestedCollisions,
        warnings: [...baseWarnings(parsed, false), "Subject motion was reduced to avoid typography.", "Motion was reduced to keep typography fixed and protected."],
        corrections: [{ subjectScale: scale, cameraScale: scale }],
      };
    }
  }
  return rejectedPlan(parsed, requestedCollisions, "The requested subject motion cannot avoid protected regions.");
}

function findCollisions(input: SafeMotionInput, motion: SafeMotionInput["requested"], phase: MotionCollision["phase"]): MotionCollision[] {
  const effectiveMotion = { x: motion.subject.x + motion.camera.x, y: motion.subject.y + motion.camera.y };
  const envelope = cameraSweptBounds(input.subject.bounds, effectiveMotion, motion.camera.zoom);
  const collisions: MotionCollision[] = [];
  const target = cameraTargetBounds(input.subject.bounds, effectiveMotion, motion.camera.zoom);
  if (!isInsideCanvas(target)) collisions.push({ kind: "canvas", id: "canvas", phase, bounds: target });
  if (input.typography.length > 0 && cameraExposesOverlayEdge(motion.camera, input.collisionPadding)) {
    collisions.push({ kind: "camera-edge", id: "fixed-overlay-edge", phase, bounds: target });
  }
  for (const region of input.typography) {
    if (boundsIntersect(envelope, region.bounds, input.collisionPadding)) collisions.push({ kind: "typography", id: region.id, phase, bounds: region.bounds });
  }
  for (const [index, bounds] of segmentationBoundsFromMasks(input.segmentationBounds).entries()) {
    if (boundsIntersect(envelope, bounds, input.collisionPadding)) collisions.push({ kind: "segmentation", id: `segment-${index}`, phase, bounds });
  }
  return collisions;
}

function scaleMotion(motion: MotionVector, scale: number): MotionVector {
  return { x: motion.x * scale, y: motion.y * scale };
}

function scaleCamera(camera: CameraMotion, scale: number): CameraMotion {
  return { ...camera, x: camera.x * scale, y: camera.y * scale, zoom: camera.zoom * scale };
}

function cameraTargetBounds(bounds: SafeMotionInput["subject"]["bounds"], motion: MotionVector, zoom: number) {
  const scale = 1 + zoom;
  return {
    x: 0.5 + ((bounds.x + motion.x) - 0.5) * scale,
    y: 0.5 + ((bounds.y + motion.y) - 0.5) * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  };
}

function cameraSweptBounds(bounds: SafeMotionInput["subject"]["bounds"], motion: MotionVector, zoom: number) {
  const target = cameraTargetBounds(bounds, motion, zoom);
  return {
    x: Math.min(bounds.x, target.x),
    y: Math.min(bounds.y, target.y),
    width: Math.max(bounds.x + bounds.width, target.x + target.width) - Math.min(bounds.x, target.x),
    height: Math.max(bounds.y + bounds.height, target.y + target.height) - Math.min(bounds.y, target.y),
  };
}

function cameraExposesOverlayEdge(camera: CameraMotion, padding: number): boolean {
  const tolerance = Math.max(0.02, padding);
  return Math.abs(camera.x) > tolerance || Math.abs(camera.y) > tolerance || Math.abs(camera.zoom) > tolerance;
}

function hasMotion(requested: SafeMotionInput["requested"]): boolean {
  return requested.subject.x !== 0 || requested.subject.y !== 0 || requested.camera.x !== 0 || requested.camera.y !== 0 || requested.camera.zoom !== 0;
}

function baseWarnings(input: SafeMotionInput, subjectBehindOverlay: boolean): string[] {
  const warnings = [];
  if (input.typography.length === 0 && !input.noTypographyConfirmed) {
    warnings.push("No typography was detected; review or explicitly confirm that this image has no protected text.");
  }
  if (subjectBehindOverlay) warnings.push("The subject remains stationary behind the fixed typography overlay.");
  return warnings;
}

function basePlan(input: SafeMotionInput): Omit<SafeMotionPlan, "status" | "final" | "camera" | "collisions" | "warnings" | "corrections"> {
  return {
    version: "2",
    sourceArtifactId: input.sourceArtifactId,
    plateArtifactId: input.plateArtifactId,
    plateMode: input.plateMode,
    subject: input.subject,
    subjects: [input.subject],
    typographyRegions: input.typography,
    typography: typographyLayerPolicy(),
    textPolicy: { keepOverlayFixed: true, preventSubjectTextOverlap: true, subjectLayerMode: input.subjectLayerMode },
    requested: input.requested,
    provenance: { planner: "SafeMotionPlan", version: "2", collisionPadding: input.collisionPadding, noTypographyConfirmed: input.noTypographyConfirmed },
  };
}

function rejectedPlan(input: SafeMotionInput, collisions: MotionCollision[], warning: string): SafeMotionPlan {
  return {
    ...basePlan(input),
    status: "rejected",
    final: null,
    camera: null,
    collisions,
    warnings: [...baseWarnings(input, false), warning],
    corrections: [],
  };
}
