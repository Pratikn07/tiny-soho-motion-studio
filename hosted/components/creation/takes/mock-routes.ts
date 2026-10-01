import { chooseTakeRequestSchema, type RunView } from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import { CreationApiError } from "../api";
import { MOCK_ROUTES } from "../mock-api";
import { mockModels } from "../model/mock-routes";
import { isActive } from "./useRun";

/** Fixtures only: never imported by the signed-in studio. Tests can control time and run states. */
export const mockTakes = {
  runs: new Map<string, RunView>(),
  autoAdvance: true,
};
const fixtures = () => [
  contractFixtures.runCompleted.run,
  contractFixtures.runGenerating.run,
  contractFixtures.runNeedsAttention.run,
];
function current(id: string): RunView {
  const entry = mockModels.runs.find((entry) => entry.run.id === id);
  let run =
    mockTakes.runs.get(id) ??
    entry?.run ??
    fixtures().find((run) => run.id === id);
  if (!run)
    throw new CreationApiError(404, "run_not_found", "This run was not found.");
  if (entry && mockTakes.autoAdvance && isActive(run)) {
    const seconds = (Date.now() - Date.parse(run.updatedAt)) / 1000;
    const status =
      seconds < 4
        ? "queued"
        : seconds < 8
          ? "generating"
          : seconds < 12
            ? "finishing"
            : seconds < 16
              ? "checking"
              : "completed";
    const attempts = run.takes.length
      ? Math.min(run.maxAttempts, run.takes.length + 1)
      : 2;
    run = {
      ...run,
      status,
      attemptCount: status === "queued" ? run.attemptCount : attempts,
    };
    if (status === "completed")
      run = {
        ...run,
        costUsd: run.costUsd + (run.takes.length ? 0.03 : 0.06),
        takes: run.takes.length
          ? [
              ...run.takes,
              {
                ...contractFixtures.runCompleted.run.takes[1],
                id: crypto.randomUUID(),
                attempt: attempts,
                modelId: run.modelId,
                provider: run.provider,
              },
            ]
          : contractFixtures.runCompleted.run.takes.map((take) => ({
              ...take,
              id: crypto.randomUUID(),
              modelId: run!.modelId,
              provider: run!.provider,
            })),
        reasons: [],
        errorCode: null,
      };
    mockTakes.runs.set(id, run);
  }
  return run;
}
const fresh = (run: RunView) => ({
  ...structuredClone(run),
  takes: run.takes.map((take) => ({
    ...take,
    urlsExpireAt: new Date(Date.now() + 300000).toISOString(),
  })),
});
export function getMockRunningSlides() {
  return [
    ...new Set([
      ...fixtures().map((run) => run.id),
      ...mockModels.runs.map((entry) => entry.run.id),
      ...mockTakes.runs.keys(),
    ]),
  ]
    .map(current)
    .filter(isActive)
    .map((run) => ({ projectId: run.projectId, slideId: run.slideId }));
}
MOCK_ROUTES.push(
  {
    method: "GET",
    path: /^\/api\/runs\/([0-9a-f-]{36})$/,
    handle: ([, id]) => ({ run: fresh(current(id)) }),
  },
  {
    method: "GET",
    path: /^\/api\/takes\/([0-9a-f-]{36})\/run$/,
    handle: ([, id]) => {
      const run = [
        ...mockTakes.runs.values(),
        ...mockModels.runs.map((entry) => entry.run),
        ...fixtures(),
      ].find((run) => run.takes.some((take) => take.id === id));
      if (!run)
        throw new CreationApiError(
          404,
          "take_not_found",
          "This take was not found.",
        );
      return { run: fresh(run) };
    },
  },
  {
    method: "POST",
    path: /^\/api\/runs\/([0-9a-f-]{36})\/cancel$/,
    handle: ([, id]) => {
      const run = current(id);
      const next = isActive(run)
        ? { ...run, status: "canceled" as const }
        : run;
      mockTakes.runs.set(id, next);
      return { run: fresh(next) };
    },
  },
  {
    method: "POST",
    path: /^\/api\/runs\/([0-9a-f-]{36})\/retry$/,
    handle: async ([, id]) => {
      const run = current(id);
      if (isActive(run))
        throw new CreationApiError(
          409,
          "run_in_progress",
          "This slide is still being generated.",
        );
      if (mockModels.reservedUsd > 43)
        throw new CreationApiError(
          402,
          "budget_exceeded",
          contractFixtures.budgetExceeded.error.message,
        );
      const next = {
        ...run,
        status: "queued" as const,
        maxAttempts: run.maxAttempts + 1,
        updatedAt: new Date().toISOString(),
      };
      mockTakes.runs.set(id, next);
      return { run: fresh(next) };
    },
  },
  {
    method: "POST",
    path: /^\/api\/creations\/([0-9a-f-]{36})\/slides\/([0-9a-f-]{36})\/choose$/,
    handle: ([, projectId, slideId], body, context) => {
      const request = chooseTakeRequestSchema.parse(body),
        creation = context.getCreation(projectId);
      if (request.revision !== creation.revision)
        throw new CreationApiError(
          409,
          "carousel_revision_conflict",
          "This creation has changed.",
        );
      const run = [
        ...mockTakes.runs.values(),
        ...mockModels.runs.map((entry) => entry.run),
        ...fixtures(),
      ].find(
        (run) =>
          run.projectId === projectId &&
          run.slideId === slideId &&
          run.takes.some(
            (take) => take.id === request.takeId && take.finalVideoUrl,
          ),
      );
      if (!run)
        throw new CreationApiError(
          404,
          "take_not_found",
          "This take was not found.",
        );
      return context.saveDocument(projectId, {
        ...creation.document,
        slides: creation.document.slides.map((slide) =>
          slide.id === slideId
            ? { ...slide, chosenTakeId: request.takeId, latestRunId: run.id }
            : slide,
        ),
      });
    },
  },
);
