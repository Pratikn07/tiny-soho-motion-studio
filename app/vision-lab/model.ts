export type VisionLabState = "idle" | "validating" | "loading-model" | "processing" | "success" | "unavailable" | "error";

export function stateFromResponse(status: number): VisionLabState {
  if (status >= 200 && status < 300) return "success";
  if (status === 503) return "unavailable";
  return "error";
}

export function planJson(plan: unknown): string {
  return JSON.stringify(plan, null, 2);
}
