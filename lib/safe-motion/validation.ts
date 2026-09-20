import { safeMotionInputSchema, type SafeMotionInput } from "./schema";

export function validateSafeMotionInput(input: unknown): SafeMotionInput {
  return safeMotionInputSchema.parse(input);
}
