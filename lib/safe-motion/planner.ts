import { boundsIntersect, isInsideCanvas, sweptBounds as calculateSweptBounds, translatedBounds } from "./collision";
import { segmentationBoundsFromMasks } from "./masks";
import type { MotionCollision, MotionVector, SafeMotionInput, SafeMotionPlan } from "./schema";
import { typographyLayerPolicy } from "./typography";
import { validateSafeMotionInput } from "./validation";

const REDUCTION_SCALES = [1, 0.75, 0.5, 0.25, 0] as const;

export function sweptBounds(subject: SafeMotionInput["subject"]["bounds"], motion: MotionVector) {
  return calculateSweptBounds(subject, motion);
}

export function createSafeMotionPlan(input: unknown): SafeMotionPlan {
  const parsed = validateSafeMotionInput(input);
  const initialCollisions = findCollisions(parsed, { x: 0, y: 0 }, "initial");
  if (initialCollisions.length > 0) return rejectedPlan(parsed, initialCollisions, "The source subject already overlaps a protected region.");

  const requestedCollisions = findCollisions(parsed, parsed.requested.subject, "requested");
  if (requestedCollisions.length === 0) return {
    status: "ready",
    subject: parsed.subject,
    typography: typographyLayerPolicy(),
    requested: parsed.requested,
    final: parsed.requested,
    collisions: [],
    warnings: [],
    corrections: [],
  };

  for (const scale of REDUCTION_SCALES.slice(1)) {
    const candidateSubject = scaleMotion(parsed.requested.subject, scale);
    const collisions = findCollisions(parsed, candidateSubject, "candidate");
    if (collisions.length === 0) {
      return {
        status: "reduced",
        subject: parsed.subject,
        typography: typographyLayerPolicy(),
        requested: parsed.requested,
        final: { subject: candidateSubject, camera: parsed.requested.camera },
        collisions: requestedCollisions,
        warnings: ["Subject motion was reduced to avoid typography."],
        corrections: [{ subjectScale: scale }],
      };
    }
  }
  return rejectedPlan(parsed, requestedCollisions, "The requested subject motion cannot avoid protected regions.");
}

function findCollisions(input: SafeMotionInput, subjectMotion: MotionVector, phase: MotionCollision["phase"]): MotionCollision[] {
  const envelope = calculateSweptBounds(input.subject.bounds, subjectMotion);
  const collisions: MotionCollision[] = [];
  const target = translatedBounds(input.subject.bounds, subjectMotion);
  if (!isInsideCanvas(target)) collisions.push({ kind: "canvas", id: "canvas", phase, bounds: target });
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

function rejectedPlan(input: SafeMotionInput, collisions: MotionCollision[], warning: string): SafeMotionPlan {
  return {
    status: "rejected",
    subject: input.subject,
    typography: typographyLayerPolicy(),
    requested: input.requested,
    final: null,
    collisions,
    warnings: [warning],
    corrections: [],
  };
}
