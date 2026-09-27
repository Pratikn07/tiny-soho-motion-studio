# Full Hosted Singapore Video Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship and release an owner-only hosted Creative Studio with every documented Singapore Alibaba video model, model-specific validation, durable private jobs, and a worker isolated from Instagram automation.

**Architecture:** hosted/ owns the browser and authenticated API. A typed Singapore catalogue is shared by the model picker, job validation, and family adapters. Supabase owns private Creative state/media, while a new worker claims and synchronizes only creative_studio_* jobs.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Zod, Supabase Auth/Postgres/Storage, Alibaba Model Studio, Node worker, Vercel, Railway.

**Spec:** docs/superpowers/specs/2026-09-20-full-hosted-singapore-video-studio-design.md

## Global Constraints

- Preserve every root-local Studio and insta-automation source, service, environment variable, table, bucket, trigger, and Meta integration.
- Create only namespaced creative_studio_* tables/functions and use the existing private creative-studio bucket.
- Registry entries are exact Singapore provider ids from the spec; no Beijing-only or free-text model submits.
- Require a model/version acknowledgement before every job. Never infer quota or fall back to a different model.
- Send only short-lived signed, ownership-checked Storage URLs to Alibaba. Keep Alibaba and service-role credentials server-only.
- Every production behavior follows red test, minimal change, focused green test, then a commit.
- Do not submit a paid-capable provider generation during verification. Deploy both services from merged main, then independently check Studio and Instagram health.

---

### Task 1: Add the typed Singapore catalogue and contract preflight

**Files:**
- Create: hosted/lib/video-catalog.ts
- Create: hosted/tests/video-catalog.test.ts
- Modify: hosted/lib/models.ts
- Modify: hosted/lib/generation.ts

**Interfaces:**
- Produces: VideoModelContract, SINGAPORE_VIDEO_MODELS, getVideoModelContract(id), and preflightGeneration(input).
- Consumes: selected model id, ordered media, options, and owner acknowledgement records.

- [ ] **Step 1: Write the focused failing test.**

~~~ts
import { describe, expect, it } from "vitest";
import { SINGAPORE_VIDEO_MODELS, preflightGeneration } from "@/lib/video-catalog";

describe("Singapore video catalogue", () => {
  it("contains text, image, keyframe, reference, edit, and animation families", () => {
    expect(SINGAPORE_VIDEO_MODELS.map((m) => m.providerModel)).toEqual(expect.arrayContaining([
      "wan2.7-t2v-2026-04-25", "wan2.7-i2v-2026-04-25", "wan2.2-kf2v-flash",
      "wan2.7-r2v", "wan2.7-videoedit", "wan2.2-animate-move",
    ]));
  });
  it("blocks a selected model without the exact contract acknowledgement", () => {
    expect(() => preflightGeneration({ modelId: "wan2.7-t2v", prompt: "Gentle pan", media: [], options: {}, acknowledgements: [] })).toThrow(/acknowledge/i);
  });
});
~~~

- [ ] **Step 2: Run the test and confirm red.**

Run: npm --prefix hosted test -- tests/video-catalog.test.ts

Expected: FAIL because the catalogue does not exist.

- [ ] **Step 3: Implement the minimal catalogue boundary.**

~~~ts
export type MediaRole = "first_frame" | "last_frame" | "reference_image" | "reference_video" | "source_video" | "driving_video" | "driving_audio" | "first_clip";
export type VideoTask = "text-to-video" | "image-to-video" | "keyframe-to-video" | "reference-to-video" | "video-edit" | "animate-move" | "animate-mix";
export type VideoModelContract = Readonly<{ id: string; providerModel: string; task: VideoTask; contractVersion: string; requiredRoles: readonly MediaRole[]; optionalRoles: readonly MediaRole[]; maxByRole: Partial<Record<MediaRole, number>>; optionSchema: z.ZodType }>;
~~~

Populate every provider model/mode from the spec. Preflight trims a 1–5,000 character prompt, requires acknowledgement matching model and contract version, validates roles/order/count and model Zod options, and returns normalized data only. Keep hosted/lib/models.ts as a compatibility delegate rather than a second allowlist.

