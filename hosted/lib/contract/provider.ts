import { z } from "zod";

export const PROVIDER_IDS = ["modal-ltx", "alibaba"] as const;
export const providerIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const DEFAULT_FRAMES = 121;
export const DEFAULT_FPS = 24;

export const generationInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  modelId: z.string().trim().min(1).max(120),
  backgroundUrl: z.string().url(),
  outputUploadUrl: z.string().url().optional(),
  prompt: z.string().trim().min(1).max(5000),
  seed: z.number().int().min(0).max(2_147_483_647),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  frames: z.number().int().positive().max(1000),
  fps: z.number().int().positive().max(120),
  endFrame: z.object({ strength: z.number().min(0).max(1) }).optional(),
});
export type GenerationInput = z.infer<typeof generationInputSchema>;

export const providerPollSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("running") }),
  z.object({
    state: z.literal("succeeded"),
    resultUrl: z.string().url().optional(),
    uploaded: z.boolean().optional(),
    gpuSeconds: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    peakGib: z.number().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  z.object({ state: z.literal("failed"), errorCode: z.string().trim().min(1).max(120) }),
]);
export type ProviderPoll = z.infer<typeof providerPollSchema>;

/**
 * Implemented by each provider (P2: modal-ltx, P3: alibaba) and selected by B5's router.
 * `submit` must be idempotent on `input.idempotencyKey` (the take id): a repeated call for the same take
 * returns the same task and never starts a second paid generation.
 * A succeeded poll has either `uploaded: true` (the provider wrote to `outputUploadUrl`) or a `resultUrl`
 * for the worker to ingest.
 */
export interface VideoProvider {
  id: ProviderId;
  submit(input: GenerationInput): Promise<{ providerTaskId: string }>;
  poll(providerTaskId: string): Promise<ProviderPoll>;
}
