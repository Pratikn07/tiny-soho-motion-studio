import type { MotionVector, NormalizedBounds } from "./schema";

export function translatedBounds(bounds: NormalizedBounds, motion: MotionVector): NormalizedBounds {
  return { ...bounds, x: bounds.x + motion.x, y: bounds.y + motion.y };
}

export function sweptBounds(bounds: NormalizedBounds, motion: MotionVector): NormalizedBounds {
  const target = translatedBounds(bounds, motion);
  const x = Math.min(bounds.x, target.x);
  const y = Math.min(bounds.y, target.y);
  return {
    x,
    y,
    width: Math.max(bounds.x + bounds.width, target.x + target.width) - x,
    height: Math.max(bounds.y + bounds.height, target.y + target.height) - y,
  };
}

export function boundsIntersect(left: NormalizedBounds, right: NormalizedBounds, padding = 0): boolean {
  return left.x < right.x + right.width + padding
    && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding
    && left.y + left.height + padding > right.y;
}

export function isInsideCanvas(bounds: NormalizedBounds): boolean {
  return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1;
}
