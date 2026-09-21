# Hosted Creative Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship owner-only hosted Director, Workflow Studio, and CPU-safe Vision Lab as durable Supabase-backed services without altering Instagram automation.

**Architecture:** Vercel authenticates and validates owner requests, Supabase stores owner-scoped records and private objects, the existing Creative Worker processes Director and workflow queues, and a separate Railway Vision service processes CPU-safe overlay/composition jobs. Browser code receives only Supabase's publishable key; provider and service-role credentials stay server-side.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Supabase Postgres and Storage, Railway Docker services, Node 24, Python 3.11, FastAPI, Pillow, FFmpeg, @xyflow/react 12.8.6.

**Spec:** docs/superpowers/specs/2026-09-20-hosted-creative-suite-design.md

## Global Constraints

- Change only creative_studio_* Supabase objects and the private creative-studio bucket; do not alter Instagram tables, buckets, deployment, service, or environment.
- Apply owner_user_id filtering to every resource lookup and keep RLS enabled with no browser Data API policies.
- Every claim RPC uses a fixed search_path, FOR UPDATE SKIP LOCKED, a bounded lease, and grants only service_role.
- Vercel never receives or calls Alibaba credentials; creative-vision never receives Alibaba, Meta, or Instagram credentials.
- Preserve current Motion and Asset behaviour, model acknowledgement, catalogue preflight, and private signed-download authorization.
- Vision release scope is CPU-safe inspection, overlay, plate, and composition. OCR, SAM2, and Qwen remain unavailable unless separately configured with dependencies, weights, hardware, and approvals.
- Do not submit a billable Alibaba or Qwen request as a deployment test.

---

## File structure

| Path | Responsibility |
| --- | --- |
| Supabase CLI-generated hosted_creative_suite migration | Suite tables, indexes, constraints, RLS, and claim RPCs. |
| hosted/lib/creative-suite.ts | Zod schemas and serializable Director, Workflow, and Vision types. |
| hosted/lib/repository.ts | Narrow owner-filtered persistence methods for suite records. |
| hosted/app/api/director, hosted/app/api/workflows, hosted/app/api/vision | Authenticated Vercel request/read routes. |
| creative-worker/src/director.ts, creative-worker/src/workflows.ts | Director and Workflow claim/process loops. |
| creative-vision | Railway Docker service that claims Vision jobs and persists private outputs. |
| hosted/components/StudioShell.tsx, DirectorStudio.tsx, WorkflowStudio.tsx, VisionStudio.tsx | Hosted owner-facing suite navigation and screens. |
| hosted/lib/api.ts | Typed browser calls for suite records. |

### Task 1: Persist the hosted suite safely

**Files:**
- Create: supabase/migrations/20260920170000_hosted_creative_suite.sql
- Create: hosted/lib/creative-suite.ts
- Modify: hosted/lib/repository.ts
- Modify: tests/creative-studio-migration-contract.test.ts
- Create: hosted/tests/creative-suite-repository.test.ts

**Interfaces:**
- Produces DirectorRequest, DirectorProposal, StudioWorkflow, WorkflowRun, VisionJob, and VisionCapability types with UUID id, owner_user_id where applicable, status, safe error fields, and timestamps.
- Produces StudioRepository.createDirectorRequest, getDirectorProposal, createWorkflow, createWorkflowRun, createVisionJob, and owner-filtered list/read methods.
- Later routes consume these types and never query an unfiltered table.

- [ ] **Step 1: Write the failing migration and repository tests**

~~~ts
it("defines suite records and keeps claim functions service-role only", () => {
  expect(migration).toMatch(/create table .*creative_studio_director_requests/is);
  expect(migration).toMatch(/create table .*creative_studio_workflow_runs/is);
  expect(migration).toMatch(/create table .*creative_studio_vision_jobs/is);
  expect(migration).toMatch(/create table .*creative_studio_vision_capabilities/is);
  expect(migration).toMatch(/revoke all on function public\.claim_creative_studio_vision_job\(\) from public, anon, authenticated/is);
  expect(migration).toMatch(/grant execute on function public\.claim_creative_studio_vision_job\(\) to service_role/is);
});

