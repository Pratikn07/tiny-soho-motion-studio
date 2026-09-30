import { describe, expect, it } from "vitest";

import * as hosted from "@/lib/contract";
import * as worker from "../../creative-worker/src/contract";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const same = <A, B>(value: Equal<A, B>) => value;

// Compile-time: `npm --prefix hosted run check` fails if the worker mirror drifts from the contract.
same<worker.GenerationInput, hosted.GenerationInput>(true);
same<worker.ProviderPoll, hosted.ProviderPoll>(true);
same<worker.ProviderId, hosted.ProviderId>(true);
same<worker.TakeChecks, hosted.TakeChecks>(true);
same<worker.TextAnimation, hosted.TextAnimation>(true);
same<worker.RunSettings, hosted.RunSettings>(true);
same<worker.FinishJobOptions, hosted.FinishJobOptions>(true);
same<worker.FinishJobResult, hosted.FinishJobResult>(true);
same<worker.CheckJobOptions, hosted.CheckJobOptions>(true);
same<worker.CheckJobResult, hosted.CheckJobResult>(true);
same<worker.PipelineRunRow, hosted.PipelineRunRow>(true);
same<worker.TakeRow, hosted.TakeRow>(true);
same<worker.SpendRow, hosted.SpendRow>(true);
same<worker.PipelineRunStatus, hosted.PipelineRunStatus>(true);
same<worker.TakeStage, hosted.TakeStage>(true);
same<worker.TakeVerdict, hosted.TakeVerdict>(true);
same<worker.MotionStyle, hosted.MotionStyle>(true);
same<Parameters<worker.VideoProvider["submit"]>, Parameters<hosted.VideoProvider["submit"]>>(true);
same<Awaited<ReturnType<worker.VideoProvider["poll"]>>, Awaited<ReturnType<hosted.VideoProvider["poll"]>>>(true);

describe("worker contract mirror", () => {
  it("has the same constants as the hosted contract", () => {
    expect(worker.PROVIDER_IDS).toEqual(hosted.PROVIDER_IDS);
    expect(worker.JOB_STATUSES).toEqual(hosted.JOB_STATUSES);
    expect(worker.JOB_EVENT_TYPES).toEqual(hosted.JOB_EVENT_TYPES);
    expect(worker.PIPELINE_RUN_STATUSES).toEqual(hosted.PIPELINE_RUN_STATUSES);
    expect(worker.ACTIVE_PIPELINE_RUN_STATUSES).toEqual(hosted.ACTIVE_PIPELINE_RUN_STATUSES);
    expect(worker.TAKE_STAGES).toEqual(hosted.TAKE_STAGES);
    expect(worker.TAKE_VERDICTS).toEqual(hosted.TAKE_VERDICTS);
    expect(worker.CHECK_THRESHOLDS).toEqual(hosted.CHECK_THRESHOLDS);
    expect([worker.DEFAULT_FRAMES, worker.DEFAULT_FPS]).toEqual([hosted.DEFAULT_FRAMES, hosted.DEFAULT_FPS]);
    expect([worker.DEFAULT_SEEDS_PLANNED, worker.DEFAULT_MAX_ATTEMPTS]).toEqual([
      hosted.DEFAULT_SEEDS_PLANNED,
      hosted.DEFAULT_MAX_ATTEMPTS,
    ]);
  });

  it("accepts the hosted fixtures as worker types", () => {
    const poll: worker.ProviderPoll = hosted.providerPollSchema.parse({ state: "running" });
    expect(poll.state).toBe("running");
  });
});
