import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as ideaCheck } from "@/app/api/creations/[id]/slides/[slideId]/idea-check/route";
import { POST as review } from "@/app/api/creations/[id]/slides/[slideId]/review/route";
import { GET as getReviewRun } from "@/app/api/review-runs/[id]/route";
import { requireOwner } from "@/lib/auth";
import {
  STATIC_CAMERA_SENTENCE,
  ideaCheckResponseSchema,
  reviewRunResponseSchema,
  type ReviewRunRow,
} from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import { reviewImages } from "@/lib/review/images";
import { InvalidReviewReply, parseIdeaCheck, parseSlideReview, withCameraSentence } from "@/lib/review/parse";
import { PLAYBOOK_MARKDOWN } from "@/lib/review/playbook-text";
import { slideReviewRequest } from "@/lib/review/prompt";
import { reviewRunView } from "@/lib/review/repository";
import { ReviewerError, anthropicReviewer, openAiCompatibleReviewer, reviewerFromEnv, type Reviewer } from "@/lib/review/reviewers";
import { reviewSlide } from "@/lib/review/run";

const store = vi.hoisted(() => ({ rows: [] as Array<Record<string, any>>, project: null as unknown, assets: {} as Record<string, unknown>, files: {} as Record<string, Buffer> }));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  createServiceSupabaseClient: () => ({
    storage: { from: () => ({ download: async (path: string) => ({ data: new Blob([new Uint8Array(store.files[path])]), error: null }) }) },
  }),
}));
vi.mock("@/lib/repository", () => ({
  StudioRepository: class {
    getProject = async () => store.project;
    getAsset = async (id: string) => store.assets[id] ?? null;
  },
}));
vi.mock("@/lib/review/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/review/repository")>();
  class ReviewRunsRepository {
    async start(input: Record<string, any>) {
      const now = new Date().toISOString();
      const row = {
        id: crypto.randomUUID(), owner_user_id: "owner", project_id: input.projectId, slide_id: input.slideId,
        reviewer_provider: input.provider, reviewer_model: input.model, input_fingerprint: input.fingerprint,
        status: "running", result: null, creator_idea: input.creatorIdea ?? null, creator_idea_result: null,
        cost_usd: null, error_code: null, created_at: now, updated_at: now,
      };
      store.rows.push(row);
      return row;
    }
    async finish(id: string, outcome: Record<string, any>) {
      const row = store.rows.find((candidate) => candidate.id === id)!;
      Object.assign(row, {
        status: outcome.status,
        result: outcome.result ?? null,
        creator_idea_result: outcome.creatorIdeaResult ?? null,
        error_code: outcome.errorCode ?? null,
        cost_usd: outcome.costUsd ?? null,
        updated_at: new Date().toISOString(),
      });
      return row;
    }
    async get(id: string) {
      return store.rows.find((row) => row.id === id) ?? null;
    }
    async findCompletedReview(projectId: string, slideId: string, fingerprint: string) {
      return store.rows.find((row) => row.project_id === projectId && row.slide_id === slideId
        && row.input_fingerprint === fingerprint && row.status === "completed" && row.result) ?? null;
    }
  }
  return { ...original, ReviewRunsRepository };
});