it("adds owner filtering when reading a Vision job", async () => {
  await repository.getVisionJob("11111111-1111-4111-8111-111111111111");
  expect(query.eq).toHaveBeenCalledWith("owner_user_id", owner.userId);
});
~~~

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: npm test -- creative-studio-migration-contract.test.ts
Run: npm --prefix hosted test -- creative-suite-repository.test.ts

Expected: failures because the migration, types, and repository methods do not exist.

- [ ] **Step 3: Generate and implement the migration and typed persistence boundary**

Run this first from the repository root so the imperative migration filename is assigned by the installed CLI:

~~~bash
supabase migration new hosted_creative_suite
~~~

~~~ts
export type WorkflowRunStatus =
  | "queued" | "running" | "completed" | "failed" | "needs_attention" | "canceled";

export type VisionOperation =
  | "inspect" | "overlay" | "plate" | "compose" | "ocr" | "segment" | "layers";

export const createVisionJobSchema = z.object({
  projectId: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  operation: z.enum(["inspect", "overlay", "plate", "compose", "ocr", "segment", "layers"]),
  options: z.record(z.unknown()).default({}),
  inputAssetIds: z.array(z.string().uuid()).max(10).default([]),
  idempotencyKey: z.string().uuid(),
});
~~~

Create Director request/proposal, workflow/workflow-run, Vision-job, and service-owned Vision-capability tables; validate status/operation values; add owner/project/status indexes; enable RLS; and add lease-based service-role claim RPCs. The capability table contains capability_id, service_version, status, reason, and updated_at, and is written only by the Vision service role. Expand creative_studio_assets only with derived-image and derived-video plus corresponding image/MP4 MIME rules. Repository mutations insert owner_user_id from the authenticated owner, and all reads of owner records chain .eq("owner_user_id", this.owner.userId).

- [ ] **Step 4: Run focused verification**

Run: npm test -- creative-studio-migration-contract.test.ts
Run: npm --prefix hosted test -- creative-suite-repository.test.ts
Run: npm --prefix hosted run check

Expected: all pass; migration tests prove no grants to browser roles and repository tests prove owner-scoped reads.

- [ ] **Step 5: Commit the data boundary**

