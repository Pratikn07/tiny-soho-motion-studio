import manifest from "./manifest.json";
import { capabilityListSchema, type Capability } from "./schema";

const capabilities = capabilityListSchema.parse(manifest);

export function listCapabilities(): Capability[] {
  return capabilities.map((capability) => ({ ...capability, inputs: [...capability.inputs], outputs: [...capability.outputs] }));
}

export function getCapability(id: string): Capability | null {
  const capability = capabilities.find((candidate) => candidate.id === id);
  return capability ? { ...capability, inputs: [...capability.inputs], outputs: [...capability.outputs] } : null;
}

export { capabilityListSchema, capabilitySchema, type Capability, type HardwareRequirements } from "./schema";
