import { z } from "zod";

const upstreamDependencySchema = z.object({
  capability: z.string().min(1),
  name: z.string().min(1),
  upstreamRepository: z.string().url(),
  pinnedCommit: z.string().regex(/^[a-f0-9]{7,64}$/i),
  packageVersion: z.string().min(1),
  codeLicense: z.string().min(1),
  checkpointIdentifier: z.string().min(1),
  checkpointSource: z.string().url(),
  checkpointLicense: z.string().min(1),
  checkpointSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  testedPython: z.string().min(1).optional(),
  testedDevice: z.string().min(1).optional(),
  status: z.string().min(1),
});

export const upstreamProvenanceSchema = z.object({
  verifiedAt: z.string().date(),
  dependencies: z.array(upstreamDependencySchema).min(1),
});

export type UpstreamProvenance = z.infer<typeof upstreamProvenanceSchema>;

export function parseUpstreamProvenance(value: unknown): UpstreamProvenance {
  return upstreamProvenanceSchema.parse(value);
}

const modelArtifactPath = /\.(?:bin|ckpt|onnx|pdiparams|pt|pth|safetensors)$/i;

export function findTrackedModelArtifacts(paths: readonly string[]): string[] {
  return paths.filter((path) => modelArtifactPath.test(path));
}
