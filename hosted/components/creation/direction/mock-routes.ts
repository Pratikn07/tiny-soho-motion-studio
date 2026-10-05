import type { DirectionRunView } from "@/lib/contract";
import { CreationApiError } from "../api";
import { MOCK_ASSET_SIZES, MOCK_ROUTES } from "../mock-api";

/**
 * Test and preview controls for the mocked motion director. A run finishes after `pollsToFinish` status checks;
 * the finished slide stands in for its clean background (the mock has no real text removal).
 */
export const mockDirection = { pollsToFinish: 2, failStart: false, failSlides: new Set<string>(), starts: 0 };

type MockRun = DirectionRunView & { projectId: string; polls: number; finished: Record<string, string> };
const runs = new Map<string, MockRun>();
const now = () => new Date().toISOString();
const publicView = ({ projectId: _p, polls: _n, finished: _f, ...view }: MockRun): DirectionRunView => view;

MOCK_ROUTES.push(
  {
    method: "POST",
    path: /^\/api\/creations\/([0-9a-f-]{36})\/direction$/,
    handle: (match, body) => {
      if (mockDirection.failStart) {
        throw new CreationApiError(503, "direction_not_configured", "The motion director is not set up yet.");
      }
      mockDirection.starts += 1;
      const input = body as { slides: Array<{ slideId: string; finishedAssetId: string }> };
      const run: MockRun = {
        id: crypto.randomUUID(),
        projectId: match[1],
        status: "running",
        sessionUrl: "https://claude.ai/code/cse_mock",
        errorCode: null,
        slides: input.slides.map(({ slideId }) => ({ slideId, status: "pending" as const })),
        createdAt: now(),
        completedAt: null,
        polls: 0,
        finished: Object.fromEntries(input.slides.map((s) => [s.slideId, s.finishedAssetId])),
      };
      runs.set(run.id, run);
      return publicView(run);
    },
  },
  {
    method: "GET",
    path: /^\/api\/creations\/([0-9a-f-]{36})\/direction\/([0-9a-f-]{36})$/,
    handle: (match, _body, context) => {
      const run = runs.get(match[2]);
      if (!run || run.projectId !== match[1]) throw new CreationApiError(404, "direction_not_found", "Direction run was not found.");
      if (run.status !== "running") return publicView(run);
      run.polls += 1;
      if (run.polls < mockDirection.pollsToFinish) return publicView(run);
      const creation = context.getCreation(run.projectId);
      const document = {
        ...creation.document,
        slides: creation.document.slides.map((slide) => {
          const assetId = run.finished[slide.id];
          if (!assetId || mockDirection.failSlides.has(slide.id)) return slide;
          const size = MOCK_ASSET_SIZES.get(assetId) ?? { width: 1122, height: 1402 };
          return {
            ...slide,
            ...size,
            layers: { backgroundAssetId: assetId, textAssetId: null },
            checks: { ok: true, items: [] },
            motion: slide.motion ?? { source: "creator" as const, story: "She looks out of the window.", prompt: "She looks out of the window." },
          };
        }),
      };
      context.saveDocument(run.projectId, document);
      run.slides = run.slides.map(({ slideId }) => mockDirection.failSlides.has(slideId)
        ? { slideId, status: "failed" as const, error: "outputs_missing" }
        : { slideId, status: "completed" as const, concept: "story", scenePrompt: "She looks out of the window." });
      const done = run.slides.filter((s) => s.status === "completed").length;
      run.status = done === run.slides.length ? "completed" : done ? "partial" : "failed";
      run.completedAt = now();
      return publicView(run);
    },
  },
);
