import { z } from "zod";

const hardwareRequirementSchema = z.object({
  cpu: z.enum(["required", "optional", "not-required"]),
  mps: z.enum(["recommended", "optional", "not-supported", "not-required"]),
  cuda: z.enum(["recommended", "optional", "not-supported", "not-required"]),
  notes: z.string().min(1).optional(),
});

const upstreamSchema = z.object({
  repository: z.string().url(),
  pinnedRef: z.string().min(1),
  codeLicense: z.string().min(1),
  modelLicense: z.string().min(1),
});

export const capabilityRuntimeStatusSchema = z.object({
  capabilityId: z.string().min(1),
  backend: z.string().min(1),
  state: z.enum(["unloaded", "loading", "ready", "error"]),
  available: z.boolean(),
  reason: z.string().min(1).nullable(),
});

export const capabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["available", "planned", "unavailable"]),
  runtime: z.enum(["python-fastapi", "ffmpeg", "reserved"]),
  provider: z.string().min(1),
  version: z.string().min(1),
  hardwareRequirements: hardwareRequirementSchema,
  inputs: z.array(z.string().min(1)).min(1),
  outputs: z.array(z.string().min(1)).min(1),
  upstream: upstreamSchema.nullable(),
  unavailableReason: z.string().min(1).nullable().optional(),
  runtimeStatus: capabilityRuntimeStatusSchema.optional(),
}).superRefine((capability, context) => {
  if (capability.status === "unavailable" && !capability.unavailableReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Unavailable capabilities require an unavailable reason." });
  }
});

export const capabilityListSchema = z.array(capabilitySchema);

export type Capability = z.infer<typeof capabilitySchema>;
export type HardwareRequirements = z.infer<typeof hardwareRequirementSchema>;
export type CapabilityRuntimeStatus = z.infer<typeof capabilityRuntimeStatusSchema>;
