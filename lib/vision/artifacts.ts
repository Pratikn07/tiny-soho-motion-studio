import { z } from "zod";

export const visionArtifactIdSchema = z.string().uuid();

export function parseVisionArtifactId(value: string): string | null {
  const parsed = visionArtifactIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
