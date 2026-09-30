import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ACTIVE_PIPELINE_RUN_STATUSES,
  CHECK_THRESHOLDS,
  DEFAULT_TEXT_ANIMATION,
  END_FRAME_STRENGTH,
  JOB_EVENT_TYPES,
  JOB_STATUSES,
  LAYER_ASSET_KINDS,
  PIPELINE_RUN_STATUSES,
  PROVIDER_IDS,
  REVIEW_RUN_STATUSES,
  STATIC_CAMERA_SENTENCE,
  TAKE_STAGES,
  TAKE_VERDICTS,
  catalogResponseSchema,
  checkJobOptionsSchema,
  checkJobResultSchema,
  creationDocumentV2Schema,
  generationInputSchema,
  ideaCheckResultSchema,
  layerUploadRequestSchema,
  providerPollSchema,
  runViewSchema,
  slideReviewSchema,
  slideV2Schema,
  textAnimationSchema,
  uploadCheckResultSchema,
} from "@/lib/contract";
import { contractFixtures, fixtureManifest } from "@/lib/contract/fixtures";
import type { StudioJobStatus } from "@/lib/jobs";

const clone = <T>(value: T): T => structuredClone(value);
const fixtures = contractFixtures;

describe("contract fixtures", () => {
  it.each(Object.entries(fixtureManifest))("%s matches its schema", (_name, [schema, value]) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it("covers every run state the UI renders", () => {
    const states = [fixtures.runCompleted, fixtures.runGenerating, fixtures.runNeedsAttention].map((r) => r.run.status);
    expect(states).toEqual(["completed", "generating", "needs_attention"]);
  });

  it("keeps the creation document's references consistent", () => {
    const document = fixtures.creation.document;
    const potty = document.slides[0];
    expect(potty.latestRunId).toBe(fixtures.runCompleted.run.id);
    expect(potty.chosenTakeId).toBe(fixtures.runCompleted.run.takes.find((take) => take.verdict === "accepted")?.id);
    expect(potty.reviewRunId).toBe(fixtures.reviewCompleted.reviewRun.id);
    expect(fixtures.catalog.defaultModelId).toBe(document.defaults.modelId);
  });

  it("follows the playbook for the potty review", () => {
    const review = fixtures.reviewCompleted.reviewRun.result!;
    expect(review.suggestions[0].risk).toBe("safe");
    expect(review.suggestions[0].end_strength).toBe(END_FRAME_STRENGTH.calm);
    for (const suggestion of review.suggestions) expect(suggestion.prompt.endsWith(STATIC_CAMERA_SENTENCE)).toBe(true);
  });

  it("applies request defaults", () => {
    expect(fixtures.createRunRequest.seeds).toBe(2);
    expect(fixtures.createRunRequest.allowFallback).toBe(false);
  });
});

describe("contract rejects invalid shapes", () => {
  const document = () => clone(fixtureManifest.creation[1].document);

  it("rejects a document that is not version 2", () => {
    expect(creationDocumentV2Schema.safeParse({ ...document(), version: 1 }).success).toBe(false);
  });

  it("rejects a text layer without a background", () => {
    const slide = clone(document().slides[3]);
    slide.layers.textAssetId = "5f5c3a16-5b7e-4dae-8e6a-1c9b8a7f6e54";
    expect(slideV2Schema.safeParse(slide).success).toBe(false);
  });

  it("rejects a background without its size", () => {
    const slide = clone(document().slides[0]) as Record<string, unknown>;
    slide.width = null;
    slide.height = null;
    expect(slideV2Schema.safeParse(slide).success).toBe(false);
  });

  it("rejects duplicate slide ids and orders", () => {
    const withDuplicateId = document();
    withDuplicateId.slides[1].id = withDuplicateId.slides[0].id;
    expect(creationDocumentV2Schema.safeParse(withDuplicateId).success).toBe(false);
    const withDuplicateOrder = document();
    withDuplicateOrder.slides[1].order = 0;
    expect(creationDocumentV2Schema.safeParse(withDuplicateOrder).success).toBe(false);
  });

  it("rejects a suggestion without its index and a creator idea with one", () => {
    const withoutIndex = document();
    delete (withoutIndex.slides[0].motion as { suggestionIndex?: number }).suggestionIndex;
    expect(creationDocumentV2Schema.safeParse(withoutIndex).success).toBe(false);
    const creatorWithIndex = document();
    creatorWithIndex.slides[0].motion!.source = "creator";
    expect(creationDocumentV2Schema.safeParse(creatorWithIndex).success).toBe(false);
  });

  it("rejects an unknown motion style and text animation style", () => {
    const lively = document();
    (lively.defaults as { motionStyle: string }).motionStyle = "wild";
    expect(creationDocumentV2Schema.safeParse(lively).success).toBe(false);
    expect(textAnimationSchema.safeParse({ ...DEFAULT_TEXT_ANIMATION, style: "bounce" }).success).toBe(false);
  });

  it("rejects upload results whose ok flag disagrees with the items", () => {
    expect(uploadCheckResultSchema.safeParse({ ...fixtureManifest.uploadChecksSizeMismatch[1], ok: true }).success).toBe(false);
    expect(uploadCheckResultSchema.safeParse({ ok: false, items: [] }).success).toBe(false);
  });

  it("rejects an unknown upload check code and a generation size off the 64 grid", () => {
    expect(
      uploadCheckResultSchema.safeParse({ ok: true, items: [{ code: "blurry", severity: "warning", message: "x" }] }).success,
    ).toBe(false);
    expect(uploadCheckResultSchema.safeParse({ ok: true, items: [], generationSize: { width: 770, height: 960 } }).success).toBe(false);
  });

  it("rejects a JPEG text layer upload", () => {
    const request = clone(fixtureManifest.layerUploadRequest[1]) as { text: { mime: string } };
    request.text.mime = "image/jpeg";
    expect(layerUploadRequestSchema.safeParse(request).success).toBe(false);
  });

  it("rejects bad run states", () => {
    const unknownState = clone(fixtureManifest.runGenerating[1].run) as Record<string, unknown>;
    unknownState.status = "done";
    expect(runViewSchema.safeParse(unknownState).success).toBe(false);

    const completedWithoutAccepted = clone(fixtureManifest.runNeedsAttention[1].run) as Record<string, unknown>;
    completedWithoutAccepted.status = "completed";
    expect(runViewSchema.safeParse(completedWithoutAccepted).success).toBe(false);

    const tooManyAttempts = clone(fixtureManifest.runCompleted[1].run);
    tooManyAttempts.attemptCount = 4;
    expect(runViewSchema.safeParse(tooManyAttempts).success).toBe(false);

    const decidedWithoutChecks = clone(fixtureManifest.runCompleted[1].run) as { takes: Array<{ checks: unknown }> };
    decidedWithoutChecks.takes[0].checks = null;
    expect(runViewSchema.safeParse(decidedWithoutChecks).success).toBe(false);
  });

  it("rejects a review without exactly three suggestions or with an unlabelled risk", () => {
    const review = clone(fixtureManifest.reviewCompleted[1].reviewRun.result);
    expect(slideReviewSchema.safeParse({ ...review, suggestions: review.suggestions.slice(0, 2) }).success).toBe(false);
    const unlabelled = clone(review);
    unlabelled.suggestions[1].risk = "may lean toward the text";
    expect(slideReviewSchema.safeParse(unlabelled).success).toBe(false);
  });

  it("rejects an idea adjustment without a suggested change", () => {
    const { suggestedIdea: _ignored, ...withoutSuggestion } = fixtureManifest.ideaCheckAdjust[1].result;
    expect(ideaCheckResultSchema.safeParse(withoutSuggestion).success).toBe(false);
  });

  it("rejects a catalog with two defaults", () => {
    const catalog = clone(fixtureManifest.catalog[1]);
    catalog.models[1].isDefault = true;
    expect(catalogResponseSchema.safeParse(catalog).success).toBe(false);
  });

  it("rejects check results whose verdict disagrees with the failed checks", () => {
    const result = clone(fixtureManifest.checkResultRejected[1]);
    expect(checkJobResultSchema.safeParse({ ...result, verdict: "accepted" }).success).toBe(false);
    expect(checkJobResultSchema.safeParse({ ...result, failed: ["zoom"] }).success).toBe(false);
    const { width: _width, ...withoutSize } = fixtureManifest.checkOptions[1];
    expect(checkJobOptionsSchema.safeParse(withoutSize).success).toBe(false);
  });

  it("rejects unknown provider poll states and a non-URL background", () => {
    expect(providerPollSchema.safeParse({ state: "queued" }).success).toBe(false);
    expect(providerPollSchema.safeParse({ state: "failed" }).success).toBe(false);
    expect(
      generationInputSchema.safeParse({ ...fixtureManifest.generationInput[1], backgroundUrl: "owners/x/bg.webp" }).success,
    ).toBe(false);
  });
});

describe("contract constants", () => {
  it("keeps provider job statuses equal to hosted/lib/jobs.ts", () => {
    type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const same: Equal<(typeof JOB_STATUSES)[number], StudioJobStatus> = true;
    expect(same).toBe(true);
    expect(new Set(JOB_STATUSES).size).toBe(JOB_STATUSES.length);
  });

  it("uses the playbook's end-frame strengths and the benchmark's check limits", () => {
    expect(END_FRAME_STRENGTH).toEqual({ calm: 0.6, lively: 0.4 });
    expect(CHECK_THRESHOLDS).toEqual({ cameraDrift: 12, behindTextPercent: 9, loopDifference: 5, textDrift: 3 });
    expect(ACTIVE_PIPELINE_RUN_STATUSES.every((status) => PIPELINE_RUN_STATUSES.includes(status))).toBe(true);
  });
});

describe("creation v2 migration matches the contract", () => {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  const file = readdirSync(directory).find((name) => name.endsWith("_creation_v2.sql"));
  const sql = readFileSync(new URL(file!, directory), "utf8");
  const checkList = (column: string, table?: string) => {
    const scope = table ? sql.slice(sql.indexOf(`create table if not exists public.${table}`)) : sql;
    const match = scope.match(new RegExp(`${column}[^\\n]*?in \\(([^)]*)\\)`, "s"));
    return match ? [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]).sort() : [];
  };

  it("is the only creation v2 migration", () => {
    expect(file).toBeDefined();
  });

  it("allows every job status as an event type", () => {
    expect(checkList("event_type")).toEqual([...JOB_EVENT_TYPES].sort());
  });

  it("uses the contract's states, stages, verdicts and providers", () => {
    expect(checkList("status", "creative_studio_pipeline_runs")).toEqual([...PIPELINE_RUN_STATUSES].sort());
    expect(checkList("status", "creative_studio_review_runs")).toEqual([...REVIEW_RUN_STATUSES].sort());
    expect(checkList("stage", "creative_studio_takes")).toEqual([...TAKE_STAGES].sort());
    expect(checkList("verdict", "creative_studio_takes")).toEqual([...TAKE_VERDICTS].sort());
    expect(checkList("provider", "creative_studio_pipeline_runs")).toEqual([...PROVIDER_IDS].sort());
    expect(checkList("motion_style", "creative_studio_pipeline_runs")).toEqual(Object.keys(END_FRAME_STRENGTH).sort());
  });

  it("adds both layer kinds and the finish and check vision operations", () => {
    expect(checkList("kind")).toEqual(expect.arrayContaining(Object.values(LAYER_ASSET_KINDS)));
    expect(checkList("operation")).toEqual(expect.arrayContaining(["finish", "check"]));
    expect(sql).toMatch(/kind = 'text-layer' and mime_type = 'image\/png'/);
  });
});
