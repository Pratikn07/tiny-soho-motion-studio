import type { NormalizedBounds } from "./schema";

export function segmentationBoundsFromMasks(bounds: readonly NormalizedBounds[]): NormalizedBounds[] {
  return bounds.map((value) => ({ ...value }));
}