- [ ] **Step 4: Run focused green verification.**

Run: npm --prefix hosted test -- tests/video-catalog.test.ts && npm --prefix hosted run check

Expected: PASS; removing a family or acknowledgement guard fails the test.

- [ ] **Step 5: Commit.**

~~~bash
git add hosted/lib/video-catalog.ts hosted/lib/models.ts hosted/lib/generation.ts hosted/tests/video-catalog.test.ts
git commit -m "feat: add Singapore video model catalogue"
~~~

### Task 2: Persist acknowledgements, ordered job media, and safe worker claims

**Files:**
- Create: supabase/migrations/<timestamp>_creative_studio_full_video_catalog.sql
- Create: hosted/lib/model-acknowledgements.ts
- Create: hosted/tests/model-acknowledgements.test.ts
- Modify: hosted/lib/repository.ts
- Modify: hosted/lib/types.ts

**Interfaces:**
- Produces: hasAcknowledgement, acknowledgeModel, createJobMedia, and private claim_creative_studio_job().
- Consumes: owner id, model/version, owned assets, and queued job state.

- [ ] **Step 1: Write the focused failing test.**

~~~ts
import { describe, expect, it } from "vitest";
import { acknowledgementKey, hasAcknowledgement } from "@/lib/model-acknowledgements";