const creation = contractFixtures.creation;
const potty = creation.document.slides[0];
const pottyReview = contractFixtures.reviewCompleted.reviewRun.result!;
const chat = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 500 }) => Response.json({
  choices: [{ message: { content }, finish_reason: "stop" }], usage,
});
const reviewReply = (value: unknown = pottyReview) => chat(`Here is the review:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``);
const params = { params: Promise.resolve({ id: creation.id, slideId: potty.id }) };
const post = (body?: unknown) => new Request("https://studio.test", {
  method: "POST", headers: { Authorization: "Bearer t" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const png = (width: number, height: number, alpha = 1) => sharp({
  create: { width, height, channels: 4, background: { r: 120, g: 90, b: 60, alpha } },
}).png().toBuffer();

beforeEach(async () => {
  vi.stubEnv("REVIEW_PROVIDER", "nvidia");
  vi.stubEnv("NVIDIA_API_KEY", "nvapi-test");
  vi.stubEnv("NVIDIA_VISION_MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");
  vi.mocked(requireOwner).mockResolvedValue({ userId: "owner", email: "owner@test" });
  store.rows = [];
  store.project = { id: creation.id, carousel_document: creation.document };
  store.assets = {
    [potty.layers.backgroundAssetId!]: { project_id: creation.id, kind: "background-image", object_path: "bg.png" },
    [potty.layers.textAssetId!]: { project_id: creation.id, kind: "text-layer", object_path: "text.png" },
  };
  store.files = { "bg.png": await png(60, 75), "text.png": await png(60, 75, 0.4) };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("playbook bundle", () => {
  it("matches docs/strategy/motion-agent-playbook.md (run node benchmarks/review/sync-playbook.mjs)", () => {
    expect(PLAYBOOK_MARKDOWN).toBe(readFileSync(new URL("../../docs/strategy/motion-agent-playbook.md", import.meta.url), "utf8"));
  });
});

describe("parsing reviewer replies", () => {
  it("accepts the playbook JSON inside prose, orders suggestions safest first and ends prompts with the camera sentence", () => {
    const shuffled = structuredClone(pottyReview);
    shuffled.suggestions = [shuffled.suggestions[1], shuffled.suggestions[0], shuffled.suggestions[2]];
    shuffled.suggestions[1].prompt = "She smiles. The camera remains static.";
    const parsed = parseSlideReview(`Sure!\n${JSON.stringify(shuffled)}\nThanks`);
    expect(parsed.suggestions.map((suggestion) => suggestion.risk.split(":")[0])).toEqual(["safe", "safe", "some risk"]);
    expect(parsed.suggestions[0].prompt).toBe(`She smiles. ${STATIC_CAMERA_SENTENCE}`);
    for (const suggestion of parsed.suggestions) expect(suggestion.prompt.endsWith(STATIC_CAMERA_SENTENCE)).toBe(true);
  });

  it("rejects invalid JSON and the wrong shape", () => {
    expect(() => parseSlideReview("I can't see the image")).toThrow(InvalidReviewReply);
    expect(() => parseSlideReview(JSON.stringify({ ...pottyReview, suggestions: pottyReview.suggestions.slice(0, 2) })))
      .toThrow(expect.objectContaining({ reason: "schema" }));
  });

  it("keeps the camera sentence exactly once", () => {
    const once = withCameraSentence(`She waves. ${STATIC_CAMERA_SENTENCE}`);
    expect(withCameraSentence(once)).toBe(once);
  });

  it("returns prompts for her idea and for the suggested change", () => {
    const result = parseIdeaCheck(JSON.stringify({
      verdict: "adjust", reason: "Her left hand crosses the text.", suggested_idea: "Wave with the right hand.",
      prompt: "She waves.", suggested_prompt: "She waves with her right hand.",
    }));
    expect(result).toEqual({
      verdict: "adjust", reason: "Her left hand crosses the text.", suggestedIdea: "Wave with the right hand.",
      prompt: `She waves. ${STATIC_CAMERA_SENTENCE}`, suggestedPrompt: `She waves with her right hand. ${STATIC_CAMERA_SENTENCE}`,
    });
    expect(() => parseIdeaCheck(JSON.stringify({ verdict: "adjust", reason: "x", prompt: "y" }))).toThrow(InvalidReviewReply);
  });
});

describe("retry", () => {
  const scripted = (replies: string[]): Reviewer & { calls: number } => {
    const reviewer = {
      provider: "test", model: "m", calls: 0,
      async complete() {
        reviewer.calls += 1;
        return { content: replies[reviewer.calls - 1], costUsd: 0.01 };
      },
    };
    return reviewer;
  };
  const request = slideReviewRequest({ images: [], hasText: false, slideName: "potty" });

  it("retries once on an invalid reply", async () => {
    const reviewer = scripted(["not json", JSON.stringify(pottyReview)]);
    const outcome = await reviewSlide(reviewer, request, { deadline: Date.now() + 60_000 });
    expect(outcome).toMatchObject({ attempts: 2, costUsd: 0.02 });
  });

  it("fails after a second invalid reply, and does not retry without time left", async () => {
    await expect(reviewSlide(scripted(["{}", "{}"]), request, { deadline: Date.now() + 60_000 })).rejects.toThrow(InvalidReviewReply);
    const late = scripted(["{}", JSON.stringify(pottyReview)]);
    await expect(reviewSlide(late, request, { deadline: Date.now() + 5_000 })).rejects.toThrow(InvalidReviewReply);
    expect(late.calls).toBe(1);
  });
});

describe("reviewers", () => {
  const request = slideReviewRequest({
    images: [{ label: "slide", mimeType: "image/jpeg", base64: "AAAA" }], hasText: false, slideName: "salmon-cakes",
  });

  it("sends the playbook, the images and JSON mode to NVIDIA, and costs nothing", async () => {
    const fetcher = vi.fn(async () => chat("{}"));
    const reviewer = openAiCompatibleReviewer({
      provider: "nvidia", baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "k",
      model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", fetcher,
    });
    expect(await reviewer.complete(request, AbortSignal.timeout(1000))).toEqual({ content: "{}", costUsd: 0 });
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: expect.stringContaining("# Motion agent playbook") });
    expect(body.messages[1].content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
    expect(body).toMatchObject({ response_format: { type: "json_object" }, chat_template_kwargs: { enable_thinking: false } });
  });

  it("maps provider errors to fixed codes", async () => {
    for (const [status, code] of [[401, "auth"], [429, "rate_limited"], [400, "rejected"], [500, "failed"]] as const) {
      const reviewer = openAiCompatibleReviewer({
        provider: "nvidia", baseUrl: "https://x", apiKey: "k", model: "m",
        fetcher: async () => new Response("secret body", { status }),
      });
      await expect(reviewer.complete(request, AbortSignal.timeout(1000))).rejects.toMatchObject({ code });
    }
    const timedOut = openAiCompatibleReviewer({
      provider: "nvidia", baseUrl: "https://x", apiKey: "k", model: "m",
      fetcher: async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); },
    });
    await expect(timedOut.complete(request, AbortSignal.timeout(1000))).rejects.toMatchObject({ code: "timeout" });
  });

  it("prices an API model review from token usage", async () => {
    const reviewer = anthropicReviewer({
      apiKey: "k", model: "claude-test",
      env: { REVIEW_USD_PER_MILLION_INPUT_TOKENS: "3", REVIEW_USD_PER_MILLION_OUTPUT_TOKENS: "15" },
      fetcher: async () => Response.json({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 4000, output_tokens: 1000 } }),
    });
    expect(await reviewer.complete(request, AbortSignal.timeout(1000))).toEqual({ content: "{}", costUsd: 0.027 });
  });

  it("needs a key and a model", () => {
    expect(() => reviewerFromEnv({})).toThrow(ReviewerError);
    expect(() => reviewerFromEnv({ REVIEW_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toThrow(ReviewerError);
    expect(reviewerFromEnv({ REVIEW_PROVIDER: "openai", OPENAI_API_KEY: "k", REVIEW_MODEL: "gpt-test" }).provider).toBe("openai");
  });
});

describe("review images", () => {
  it("sends background, text on grey and the finished design, at most 1600 px", async () => {
    const images = await reviewImages(await png(2000, 2500), await png(2000, 2500, 0.5));
    expect(images.map((image) => image.label)).toEqual(["background", "text layer", "finished design"]);
    const meta = await sharp(Buffer.from(images[0].base64, "base64")).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1280, 1600]);
    expect(await reviewImages(await png(40, 50), null)).toHaveLength(1);
  });
});

describe("review routes", () => {
  it("stores a completed review and reuses it for the same layers", async () => {
    const fetcher = vi.fn(async () => reviewReply());
    vi.stubGlobal("fetch", fetcher);
    const first = await review(post(), params);
    expect(first.status).toBe(201);
    const { reviewRun } = reviewRunResponseSchema.parse(await first.json());
    expect(reviewRun).toMatchObject({ status: "completed", reviewerProvider: "nvidia", slideId: potty.id });
    expect(reviewRun.result!.suggestions[0]).toMatchObject({ risk: "safe", end_strength: 0.6 });
    expect(store.rows[0].cost_usd).toBe(0);

    const again = reviewRunResponseSchema.parse(await (await review(post(), params)).json());
    expect(again.reviewRun.id).toBe(reviewRun.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await review(post({ force: true }), params);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("records a failed review when the reply stays invalid, so the creator can still type her own idea", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chat("no json here")));
    const response = await review(post(), params);
    const { reviewRun } = reviewRunResponseSchema.parse(await response.json());
    expect(reviewRun).toMatchObject({ status: "failed", errorCode: "review_unavailable", result: null });
  });

  it("returns 503 review_unavailable when no reviewer is configured", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "");
    const response = await review(post(), params);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("review_unavailable");
  });

  it("needs the slide's background", async () => {
    store.project = { id: creation.id, carousel_document: { ...creation.document, slides: [{ ...potty, width: null, height: null, layers: { backgroundAssetId: null, textAssetId: null }, checks: undefined }] } };
    const response = await review(post(), params);
    expect((await response.json()).error.code).toBe("layers_missing");
  });

  it("checks the creator's idea without replacing it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chat(JSON.stringify({
      verdict: "adjust", reason: "Her left hand crosses 'Start with the basics:'.", suggested_idea: "She waves with her right hand.",
      prompt: "She waves at the camera.", suggested_prompt: "She waves at the camera with her right hand.",
    }))));
    const response = await ideaCheck(post({ idea: "she waves at the camera" }), params);
    const body = ideaCheckResponseSchema.parse(await response.json());
    expect(body.result).toMatchObject({ verdict: "adjust", suggestedIdea: "She waves with her right hand." });
    expect(store.rows[0]).toMatchObject({ creator_idea: "she waves at the camera", status: "completed" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }));
    const failed = await ideaCheck(post({ idea: "she jumps" }), params);
    expect(failed.status).toBe(502);
    expect((await failed.json()).error.code).toBe("review_unavailable");
  });

  it("reports a review cut off by the time limit as failed", async () => {
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    const row = {
      id: crypto.randomUUID(), owner_user_id: "owner", project_id: creation.id, slide_id: potty.id,
      reviewer_provider: "nvidia", reviewer_model: "m", input_fingerprint: "a".repeat(64), status: "running",
      result: null, creator_idea: null, creator_idea_result: null, cost_usd: null, error_code: null,
      created_at: old, updated_at: old,
    } satisfies ReviewRunRow;
    store.rows.push(row);
    const response = await getReviewRun(new Request("https://studio.test", { headers: { Authorization: "Bearer t" } }), { params: Promise.resolve({ id: row.id }) });
    expect(reviewRunResponseSchema.parse(await response.json()).reviewRun).toMatchObject({ status: "failed", errorCode: "review_unavailable" });
    expect(reviewRunView({ ...row, updated_at: new Date().toISOString() }).status).toBe("running");
  });
});