~~~bash
git add supabase/migrations/*_hosted_creative_suite.sql hosted/lib/creative-suite.ts hosted/lib/repository.ts tests/creative-studio-migration-contract.test.ts hosted/tests/creative-suite-repository.test.ts
git commit -m "feat(creative): add durable suite records"
~~~

### Task 2: Add immutable Director drafts and approval

**Files:**
- Create: hosted/lib/director.ts
- Create: hosted/app/api/director/drafts/route.ts
- Create: hosted/app/api/director/proposals/[id]/route.ts
- Create: hosted/app/api/director/proposals/[id]/approve/route.ts
- Create: creative-worker/src/director.ts
- Modify: creative-worker/src/worker.ts
- Modify: creative-worker/src/index.ts
- Create: hosted/tests/director.test.ts
- Create: creative-worker/tests/director.test.ts

**Interfaces:**
- validateDirectorDraft(input, assets, catalogue): DirectorDraftInput accepts only owned project assets and current VideoModelContract IDs.
- validateDirectorProposal(snapshot, scope): DirectorProposalSnapshot rejects invalid media roles, options, and cross-project assets.
- processDirectorRequest(job, dependencies) returns a durable drafted, failed, or needs_attention outcome and never queues video itself.
- approveDirectorProposal(proposal, acknowledgements) produces deterministic child job inputs.

- [ ] **Step 1: Write failing Director contract tests**

~~~ts
it("rejects a Director proposal that references an asset outside the project", () => {
  expect(() => validateDirectorProposal({
    shots: [{ modelId: "wan2.7-i2v", media: [{ assetId: otherAsset, role: "first_frame" }] }],
  }, scope)).toThrow(/owned project asset/i);
});

it("does not create a video job while drafting", async () => {
  await createDraft(ownerRequest("calm carousel motion"));
  expect(repository.createJob).not.toHaveBeenCalled();
});

it("submits Qwen only after claiming a queued Director request", async () => {
  await processDirectorRequest(queuedRequest, dependencies);
  expect(dependencies.submitQwen).toHaveBeenCalledOnce();
  expect(dependencies.createVideoJobs).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: Run the focused failing tests**

Run: npm --prefix hosted test -- director.test.ts
Run: npm --prefix creative-worker test -- director.test.ts

Expected: failures because no draft validation, request route, or worker processor exists.

- [ ] **Step 3: Implement request, worker, and approval contracts**

~~~ts
export async function POST(request: Request) {
  const owner = await requireOwner(request);
  const input = createDirectorDraftSchema.parse(await request.json());
  const repository = new StudioRepository(createServiceSupabaseClient(), owner);
  const project = await repository.getProject(input.projectId);
  if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");
  const directorRequest = await repository.createDirectorRequest(input);
  return Response.json({ request: directorRequest }, { status: 202 });
}
~~~

Sanitize the worker manifest to asset ID, name, media kind, MIME type, dimensions, duration, and stable order. Persist only validated proposal JSON and safe error fields. Approval reads the proposal by owner, requires drafted state, repeats proposal/model-acknowledgement validation, creates deterministic child-job idempotency keys, then marks the proposal approved through one transaction/RPC boundary.

- [ ] **Step 4: Verify Director behaviour**

Run: npm --prefix hosted test -- director.test.ts
Run: npm --prefix creative-worker test -- director.test.ts
Run: npm --prefix hosted run check
Run: npm --prefix creative-worker run check

Expected: drafting is durable but cannot generate; approval creates only validated idempotent video jobs.

- [ ] **Step 5: Commit Director processing**

~~~bash
git add hosted/lib/director.ts hosted/app/api/director creative-worker/src/director.ts creative-worker/src/worker.ts creative-worker/src/index.ts hosted/tests/director.test.ts creative-worker/tests/director.test.ts
git commit -m "feat(creative): add hosted director drafts"
~~~

### Task 3: Port workflow validation and durable scheduling

**Files:**
- Create: hosted/lib/workflows.ts
- Create: hosted/app/api/workflows/route.ts
- Create: hosted/app/api/workflows/[id]/route.ts
- Create: hosted/app/api/workflows/[id]/runs/route.ts
- Create: hosted/app/api/workflow-runs/[id]/route.ts
- Create: creative-worker/src/workflows.ts
- Modify: creative-worker/src/worker.ts
- Create: hosted/tests/workflows.test.ts
- Create: creative-worker/tests/workflows.test.ts

**Interfaces:**
- validateWorkflowGraph(graph, capabilitySnapshot): WorkflowGraphV2 normalizes named ports and rejects cycles, unknown node types, invalid links, and unavailable Vision requirements.
- advanceWorkflowRun(run, dependencies): Promise<WorkflowRunUpdate> processes completed parents, enqueues a child video job only once, and returns a persisted node-state patch.
- StudioRepository.createWorkflowRun stores an immutable graph snapshot and returns the same run on idempotency replay.

- [ ] **Step 1: Write failing graph and scheduler tests**

~~~ts
it("rejects a cycle before saving a hosted workflow", () => {
  expect(() => validateWorkflowGraph(cyclicGraph, capabilities)).toThrow(/cycle/i);
});

it("waits for a parent video job before creating its child", async () => {
  const result = await advanceWorkflowRun(runWithPendingParent, dependencies);
  expect(result.nodeState.shot.status).toBe("pending");
  expect(dependencies.createJob).not.toHaveBeenCalled();
});

it("uses a run/node idempotency key for each child job", async () => {
  await advanceWorkflowRun(runWithReadyParent, dependencies);
  expect(dependencies.createJob).toHaveBeenCalledWith(expect.objectContaining({
    idempotencyKey: run.id + ":shot",
  }));
});
~~~

- [ ] **Step 2: Run focused Workflow tests and confirm they fail**

Run: npm --prefix hosted test -- workflows.test.ts
Run: npm --prefix creative-worker test -- workflows.test.ts

Expected: failures because hosted graph validation and queue advancement do not exist.

- [ ] **Step 3: Implement V2 graph persistence and worker advancement**

~~~ts
export type WorkflowGraphV2 = {
  version: 2;
  nodes: Array<{
    id: string;
    type: "asset" | "prompt-template" | "noop" | "generate-video" | VisionOperation;
    data: Record<string, unknown>;
  }>;
  edges: Array<{ source: string; sourceOutput: string; target: string; targetInput: string }>;
};

export async function advanceWorkflowRun(
  run: WorkflowRun,
  dependencies: WorkflowDependencies,
): Promise<WorkflowRunUpdate> {
  // derive the next node-state transition from the immutable graph snapshot
  return dependencies.advance(run);
}
~~~

The route stores only validated graph data. The worker claims a run, reads jobs/assets through ownership-safe service-role queries, records terminal upstream failures, and persists node transitions. Generation nodes use existing durable video-job creation rather than Alibaba calls. Vision nodes create a Vision job only after the capability snapshot declares their operation available.

- [ ] **Step 4: Verify Workflow behaviour**

Run: npm --prefix hosted test -- workflows.test.ts
Run: npm --prefix creative-worker test -- workflows.test.ts
Run: npm --prefix hosted run check
Run: npm --prefix creative-worker run check

Expected: invalid graphs cannot save; a restarted worker cannot duplicate a child job; completed outputs flow to named downstream ports.

- [ ] **Step 5: Commit Workflow scheduling**

~~~bash
git add hosted/lib/workflows.ts hosted/app/api/workflows hosted/app/api/workflow-runs creative-worker/src/workflows.ts creative-worker/src/worker.ts hosted/tests/workflows.test.ts creative-worker/tests/workflows.test.ts
git commit -m "feat(creative): add durable workflow runs"
~~~

### Task 4: Build the isolated CPU-safe Vision processor

**Files:**
- Create: creative-vision/Dockerfile
- Create: creative-vision/requirements.txt
- Create: creative-vision/src/config.py
- Create: creative-vision/src/repository.py
- Create: creative-vision/src/processor.py
- Create: creative-vision/src/main.py
- Create: creative-vision/railway.toml
- Create: creative-vision/tests/test_processor.py
- Create: creative-vision/tests/test_health.py
- Modify: services/vision/overlay.py
- Modify: services/vision/plate.py
- Modify: services/vision/composition.py
- Create: hosted/tests/vision.test.ts

**Interfaces:**
- claim_and_process_once(client, config) -> bool claims one Vision job and returns False when none is available.
- process_vision_job(job, storage, processor) -> VisionResult supports inspect, overlay, plate, and compose; optional operations return needs_attention with a capability reason.
- VisionResult contains asset IDs, dimensions, tool version, and safe status only; it contains no filesystem path, signed URL, or source bytes.
- GET /health returns service name, version, and configured state; it accepts no media request.
- creative-vision upserts VisionCapability rows at boot and after an optional runtime availability change.

- [ ] **Step 1: Write failing Python and hosted Vision-route tests**

~~~python
def test_processor_writes_only_project_scoped_derived_assets() -> None:
    result = process_vision_job(overlay_job, storage, processor)
    assert result.status == "completed"
    assert result.object_paths == [f"owners/{OWNER}/projects/{PROJECT}/vision/{overlay_job.id}/overlay.png"]
    assert storage.signed_urls == [SOURCE_SIGNED_URL]

def test_unconfigured_ocr_records_needs_attention_without_importing_weights() -> None:
    result = process_vision_job(ocr_job, storage, processor)
    assert result.status == "needs_attention"
    assert "not configured" in result.error_message
~~~

~~~ts
it("rejects a Vision job whose source asset belongs to another project", async () => {
  await expect(createVisionJob(ownerRequest({ projectId, sourceAssetId: otherProjectAsset })))
    .rejects.toMatchObject({ code: "invalid_vision_asset" });
});
~~~

- [ ] **Step 2: Run focused Vision tests and confirm they fail**

Run: python3.11 -m unittest discover -s creative-vision/tests
Run: npm --prefix hosted test -- vision.test.ts

Expected: failures because no hosted queue route or Railway processor exists.

- [ ] **Step 3: Implement the processor and minimal Docker image**

~~~dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/vision ./services/vision
COPY creative-vision ./creative-vision
RUN pip install --no-cache-dir -r creative-vision/requirements.txt
CMD ["python", "-m", "creative_vision.src.main"]
~~~

~~~python
def process_vision_job(job: VisionJob, storage: StoragePort, processor: VisionProcessor) -> VisionResult:
    source = storage.download_owned_source(job.owner_user_id, job.project_id, job.source_asset_id)
    if job.operation == "overlay":
        return processor.create_overlay(job, source)
    if job.operation == "plate":
        return processor.create_plate(job, source)
    if job.operation == "compose":
        return processor.compose(job, source)
    return processor.unavailable(job.operation)
~~~

Use temporary job-specific directories and remove them in a finally block after upload. Reuse pure local services/vision overlay/plate/composition functions, adapting them to explicit byte/path ports rather than browser paths or the local artifact manager. Do not install PaddleOCR, PyTorch, SAM2, Qwen, or weights. The public endpoint is health-only; all work comes from the Supabase claim loop.

- [ ] **Step 4: Verify Vision processing and image build**

Run: python3.11 -m unittest discover -s creative-vision/tests
Run: python3.11 -m unittest discover -s services/vision/tests
Run: npm --prefix hosted test -- vision.test.ts
Run: docker build -f creative-vision/Dockerfile -t tiny-soho-creative-vision:test .

Expected: deterministic operations persist private derived outputs; optional capabilities are reported unavailable without downloading weights.

- [ ] **Step 5: Commit the Vision service**

~~~bash
git add creative-vision services/vision/overlay.py services/vision/plate.py services/vision/composition.py hosted/tests/vision.test.ts
git commit -m "feat(creative): add isolated vision worker"
~~~

### Task 5: Expose authenticated suite routes and browser API methods

**Files:**
- Modify: hosted/lib/api.ts
- Create: hosted/app/api/director/requests/[id]/route.ts
- Create: hosted/app/api/workflows/[id]/runs/[runId]/route.ts
- Create: hosted/app/api/vision/capabilities/route.ts
- Create: hosted/app/api/vision/jobs/route.ts
- Create: hosted/app/api/vision/jobs/[id]/route.ts
- Modify: hosted/lib/repository.ts
- Modify: hosted/tests/api.test.ts
- Create: hosted/tests/creative-suite-routes.test.ts

**Interfaces:**
- createStudioApi produces createDirectorDraft, getDirectorRequest, getDirectorProposal, approveDirectorProposal, listWorkflows, saveWorkflow, startWorkflowRun, getWorkflowRun, listVisionCapabilities, createVisionJob, and getVisionJob.
- Every route invokes requireOwner, performs same-owner/project validation before persistence, and returns a narrow public view without object paths or service details.

- [ ] **Step 1: Write failing route and client tests**

~~~ts
it("sends a fresh bearer token when creating a Director draft", async () => {
  await api.createDirectorDraft({ projectId, brief: "Quiet autumn product motion" });
  expect(fetcher).toHaveBeenCalledWith("/api/director/drafts", expect.objectContaining({
    headers: expect.objectContaining({ Authorization: "Bearer session-token" }),
  }));
});

it("returns an authorization failure before reading another owner's Vision job", async () => {
  await expect(GET(requestForOtherOwner, { params: Promise.resolve({ id: jobId }) }))
    .resolves.toMatchObject({ status: 403 });
  expect(repository.getVisionJob).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: Run the failing route tests**

Run: npm --prefix hosted test -- api.test.ts creative-suite-routes.test.ts

Expected: failures because suite endpoints and typed client methods are absent.

- [ ] **Step 3: Implement narrow authenticated routes and public views**

~~~ts
const publicVisionJob = (job: VisionJob) => ({
  id: job.id,
  projectId: job.project_id,
  operation: job.operation,
  status: job.status,
  outputAssetIds: job.output_asset_ids,
  errorCode: job.error_code,
  errorMessage: job.error_message,
  createdAt: job.created_at,
  updatedAt: job.updated_at,
});
~~~

Use Zod schemas from creative-suite.ts. Read routes return only owned records. Create routes assign an idempotency key and require a selected owned project. Capability reads return CPU/optional availability from persisted service health/capability records, never a direct browser-to-Railway response.

- [ ] **Step 4: Verify API boundaries**

Run: npm --prefix hosted test -- api.test.ts creative-suite-routes.test.ts
Run: npm --prefix hosted run check
Run: npm --prefix hosted run build

Expected: browser calls carry a session token; cross-owner paths disclose no records; returned views exclude object paths and credentials.

- [ ] **Step 5: Commit hosted suite APIs**

~~~bash
git add hosted/lib/api.ts hosted/lib/repository.ts hosted/app/api/director hosted/app/api/workflows hosted/app/api/workflow-runs hosted/app/api/vision hosted/tests/api.test.ts hosted/tests/creative-suite-routes.test.ts
git commit -m "feat(creative): add hosted suite APIs"
~~~

### Task 6: Render all hosted tools in the Studio UI

**Files:**
- Create: hosted/components/StudioShell.tsx
- Create: hosted/components/DirectorStudio.tsx
- Create: hosted/components/WorkflowStudio.tsx
- Create: hosted/components/VisionStudio.tsx
- Modify: hosted/components/HostedStudio.tsx
- Modify: hosted/components/MotionStudio.tsx
- Modify: hosted/app/globals.css
- Modify: hosted/package.json
- Modify: hosted/package-lock.json
- Create: hosted/tests/director-studio.test.tsx
- Create: hosted/tests/workflow-studio.test.tsx
- Create: hosted/tests/vision-studio.test.tsx
- Modify: hosted/tests/app-shell.test.ts

**Interfaces:**
- StudioShell receives authenticated StudioApi and owns motion, assets, director, workflows, and vision navigation state.
- DirectorStudio, WorkflowStudio, and VisionStudio receive typed API methods and project/asset selections; they do not import Supabase clients or server-only code.
- WorkflowStudio uses @xyflow/react 12.8.6 and emits only WorkflowGraphV2 through saveWorkflow.

- [ ] **Step 1: Write failing UI tests**

~~~tsx
it("renders all five owner tools after authentication", () => {
  render(<StudioShell api={api} />);
  expect(screen.getByRole("button", { name: "Director" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Workflows" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Vision Lab" })).toBeVisible();
});

it("keeps an unavailable Vision operation disabled and explains why", async () => {
  render(<VisionStudio api={api} projectId={projectId} />);
  expect(await screen.findByText(/PaddleOCR is not configured/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /Analyze text/i })).toBeDisabled();
});
~~~

- [ ] **Step 2: Run focused UI tests and confirm they fail**

Run: npm --prefix hosted test -- app-shell.test.ts director-studio.test.tsx workflow-studio.test.tsx vision-studio.test.tsx

Expected: failures because the authenticated shell exposes only Motion and Assets.

- [ ] **Step 3: Implement suite shell and screens**

~~~tsx
const tools = [
  ["motion", "Motion"], ["assets", "Assets"], ["director", "Director"],
  ["workflows", "Workflows"], ["vision", "Vision Lab"],
] as const;

return <nav aria-label="Creative Studio">{tools.map(([id, label]) => (
  <button key={id} aria-current={activeTool === id ? "page" : undefined}
    onClick={() => setActiveTool(id)}>{label}</button>
))}</nav>;
~~~

Move existing Motion/Assets beneath StudioShell without changing model selection or unsent-form state. Director shows exact proposal contents before approval. Workflow shows port validation errors and persisted node statuses. Vision renders actual capability reasons, requests allowed inputs per operation, and links owner-authorized derived outputs. Add @xyflow/react@12.8.6 with npm install --package-lock-only followed by the normal install process; do not copy root lock entries manually.

- [ ] **Step 4: Verify UI and production build**

Run: npm --prefix hosted test
Run: npm --prefix hosted run check
Run: npm --prefix hosted run build

Expected: all five tools are visible after auth; unavailable Vision controls are disabled; Motion tests pass unchanged.

- [ ] **Step 5: Commit hosted UI**

~~~bash
git add hosted/components hosted/app/globals.css hosted/package.json hosted/package-lock.json hosted/tests
git commit -m "feat(creative): show hosted creative tools"
~~~

### Task 7: Document and verify isolated deployment readiness

**Files:**
- Modify: hosted/README.md
- Create: creative-vision/README.md
- Create: creative-worker/README.md
- Modify: docs/architecture/current-runtime-state.md
- Create: hosted/tests/creative-suite-deployment-boundary.test.ts
- Create: creative-vision/tests/test_deployment_boundary.py

**Interfaces:**
- Vercel environment requires only Supabase URL, publishable key, service-role key, and owner allowlist.
- Creative Worker requires Supabase URL/service role plus Alibaba credentials; Vision requires Supabase URL/service role plus CPU resource settings.
- Documents expose health routes and no-provider smoke commands but never secret values.

- [ ] **Step 1: Write failing deployment-boundary tests**

~~~ts
it("keeps Alibaba variables out of Vercel and Vision", () => {
  expect(hostedEnvExample).not.toMatch(/DASHSCOPE_API_KEY|ALIBABA_WORKSPACE_ID/);
  expect(visionReadme).not.toMatch(/META_|INSTAGRAM_/);
});
~~~

~~~python
def test_vision_dockerfile_installs_ffmpeg_but_not_optional_model_runtimes() -> None:
    dockerfile = Path("creative-vision/Dockerfile").read_text()
    assert "ffmpeg" in dockerfile
    assert "torch" not in dockerfile.lower()
    assert "paddleocr" not in dockerfile.lower()
~~~

- [ ] **Step 2: Run boundary tests and confirm they fail**

Run: npm --prefix hosted test -- creative-suite-deployment-boundary.test.ts
Run: python3.11 -m unittest discover -s creative-vision/tests -p test_deployment_boundary.py

Expected: failures because service documentation and boundary tests do not exist.

- [ ] **Step 3: Add deployment documentation and boundary tests**

Document Railway service root/Dockerfile selection, production environment variable names only, health routes, private Storage ownership, no-provider smoke workflow, and the fact that a real Qwen/Alibaba invocation is not deployment proof. Update runtime state to name the separate Vercel, Creative Worker, Vision, and Instagram surfaces.

- [ ] **Step 4: Run full local verification**

~~~bash
npm test
npm run check
npm run build
npm --prefix hosted test
npm --prefix hosted run check
npm --prefix hosted run build
npm --prefix creative-worker test
npm --prefix creative-worker run check
python3.11 -m unittest discover -s services/vision/tests
python3.11 -m unittest discover -s creative-vision/tests
docker build -f creative-vision/Dockerfile -t tiny-soho-creative-vision:test .
git diff --check
~~~

Expected: all suites/builds pass, the Vision image builds without optional model runtimes, and only intended suite changes remain.

- [ ] **Step 5: Commit release documentation and evidence**

~~~bash
git add hosted/README.md creative-vision/README.md creative-worker/README.md docs/architecture/current-runtime-state.md hosted/tests/creative-suite-deployment-boundary.test.ts creative-vision/tests/test_deployment_boundary.py
git commit -m "docs(creative): add suite release runbook"
~~~

## Plan self-review

- Spec coverage: Task 1 creates the durable contract; Tasks 2 and 3 deliver Director and Workflow; Task 4 delivers isolated CPU-safe Vision; Tasks 5 and 6 expose the hosted experience; Task 7 verifies isolation and release readiness.
- Placeholder scan: each task names files, commands, tests, and concrete interfaces; it has no generic completion steps.
- Type consistency: WorkflowGraphV2, VisionOperation, VisionJob, DirectorProposal, StudioRepository, createStudioApi, and worker claim processors are introduced before their consumers.

## Execution handoff

Execute Tasks 1 through 7 in order. After each task, run its focused tests, inspect the staged diff, and commit before starting the next task. Do not apply the Supabase migration, create the Railway service, configure production variables, push, or deploy until all local verification succeeds and the owner authorizes the production release.