describe("model acknowledgement", () => {
  it("does not accept an acknowledgement from an older contract", () => {
    const key = acknowledgementKey("wan2.7-t2v", "2026-04-25");
    expect(hasAcknowledgement([{ model_id: "wan2.7-t2v", contract_version: "2026-04-25" }], key)).toBe(true);
    expect(hasAcknowledgement([{ model_id: "wan2.7-t2v", contract_version: "2026-04-24" }], key)).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run the test and confirm red.**

Run: npm --prefix hosted test -- tests/model-acknowledgements.test.ts

Expected: FAIL because no acknowledgement module exists.

- [ ] **Step 3: Implement the migration and server-only repository operations.**

Create acknowledgement, job-media, and job-events tables with UUID keys, timestamptz, RLS, indexed foreign keys, unique acknowledgement (owner_user_id, model_id, contract_version), unique job media (job_id, role, ordinal), and a partial pending-job index. Add a public-schema claim RPC using FOR UPDATE SKIP LOCKED, fixed search_path, explicit status filter, and execute revoked from public, anon, and authenticated then granted only to service_role. Repository methods scope all reads/writes by owner_user_id and verify media ownership before insertion.

- [ ] **Step 4: Run focused green verification.**

Run: npm --prefix hosted test -- tests/model-acknowledgements.test.ts && npm --prefix hosted run check

Expected: PASS; stale acknowledgements cannot authorize a new contract.

- [ ] **Step 5: Commit.**

~~~bash
git add supabase/migrations hosted/lib/model-acknowledgements.ts hosted/lib/repository.ts hosted/lib/types.ts hosted/tests/model-acknowledgements.test.ts
git commit -m "feat: persist creative model acknowledgements"
~~~

### Task 3: Add family-specific Alibaba request and status adapters

**Files:**
- Create: hosted/lib/alibaba/contracts.ts
- Create: hosted/lib/alibaba/text-video.ts
- Create: hosted/lib/alibaba/image-video.ts
- Create: hosted/lib/alibaba/reference-video.ts
- Create: hosted/lib/alibaba/video-edit.ts
- Create: hosted/lib/alibaba/animation.ts
- Create: hosted/lib/alibaba/index.ts
- Create: hosted/tests/alibaba-contracts.test.ts

**Interfaces:**
- Produces: serializeAlibabaSubmit(prepared, signedMedia) and parseAlibabaStatus(response).
- Consumes: preflight-normalized contract and signed URLs only.

- [ ] **Step 1: Write the focused failing test.**

~~~ts
import { describe, expect, it } from "vitest";
import { serializeAlibabaSubmit } from "@/lib/alibaba";

describe("Alibaba video contract", () => {
  it("serializes ordered first and last keyframes for a keyframe model", () => {
    const request = serializeAlibabaSubmit({ contractId: "wan2.2-kf2v-flash", prompt: "Move", options: {}, media: [
      { role: "first_frame", url: "https://storage.example/first" },
      { role: "last_frame", url: "https://storage.example/last" },
    ] });
    expect(request.body.model).toBe("wan2.2-kf2v-flash");
    expect(request.body.input.media.map((m: { type: string }) => m.type)).toEqual(["first_frame", "last_frame"]);
  });
});
~~~

- [ ] **Step 2: Run the test and confirm red.**

Run: npm --prefix hosted test -- tests/alibaba-contracts.test.ts

Expected: FAIL because the family adapters do not exist.

- [ ] **Step 3: Implement exact family adapters.**

Select an adapter solely from VideoModelContract.task. Use the Singapore endpoint and X-DashScope-Async: enable, submit timeout of 60 seconds, status timeout of 30 seconds, ordered references, and only contract-permitted fields. Normalize provider responses to task id/status/result URL/safe failure code. Never persist raw body, signed URLs, headers, or API keys.

- [ ] **Step 4: Run focused green verification.**

Run: npm --prefix hosted test -- tests/alibaba-contracts.test.ts && npm --prefix hosted run check

Expected: PASS; unsupported roles cannot enter a serializer.

- [ ] **Step 5: Commit.**

~~~bash
git add hosted/lib/alibaba hosted/tests/alibaba-contracts.test.ts
git commit -m "feat: add Alibaba video family adapters"
~~~

### Task 4: Build the isolated Creative Worker and job lifecycle

**Files:**
- Create: creative-worker/package.json
- Create: creative-worker/src/index.ts
- Create: creative-worker/src/claim.ts
- Create: creative-worker/src/process-job.ts
- Create: creative-worker/src/health.ts
- Create: creative-worker/Dockerfile
- Create: creative-worker/railway.toml
- Create: creative-worker/tests/process-job.test.ts
- Modify: hosted/lib/jobs.ts
- Modify: hosted/app/api/jobs/route.ts

**Interfaces:**
- Produces: /health and one processor for Creative jobs only.
- Consumes: private claim RPC, Creative media/storage, and Task 3 adapters.

- [ ] **Step 1: Write the focused failing lifecycle test.**

~~~ts
import { describe, expect, it } from "vitest";
import { processClaimedJob } from "../src/process-job";

describe("Creative worker", () => {
  it("does not resubmit when provider output ingestion fails", async () => {
    const updates: string[] = [];
    await processClaimedJob({ id: "job-1", status: "submitted", provider_task_id: "task-1" }, {
      poll: async () => ({ status: "SUCCEEDED", resultUrl: "https://provider.example/video.mp4" }),
      ingest: async () => { throw new Error("storage unavailable"); },
      update: async (status) => { updates.push(status); },
    });
    expect(updates).toEqual(["downloading", "needs_attention"]);
  });
});
~~~

- [ ] **Step 2: Run the test and confirm red.**

Run: npm --prefix creative-worker test -- tests/process-job.test.ts

Expected: FAIL because the Worker does not exist.

- [ ] **Step 3: Implement the bounded isolated processor.**

Add a Node process that claims only creative_studio_jobs, signs owner media for five minutes, submits once, polls later, ingests successful MP4s to the private Creative bucket, and updates generated-video asset plus job status atomically. Provider failure is failed; ambiguous submission/transport/ingest is needs_attention with provider task retained. The Dockerfile starts only Creative code and railway.toml names one non-Instagram service.

- [ ] **Step 4: Run worker and hosted job verification.**

Run: npm --prefix creative-worker test -- tests/process-job.test.ts && npm --prefix hosted test -- tests/jobs.test.ts && npm --prefix hosted run check

Expected: PASS; a failed ingest never produces a second provider submit.

- [ ] **Step 5: Commit.**

~~~bash
git add creative-worker hosted/lib/jobs.ts hosted/app/api/jobs creative-worker/tests
git commit -m "feat: add isolated creative job worker"
~~~

### Task 5: Make the UI contract-driven and add hosted creative planning entry points

**Files:**
- Create: hosted/components/ModelPicker.tsx
- Create: hosted/components/ModelInputSlots.tsx
- Create: hosted/components/CreativeNavigation.tsx
- Create: hosted/app/storyboards/page.tsx
- Create: hosted/app/workflows/page.tsx
- Create: hosted/app/director/page.tsx
- Modify: hosted/components/MotionStudio.tsx
- Modify: hosted/lib/api.ts
- Create: hosted/tests/model-picker.test.tsx

**Interfaces:**
- Produces: model family picker, acknowledgement action, contract-specific input slots, and durable planning routes.
- Consumes: catalogue, acknowledgements, and shared job API.

- [ ] **Step 1: Write the focused failing UI test.**

~~~tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModelPicker } from "@/components/ModelPicker";

describe("ModelPicker", () => {
  it("shows text-to-video and requires acknowledgement", () => {
    render(<ModelPicker selectedId="wan2.7-t2v" acknowledgements={[]} onChange={() => {}} onAcknowledge={() => {}} />);
    expect(screen.getByRole("option", { name: /Wan 2.7 text to video/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /acknowledge/i })).toBeInTheDocument();
  });
});
~~~

- [ ] **Step 2: Run the test and confirm red.**

Run: npm --prefix hosted test -- tests/model-picker.test.tsx

Expected: FAIL because the picker does not exist.

- [ ] **Step 3: Implement the owner UI.**

Group every catalogue contract by family. Switching models discards incompatible media/options. Derive slots and controls from the contract; Generate stays disabled until required media and acknowledgement exist. Add Motion, Storyboards, Workflows, Director, and Assets navigation. Planning routes use the authenticated API wrapper, persist only namespaced rows, and always send a reviewed specification through shared preflight to create jobs.

- [ ] **Step 4: Run UI/build verification.**

Run: npm --prefix hosted test -- tests/model-picker.test.tsx && npm --prefix hosted test && npm --prefix hosted run check && npm --prefix hosted run build

Expected: PASS; incompatible old media cannot enable Generate after model switch.

- [ ] **Step 5: Commit.**

~~~bash
git add hosted/components hosted/app hosted/lib/api.ts hosted/tests/model-picker.test.tsx
git commit -m "feat: add contract-driven creative studio UI"
~~~

### Task 6: Review, merge, deploy, and prove non-interference

**Files:**
- Modify: hosted/README.md
- Modify: docs/architecture/current-runtime-state.md
- Modify: docs/architecture/zero-cost-canary-status.md

**Interfaces:**
- Produces: merged main deployed to Vercel and separate Creative Worker, with schema, health, and non-interference evidence.

- [ ] **Step 1: Run complete local verification.**

Run: npm --prefix hosted test && npm --prefix hosted run check && npm --prefix hosted run build && npm --prefix creative-worker test

Expected: all commands exit 0 without credential output.

- [ ] **Step 2: Request review and fix confirmed defects.**

Review origin/main...HEAD; add a regression test for each confirmed finding and repeat Step 1.

- [ ] **Step 3: Apply and verify only the reviewed Creative migration.**

Inspect live tables, policies, functions, and bucket before applying. Run security/performance advisors, apply only the new migration, verify RLS/indexes/function revocations/private bucket, and re-run advisors. Stop for any new high-severity Studio finding.

- [ ] **Step 4: Merge and deploy exact main.**

Push branch, merge green PR, fetch origin/main, record SHA, deploy hosted/ to tiny-soho-creative-studio, and deploy only creative-worker/ as a new Railway service from the same SHA. Configure only SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHSCOPE_API_KEY, ALIBABA_WORKSPACE_ID, and PORT in Worker secrets.

- [ ] **Step 5: Gather production evidence.**

Verify Vercel SHA, canonical health, and unauthenticated 401; verify Worker SHA and health. As an owner create a harmless project/upload and prove every model is blocked before acknowledgement without sending a provider request. Check Instagram deployment/health read-only and verify its SHA/config/schema/service did not change.

- [ ] **Step 6: Record factual release state.**

Document merged SHA, migration id, Vercel and Worker deployments, tests, owner smoke, no-provider limitation, and Instagram health. If docs change main, redeploy both services from the new main SHA before declaring release complete.
