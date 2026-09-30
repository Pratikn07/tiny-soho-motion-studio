import { z } from "zod";

import { TEXT_ANIMATION_STYLES, textAnimationSchema } from "./creation";

/** Provisional pass limits, calibrated on few clips (playbook, step 6). P5 keeps per-model overrides in config. */
export const CHECK_THRESHOLDS = {
  cameraDrift: 12,
  behindTextPercent: 9,
  loopDifference: 5,
  textDrift: 3,
} as const;

export const takeChecksSchema = z.object({
  cameraDrift: z.number().nonnegative(),
  behindTextPercent: z.number().min(0).max(100),
  behindTextLine: z.number().int().positive().optional(),
  behindTextAtSeconds: z.number().nonnegative().optional(),
  loopDifference: z.number().nonnegative(),
  textDrift: z.number().nonnegative().optional(),
  reasons: z.array(z.string().trim().min(1).max(300)).max(10),
});
export type TakeChecks = z.infer<typeof takeChecksSchema>;

export const TAKE_VERDICTS = ["pending", "accepted", "rejected"] as const;
export const takeVerdictSchema = z.enum(TAKE_VERDICTS);
export type TakeVerdict = z.infer<typeof takeVerdictSchema>;

export const VISION_OPERATIONS_V2 = ["finish", "check"] as const;

/** `creative_studio_vision_jobs.options` for `operation = 'finish'` (P4). */
export const finishJobOptionsSchema = z.object({
  takeId: z.string().uuid(),
  backgroundAssetId: z.string().uuid(),
  textAssetId: z.string().uuid().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  textAnimation: textAnimationSchema.optional(),
});
export type FinishJobOptions = z.infer<typeof finishJobOptionsSchema>;

/** `creative_studio_vision_jobs.result` for a completed `finish` job. */
export const finishJobResultSchema = z.object({
  lines: z.number().int().min(0),
  textInBy: z.number().nonnegative(),
  step: z.number().nonnegative(),
  colourGains: z.tuple([z.number(), z.number(), z.number()]),
  style: z.enum(TEXT_ANIMATION_STYLES),
  coverFrame: z.enum(["first", "last"]),
});
export type FinishJobResult = z.infer<typeof finishJobResultSchema>;

/** `creative_studio_vision_jobs.options` for `operation = 'check'` (P5). Source asset is the raw clip. */
export const checkJobOptionsSchema = z.object({
  takeId: z.string().uuid(),
  rawAssetId: z.string().uuid(),
  finalAssetId: z.string().uuid(),
  textAssetId: z.string().uuid().nullable(),
  modelId: z.string().trim().min(1).max(120),
  endFramePinned: z.boolean(),
});
export type CheckJobOptions = z.infer<typeof checkJobOptionsSchema>;

/** `creative_studio_vision_jobs.result` for a completed `check` job. */
export const checkJobResultSchema = z.object({
  checks: takeChecksSchema,
  verdict: z.enum(["accepted", "rejected"]),
});
export type CheckJobResult = z.infer<typeof checkJobResultSchema>;
