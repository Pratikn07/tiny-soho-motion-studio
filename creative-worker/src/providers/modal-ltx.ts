// LTX-2.5 on Modal behind T0's VideoProvider interface (docs/tasks/P2-ltx-modal-provider.md).
//
// `submit` spawns `Ltx.generate` on the deployed Modal app `tiny-soho-ltx` and returns the Modal function call id;
// `poll` asks Modal for that call's result without waiting. Modal's JavaScript SDK can spawn a deployed class
// method and look a call up by id, so the app needs no public web endpoint. MODAL_TOKEN_ID/MODAL_TOKEN_SECRET stay
// in the worker's environment; Modal only ever receives signed URLs for the background and the take's raw.mp4.

import type { GenerationInput, ProviderPoll, VideoProvider } from "../contract.js";

export type { GenerationInput, ProviderPoll, VideoProvider };

export type ModalCallResult =
  | { state: "running" }
  | { state: "done"; value: unknown }
  | { state: "error"; kind: "timeout" | "remote" | "internal" | "not_found" };

/** The two Modal operations the provider needs, so tests can fake them. Transport errors throw (poll again later). */
export interface ModalLtxClient {
  spawn(input: GenerationInput): Promise<string>;
  result(callId: string): Promise<ModalCallResult>;
}

export const RTX_PRO_6000_USD_PER_SECOND = 0.000842; // modal.com/pricing, checked 2026-09-29. B5's catalog is the source.
const EXISTING = "existing:";
const CALL_ID = /^fc-[A-Za-z0-9]+$/;

export class ModalLtxInputError extends Error {
  constructor(readonly code: "model_unsupported_for_slide" | "ltx_input_invalid", message: string) {
    super(message);
  }
}

function checkInput(input: GenerationInput) {
  if (!input.outputUploadUrl) throw new ModalLtxInputError("ltx_input_invalid", "Modal LTX needs a signed upload URL for raw.mp4.");
  if (input.width % 64 || input.height % 64) {
    throw new ModalLtxInputError("model_unsupported_for_slide", "LTX needs a generation size in multiples of 64.");
  }
}

type Result = { ok?: boolean; reused?: boolean; errorCode?: string; gpuSeconds?: number; loadSeconds?: number | null; peakGib?: number };

const seconds = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

export function createModalLtxProvider(options: {
  client: ModalLtxClient;
  /** True when owners/{uid}/projects/{pid}/takes/{takeId}/raw.mp4 already exists (the worker checks storage). */
  outputExists?: (input: GenerationInput) => Promise<boolean>;
  usdPerGpuSecond?: number;
}): VideoProvider {
  const price = options.usdPerGpuSecond ?? RTX_PRO_6000_USD_PER_SECOND;
  return {
    id: "modal-ltx",
    async submit(input) {
      checkInput(input);
      // Fixed output path per take: a re-submit after a crash costs no new GPU call.
      if (await options.outputExists?.(input)) return { providerTaskId: `${EXISTING}${input.idempotencyKey}` };
      return { providerTaskId: await options.client.spawn(input) };
    },
    async poll(providerTaskId) {
      if (providerTaskId.startsWith(EXISTING)) return { state: "succeeded", uploaded: true, gpuSeconds: 0, costUsd: 0 };
      if (!CALL_ID.test(providerTaskId)) return { state: "failed", errorCode: "ltx_call_unknown" };
      const outcome = await options.client.result(providerTaskId);
      if (outcome.state === "running") return outcome;
      if (outcome.state === "error") return { state: "failed", errorCode: `ltx_call_${outcome.kind}` };
      const value = (outcome.value ?? {}) as Result;
      if (!value.ok) return { state: "failed", errorCode: typeof value.errorCode === "string" ? value.errorCode : "ltx_call_failed" };
      if (value.reused) return { state: "succeeded", uploaded: true, gpuSeconds: 0, costUsd: 0 };
      const gpu = seconds(value.gpuSeconds);
      // Cost includes the model load the first call of a batch paid for; idle scale-down time is O1's to allocate.
      const costUsd = Math.round((gpu + seconds(value.loadSeconds)) * price * 10_000) / 10_000;
      return { state: "succeeded", uploaded: true, gpuSeconds: gpu, costUsd, ...(typeof value.peakGib === "number" ? { peakGib: value.peakGib } : {}) };
    },
  };
}

/** Registry factory (providers/index.ts): null without a Modal token, so the router reports modal-ltx as not configured.
 * The Modal client connects on the first submit or poll, not at worker start. */
export function modalLtxProviderFromEnv(env: NodeJS.ProcessEnv): VideoProvider | null {
  const tokenId = env.MODAL_TOKEN_ID?.trim();
  const tokenSecret = env.MODAL_TOKEN_SECRET?.trim();
  if (!tokenId || !tokenSecret) return null;
  let client: Promise<ModalLtxClient> | undefined;
  const connect = () => {
    client ??= modalSdkClient({ tokenId, tokenSecret, environment: env.MODAL_ENVIRONMENT?.trim() || undefined }).catch((error) => {
      client = undefined; // Try again on the next call instead of caching a failed connection.
      throw error;
    });
    return client;
  };
  const price = Number(env.MODAL_LTX_USD_PER_GPU_SECOND);
  return createModalLtxProvider({
    client: { spawn: async (input) => (await connect()).spawn(input), result: async (id) => (await connect()).result(id) },
    ...(Number.isFinite(price) && price > 0 ? { usdPerGpuSecond: price } : {}),
  });
}

/** Modal's JS SDK (`modal` on npm), imported on first use so the worker starts without loading gRPC. */
export async function modalSdkClient(options: {
  tokenId: string;
  tokenSecret: string;
  environment?: string;
  appName?: string;
  className?: string;
}): Promise<ModalLtxClient> {
  const { ModalClient, FunctionTimeoutError, RemoteError, InternalFailure, NotFoundError } = await import("modal");
  const modal = new ModalClient({ tokenId: options.tokenId, tokenSecret: options.tokenSecret, environment: options.environment });
  const ltx = await modal.cls.fromName(options.appName ?? "tiny-soho-ltx", options.className ?? "Ltx");
  const generate = (await ltx.instance()).method("generate");
  return {
    async spawn(input) {
      const call = await generate.spawn([input]);
      return call.functionCallId;
    },
    async result(callId) {
      try {
        const call = await modal.functionCalls.fromId(callId);
        return { state: "done", value: await call.get({ timeoutMs: 0 }) };
      } catch (error) {
        // get({timeoutMs: 0}) throws "Timeout exceeded" while the call is still running; "Timeout:" means the
        // function itself hit its time limit.
        if (error instanceof FunctionTimeoutError) {
          return error.message.startsWith("Timeout exceeded") ? { state: "running" } : { state: "error", kind: "timeout" };
        }
        if (error instanceof InternalFailure) return { state: "error", kind: "internal" };
        if (error instanceof RemoteError) return { state: "error", kind: "remote" };
        if (error instanceof NotFoundError) return { state: "error", kind: "not_found" };
        throw error; // Network or auth trouble reaching Modal: not the take's fault.
      }
    },
  };
}
