import type { ReviewRequest } from "./prompt";

export type ReviewReply = { content: string; costUsd: number | null };

/** One vision model behind a provider-neutral call. Errors carry a fixed code, never the provider's body. */
export interface Reviewer {
  provider: string;
  model: string;
  complete(request: ReviewRequest, signal: AbortSignal): Promise<ReviewReply>;
}

export class ReviewerError extends Error {
  constructor(readonly code: "not_configured" | "auth" | "rate_limited" | "rejected" | "failed" | "timeout" | "unavailable") {
    super(`reviewer_${code}`);
    this.name = "ReviewerError";
  }
}

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
type Sleep = (ms: number, signal?: AbortSignal | null) => Promise<void>;

/** Waits after each 503 before trying again; after the last one the review is reported unavailable. */
export const UNAVAILABLE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

const statusError = (status: number) => new ReviewerError(
  status === 401 || status === 403 ? "auth"
    : status === 429 ? "rate_limited"
      : status === 503 ? "unavailable"
        : status >= 400 && status < 500 ? "rejected" : "failed",
);

const sleep: Sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new ReviewerError("timeout"));
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new ReviewerError("timeout"));
  }, { once: true });
});

async function send(fetcher: Fetch, url: string, init: RequestInit, wait: Sleep = sleep) {
  let response: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetcher(url, init);
    } catch (error) {
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new ReviewerError("timeout");
      throw new ReviewerError("failed");
    }
    if (response.status !== 503 || attempt >= UNAVAILABLE_RETRY_DELAYS_MS.length) break;
    await wait(UNAVAILABLE_RETRY_DELAYS_MS[attempt], init.signal);
  }
  if (!response.ok) throw statusError(response.status);
  const raw = await response.text();
  if (raw.length > 200_000) throw new ReviewerError("failed");
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    throw new ReviewerError("failed");
  }
}

const tokenCost = (inputTokens: unknown, outputTokens: unknown, env: Env) => {
  const inputPrice = Number(env.REVIEW_USD_PER_MILLION_INPUT_TOKENS);
  const outputPrice = Number(env.REVIEW_USD_PER_MILLION_OUTPUT_TOKENS);
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number" || !inputPrice || !outputPrice) return null;
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
};

/** NVIDIA Build (free) and other OpenAI-compatible chat APIs. */
export function openAiCompatibleReviewer(options: {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  env?: Env;
  fetcher?: Fetch;
  sleep?: Sleep;
}): Reviewer {
  const nemotron = /nemotron/i.test(options.model);
  return {
    provider: options.provider,
    model: options.model,
    async complete(request, signal) {
      const body = await send(options.fetcher ?? fetch, `${options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model: options.model,
          temperature: 0.2,
          max_tokens: 3000,
          response_format: { type: "json_object" },
          ...(nemotron ? { chat_template_kwargs: { enable_thinking: false } } : {}),
          stream: false,
          messages: [
            { role: "system", content: request.system },
            {
              role: "user",
              content: [
                ...request.images.map((image) => ({
                  type: "image_url",
                  image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
                })),
                { type: "text", text: request.text },
              ],
            },
          ],
        }),
      }, options.sleep);
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new ReviewerError("failed");
      return { content, costUsd: options.provider === "nvidia" ? 0 : tokenCost(body.usage?.prompt_tokens, body.usage?.completion_tokens, options.env ?? {}) };
    },
  };
}

/** Anthropic's Messages API. */
export function anthropicReviewer(options: { apiKey: string; model: string; env?: Env; fetcher?: Fetch; sleep?: Sleep }): Reviewer {
  return {
    provider: "anthropic",
    model: options.model,
    async complete(request, signal) {
      const body = await send(options.fetcher ?? fetch, "https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model: options.model,
          max_tokens: 3000,
          temperature: 0.2,
          system: request.system,
          messages: [
            {
              role: "user",
              content: [
                ...request.images.map((image) => ({
                  type: "image",
                  source: { type: "base64", media_type: image.mimeType, data: image.base64 },
                })),
                { type: "text", text: request.text },
              ],
            },
          ],
        }),
      }, options.sleep);
      const text = Array.isArray(body.content)
        ? body.content.filter((part: { type?: string }) => part.type === "text").map((part: { text: string }) => part.text).join("")
        : null;
      if (typeof text !== "string" || !text) throw new ReviewerError("failed");
      return { content: text, costUsd: tokenCost(body.usage?.input_tokens, body.usage?.output_tokens, options.env ?? {}) };
    },
  };
}

/**
 * `REVIEW_PROVIDER` picks the reviewer: `nvidia` (default; NVIDIA_API_KEY, REVIEW_MODEL or NVIDIA_VISION_MODEL),
 * `openai` (OPENAI_API_KEY, REVIEW_MODEL, optional REVIEW_BASE_URL for another OpenAI-compatible API) or
 * `anthropic` (ANTHROPIC_API_KEY, REVIEW_MODEL). Keys stay server-side.
 */
export function reviewerFromEnv(env: Env = process.env, fetcher?: Fetch): Reviewer {
  const provider = env.REVIEW_PROVIDER?.trim() || "nvidia";
  const model = env.REVIEW_MODEL?.trim();
  if (provider === "nvidia" && env.NVIDIA_API_KEY && (model || env.NVIDIA_VISION_MODEL)) {
    return openAiCompatibleReviewer({
      provider, baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: env.NVIDIA_API_KEY,
      model: model || env.NVIDIA_VISION_MODEL!, env, fetcher,
    });
  }
  if (provider === "openai" && env.OPENAI_API_KEY && model) {
    const baseUrl = env.REVIEW_BASE_URL?.trim() || "https://api.openai.com/v1";
    return openAiCompatibleReviewer({ provider, baseUrl, apiKey: env.OPENAI_API_KEY, model, env, fetcher });
  }
  if (provider === "anthropic" && env.ANTHROPIC_API_KEY && model) {
    return anthropicReviewer({ apiKey: env.ANTHROPIC_API_KEY, model, env, fetcher });
  }
  throw new ReviewerError("not_configured");
}
