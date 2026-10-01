import { describe, expect, it, vi } from "vitest";

import { createCreationApi } from "@/components/creation/api";
import { modelClient } from "@/components/creation/model/client";
import { readRisk, reviewClient } from "@/components/creation/motion/client";
import { contractFixtures } from "@/lib/contract/fixtures";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const C = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";

describe("review and model clients over the creation API", () => {
  it("starts a review and keeps P1's suggested prompt from an idea check", async () => {
    const fetcher = vi.fn(async (path: string, _init?: RequestInit) => reply(path.endsWith("/review")
      ? contractFixtures.reviewCompleted
      : { ...contractFixtures.ideaCheckAdjust, result: { ...contractFixtures.ideaCheckAdjust.result, suggestedPrompt: "Right hand wave." } }));
    const review = reviewClient(createCreationApi({ getAccessToken: async () => "t", fetcher }));
    expect((await review.start(C, S)).result?.suggestions).toHaveLength(3);
    const check = await review.checkIdea(C, S, "she waves at the camera");
    expect(check).toMatchObject({ verdict: "adjust", suggestedPrompt: "Right hand wave.", reviewRunId: contractFixtures.ideaCheckAdjust.reviewRunId });
    expect(fetcher.mock.calls.map(([path, init]) => [init?.method, path])).toEqual([
      ["POST", `/api/creations/${C}/slides/${S}/review`],
      ["POST", `/api/creations/${C}/slides/${S}/idea-check`],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ idea: "she waves at the camera" });
  });

  it("asks for the catalog with the slide, and starts a run with the request as given", async () => {
    const fetcher = vi.fn(async (path: string, _init?: RequestInit) => reply(path.startsWith("/api/catalog") ? contractFixtures.catalog : contractFixtures.runGenerating, path.endsWith("/runs") ? 201 : 200));
    const models = modelClient(createCreationApi({ getAccessToken: async () => "t", fetcher }));
    expect((await models.catalog(C, S)).defaultModelId).toBe("ltx-2.5-distilled");
    expect(fetcher.mock.calls[0][0]).toBe(`/api/catalog?creationId=${C}&slideId=${S}`);
    const request = { idempotencyKey: "33333333-3333-4333-8333-333333333333", modelId: "ltx-2.5-distilled", seeds: 2,
      motion: { source: "creator" as const, story: "She smiles.", prompt: "She smiles. The camera remains static.", motionStyle: "calm" as const } };
    await models.startRun(C, S, request);
    expect(fetcher.mock.calls[1][0]).toBe(`/api/creations/${C}/slides/${S}/runs`);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(request);
  });

  it("reads risk labels", () => {
    expect(readRisk("safe")).toEqual({ level: "safe", reason: null });
    expect(readRisk("some risk: may lean toward 'basics:'")).toEqual({ level: "some risk", reason: "may lean toward 'basics:'" });
  });
});
