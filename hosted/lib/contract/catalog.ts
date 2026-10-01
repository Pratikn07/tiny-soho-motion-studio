import { z } from "zod";

import { providerIdSchema } from "./provider";

export const DEFAULT_MODEL_ID = "ltx-2.5-distilled";

export const catalogModelSchema = z.object({
  id: z.string().trim().min(1).max(120),
  provider: providerIdSchema,
  providerModel: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  pricing: z.object({
    unit: z.enum(["gpu_second", "video_second"]),
    usd: z.number().positive(),
    source: z.string().trim().min(1).max(300),
    checkedAt: z.string().date(),
  }),
  estimatedClipUsd: z.number().positive(),
  supports: z.object({
    endFrame: z.boolean(),
    seeds: z.boolean(),
    sizes: z.union([z.literal("multiple-of-64"), z.array(z.string().regex(/^\d+x\d+$/)).min(1)]),
    durationsSeconds: z.array(z.number().positive()).min(1),
  }),
  promptProfile: z.enum(["ltx", "wan"]),
  calibrated: z.boolean(),
  enabled: z.boolean(),
  requiresBillingAck: z.boolean(),
});
export type CatalogModel = z.infer<typeof catalogModelSchema>;

/** One model in `GET /api/catalog`, with the owner's acknowledgement and, given `?slideId=`, its fit for that slide. */
export const catalogModelViewSchema = catalogModelSchema.extend({
  isDefault: z.boolean(),
  billingAcknowledged: z.boolean(),
  fit: z
    .object({
      ok: z.boolean(),
      reason: z.string().trim().min(1).max(300).optional(),
    })
    .refine((fit) => fit.ok || fit.reason !== undefined, "A model that does not fit says why.")
    .optional(),
});
export type CatalogModelView = z.infer<typeof catalogModelViewSchema>;

export const catalogResponseSchema = z
  .object({
    defaultModelId: z.string().trim().min(1).max(120),
    models: z.array(catalogModelViewSchema).min(1),
  })
  .refine(
    (catalog) => catalog.models.filter((model) => model.isDefault).length === 1
      && catalog.models.some((model) => model.isDefault && model.id === catalog.defaultModelId),
    "Exactly one model is the default and it matches defaultModelId.",
  );
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
