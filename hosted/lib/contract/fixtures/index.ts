import { z } from "zod";

import {
  budgetResponseSchema,
  catalogResponseSchema,
  checkJobOptionsSchema,
  checkJobResultSchema,
  chooseTakeRequestSchema,
  createRunRequestSchema,
  creationListResponseSchema,
  creationViewSchema,
  errorResponseSchema,
  finishJobOptionsSchema,
  finishJobResultSchema,
  generationInputSchema,
  ideaCheckResponseSchema,
  layerFinaliseRequestSchema,
  layerUploadRequestSchema,
  layerUploadResponseSchema,
  providerPollSchema,
  reviewRunResponseSchema,
  runResponseSchema,
  runSettingsSchema,
  uploadCheckResultSchema,
} from "../index";
import budget from "./budget.json";
import catalog from "./catalog.json";
import creationList from "./creation-list.json";
import creation from "./creation.json";
import layers from "./layers.json";
import pipeline from "./pipeline.json";
import review from "./review.json";
import runs from "./runs.json";
import uploadChecks from "./upload-checks.json";

/** Every fixture with the schema it must satisfy. UI mocks import the parsed values from `contractFixtures`. */
export const fixtureManifest = {
  creation: [creationViewSchema, creation],
  creationList: [creationListResponseSchema, creationList],
  uploadChecksPotty: [uploadCheckResultSchema, uploadChecks.pottyWarnings],
  uploadChecksSizeMismatch: [uploadCheckResultSchema, uploadChecks.sizeMismatch],
  uploadChecksNoAlpha: [uploadCheckResultSchema, uploadChecks.noAlpha],
  uploadChecksPortrait: [uploadCheckResultSchema, uploadChecks.cleanPortrait],
  uploadChecksSquare: [uploadCheckResultSchema, uploadChecks.square],
  layerUploadRequest: [layerUploadRequestSchema, layers.uploadRequest],
  layerUploadResponse: [layerUploadResponseSchema, layers.uploadResponse],
  layerFinaliseRequest: [layerFinaliseRequestSchema, layers.finaliseRequest],
  reviewCompleted: [reviewRunResponseSchema, review.pottyReviewRun],
  reviewRunning: [reviewRunResponseSchema, review.reviewRunning],
  reviewFailed: [reviewRunResponseSchema, review.reviewFailed],
  ideaCheckAdjust: [ideaCheckResponseSchema, review.ideaCheckAdjust],
  ideaCheckOk: [ideaCheckResponseSchema, review.ideaCheckOk],
  catalog: [catalogResponseSchema, catalog],
  createRunRequest: [createRunRequestSchema, runs.createRequest],
  chooseTakeRequest: [chooseTakeRequestSchema, runs.chooseRequest],
  runCompleted: [runResponseSchema, runs.completed],
  runGenerating: [runResponseSchema, runs.generating],
  runNeedsAttention: [runResponseSchema, runs.needsAttention],
  generationInput: [generationInputSchema, pipeline.generationInput],
  pollRunning: [providerPollSchema, pipeline.pollRunning],
  pollSucceededUploaded: [providerPollSchema, pipeline.pollSucceededUploaded],
  pollSucceededUrl: [providerPollSchema, pipeline.pollSucceededUrl],
  pollFailed: [providerPollSchema, pipeline.pollFailed],
  runSettings: [runSettingsSchema, pipeline.runSettings],
  finishOptions: [finishJobOptionsSchema, pipeline.finishOptions],
  finishResult: [finishJobResultSchema, pipeline.finishResult],
  checkOptions: [checkJobOptionsSchema, pipeline.checkOptions],
  checkResult: [checkJobResultSchema, pipeline.checkResult],
  checkResultRejected: [checkJobResultSchema, pipeline.checkResultRejected],
  budget: [budgetResponseSchema, budget.budget],
  budgetExceeded: [errorResponseSchema, budget.exceeded],
} as const satisfies Record<string, readonly [z.ZodTypeAny, unknown]>;

type Manifest = typeof fixtureManifest;

export const contractFixtures = Object.fromEntries(
  Object.entries(fixtureManifest).map(([name, [schema, value]]) => [name, schema.parse(value)]),
) as { [K in keyof Manifest]: z.output<Manifest[K][0]> };
