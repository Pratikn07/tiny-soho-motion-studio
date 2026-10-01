import { STATIC_CAMERA_SENTENCE, type ReviewRunView } from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import { CreationApiError } from "../api";
import { MOCK_ROUTES } from "../mock-api";

/** Test and preview controls for the mocked review. */
export const mockReview = { failReview: false, failIdea: false, calls: 0 };

const runs = new Map<string, ReviewRunView>();
const now = () => new Date().toISOString();
const slidePath = /^\/api\/creations\/([0-9a-f-]{36})\/slides\/([0-9a-f-]{36})\/(review|idea-check)$/;

/** P1's endpoints on T0's review fixtures: every slide gets the potty review; waving with the left hand needs an adjustment. */
MOCK_ROUTES.push(
  {
    method: "POST",
    path: slidePath,
    handle: async (match, body) => {
      const [, projectId, slideId, kind] = match;
      mockReview.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (kind === "review") {
        const base = contractFixtures.reviewCompleted.reviewRun;
        const run: ReviewRunView = mockReview.failReview
          ? { ...base, id: crypto.randomUUID(), projectId, slideId, status: "failed", result: null, errorCode: "review_unavailable", createdAt: now(), updatedAt: now() }
          : { ...base, id: crypto.randomUUID(), projectId, slideId, createdAt: now(), updatedAt: now() };
        runs.set(run.id, run);
        return { reviewRun: run };
      }
      if (mockReview.failIdea) throw new CreationApiError(502, "review_unavailable", "Your idea couldn't be checked right now. You can still use it as written.");
      const idea = String((body as { idea?: unknown })?.idea ?? "");
      if (/wave/i.test(idea) && !/right/i.test(idea)) {
        const adjust = contractFixtures.ideaCheckAdjust;
        return {
          ...adjust,
          result: {
            ...adjust.result,
            prompt: `A toddler girl stands on the rug and ${idea.replace(/\.$/, "")}. ${STATIC_CAMERA_SENTENCE}`,
            suggestedPrompt: `A toddler girl raises her right hand and waves twice toward the camera, then smiles. ${STATIC_CAMERA_SENTENCE}`,
          },
        };
      }
      return {
        reviewRunId: crypto.randomUUID(),
        result: { verdict: "ok", reason: "It stays clear of your text.", prompt: `A toddler girl ${idea.replace(/\.$/, "")}. ${STATIC_CAMERA_SENTENCE}` },
      };
    },
  },
  {
    method: "GET",
    path: /^\/api\/review-runs\/([0-9a-f-]{36})$/,
    handle: ([, id]) => {
      const run = runs.get(id) ?? (id === contractFixtures.reviewCompleted.reviewRun.id ? contractFixtures.reviewCompleted.reviewRun : null);
      if (!run) throw new CreationApiError(404, "review_run_not_found", "This review was not found.");
      return { reviewRun: run };
    },
  },
);
