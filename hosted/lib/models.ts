export const modelIds = ["wan2.7-i2v", "wan3-video"] as const;
export type HostedModelId = (typeof modelIds)[number];

export type HostedModel = {
  id: HostedModelId;
  providerModel: string;
  duration: { min: number; max: number; defaultValue: number };
  resolutions: readonly string[];
  aspectRatios?: readonly string[];
};

const models: Record<HostedModelId, HostedModel> = {
  "wan2.7-i2v": {
    id: "wan2.7-i2v",
    providerModel: "wan2.7-i2v-2026-04-25",
    duration: { min: 2, max: 15, defaultValue: 5 },
    resolutions: ["720P", "1080P"],
  },
  "wan3-video": {
    id: "wan3-video",
    providerModel: "wan3.0-video",
    duration: { min: 2, max: 30, defaultValue: 5 },
    resolutions: ["480P", "720P", "1080P"],
    aspectRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  },
};

export function getHostedModel(modelId: string): HostedModel | null {
  return models[modelId as HostedModelId] ?? null;
}
