# Hosted Tiny Soho Creative Suite Design

## Goal

Complete the owner-only hosted Tiny Soho Creative Studio by making the existing local **AI Director**, **Workflow Studio**, and **Vision Lab** available from the Vercel application as durable cloud workflows. The release must preserve the existing Singapore video catalogue, private Supabase media model, explicit model acknowledgement, and Instagram automation isolation.

This is a functional port. It does not add navigation links to local-only routes or present unavailable model capabilities as usable.

## Decision

Use four isolated responsibilities:

| Component | Responsibility | Credentials |
| --- | --- | --- |
| Vercel `hosted/` | Authenticated owner UI and request validation | Supabase service role only, server-side |
| Supabase | Owner-scoped state, queues, and private `creative-studio` objects | No browser Data API policies for Creative rows or Storage objects |
| Existing Railway `creative-worker` | Director drafts, proposal approval fan-out, workflow scheduling, and Wan video jobs | Supabase service role and Alibaba credentials |
| New Railway `creative-vision` | Vision queue processing, deterministic image overlays, and FFmpeg composition | Supabase service role, no Alibaba or Instagram credentials |

`creative-vision` is a separate service in the existing isolated Tiny Soho Creative Railway project. It is not part of the Instagram Railway project and has no Meta, Instagram, or automation configuration.

## Owner experience

The authenticated Creative Studio navigation contains five functional sections:

1. **Motion** — the existing Singapore Wan model picker and job history.
2. **Assets** — the existing private source and generated asset library.
3. **Director** — a brief creates an immutable, reviewable proposal; approval alone creates video jobs.
4. **Workflows** — the owner saves a versioned directed graph and explicitly starts a durable run.
5. **Vision Lab** — the owner can inspect real capability availability, queue a typography-protection operation, and review derived assets and composed outputs.

The dashboard never renders a control for a route that is not deployed. Each section shows an owner-safe recovery message and the durable record status rather than relying on in-memory browser state.

## Director

### Behaviour

- `POST /api/director/drafts` accepts an owned project and short creative brief, validates both, and inserts a queued Director request. It returns a proposal-request identifier; it never calls Alibaba from Vercel.
- `creative-worker` claims the request, reads only a sanitized manifest of the project's owned assets, and asks the configured Qwen endpoint for structured JSON.
- The worker validates the response against the same versioned hosted video catalogue used by Motion. Unknown model IDs, cross-project asset IDs, invalid media roles, and malformed options are rejected before a proposal can be saved.
- The resulting `creative_studio_director_proposals` row stores a versioned JSON snapshot, a safe summary, evidence references when configured, and a content fingerprint. It is immutable after draft completion.
- `POST /api/director/proposals/<id>/approve` re-validates the exact snapshot, checks the project/model acknowledgements, and atomically creates idempotent `creative_studio_jobs` records. A Director draft cannot submit video on its own.

### Data

`creative_studio_director_requests` contains owner, project, brief, status, lease metadata, safe error fields, and timestamps. `creative_studio_director_proposals` contains owner, project, request, snapshot JSON, fingerprint, status (`drafted`, `approved`, `failed`, `canceled`), approval timestamp, and timestamps. Both have owner/project/status indexes, RLS enabled, no browser table policies, and service-role-only claim RPC access.

Creative knowledge retrieval remains optional. If it is not configured or returns no permitted evidence, the proposal declares that fact and still requires the owner to review it.

## Workflow Studio

### Behaviour

- The browser uses a graph editor with explicit asset and named media ports; it does not execute a graph in the browser.
- `POST /api/workflows` normalizes and validates a version-2 acyclic graph before saving an immutable workflow version. A graph may contain owned asset, prompt-template/no-op, and supported generate-video nodes. Unsupported vision nodes are retained only when the Vision capability contract declares them available; otherwise validation reports the unavailable requirement before the run starts.
- `POST /api/workflows/<id>/runs` snapshots the selected workflow, project, and starting asset IDs into a queued run. Replaying the same run key returns the same run rather than duplicating jobs.
- `creative-worker` claims and advances workflow runs. It waits for upstream generation jobs, propagates a terminal upstream failure, and creates one idempotent video job per eligible generation node. It never silently skips a node or submits a second job after a restart.
- The UI polls the persisted run state and links outputs through owned Creative asset IDs.

### Data

`creative_studio_workflows` contains owner, optional project scope, name, graph JSON, graph version, graph fingerprint, and timestamps. `creative_studio_workflow_runs` contains owner, workflow version, project, immutable graph snapshot, idempotency key, status (`queued`, `running`, `completed`, `failed`, `needs_attention`, `canceled`), node-state JSON, and timestamps. Run state holds job and output asset IDs only; it does not copy signed URLs or provider responses.

The migration adds owner/project/status indexes, RLS with no browser Data API policies, and a narrow `claim_creative_studio_workflow_run()` function restricted to `service_role`.

## Vision Lab

### Service boundary

The local loopback sidecar cannot be hosted unchanged: it binds to `127.0.0.1`, uses local filesystem artifacts, and assumes Mac-local FFmpeg and optional runtimes. `creative-vision` replaces that boundary with a stateless Railway Docker service that:

- binds its health endpoint to the Railway-provided network interface;
- claims only `creative_studio_vision_jobs` through a `service_role`-only Supabase RPC;
- reads one owned private source object using a short-lived signed URL;
- writes only new owner/project-scoped objects under `owners/<owner-id>/projects/<project-id>/vision/<job-id>/`;
- writes metadata and output asset IDs back to Supabase; and
- never accepts unauthenticated browser processing requests or receives Alibaba/Meta credentials.

Vercel creates and reads Vision jobs after owner authentication. The browser never calls the Railway processor directly.

### Initial deployed capabilities

The initial Docker image includes Python 3.11, Pillow, and FFmpeg. It provides these honest, CPU-safe operations:

- image inspection and source validation;
- deterministic typography overlay creation from owner-reviewed regions;
- generation-plate construction from the owned source and overlay/mask artifacts;
- FFmpeg composition of an owned raw video with a fixed transparent overlay; and
- a capability endpoint reporting real service/version/runtime availability.

OCR, SAM2 segmentation, and Qwen layered-image extraction retain their existing explicit optional-runtime contracts. They remain `unavailable` until their packages, weights, hardware, and licensing conditions are configured. The release does not download weights, enable a paid remote inference endpoint, or pretend GPU functionality exists.

If later enabled, GPU inference is a second Vision worker profile/service with the same Supabase queue and artifact contracts. It does not change Vercel, the Director, the video worker, or Instagram automation.

### Data and assets

`creative_studio_vision_jobs` contains owner, project, source asset, operation (`inspect`, `overlay`, `plate`, `compose`, `ocr`, `segment`, `layers`), normalized options JSON, input artifact IDs, status, output asset IDs, safe error fields, lease metadata, and timestamps. Its claim RPC follows the existing `FOR UPDATE SKIP LOCKED`, fixed-search-path, service-role-only pattern.

`creative_studio_vision_capabilities` is a service-owned status table keyed by capability ID. It records the Vision service version, status (`available` or `unavailable`), a safe reason, and a refresh timestamp. `creative-vision` upserts it at startup and whenever an optional runtime state changes. Vercel reads it only after owner authentication, so the browser does not need a direct Railway connection.

`creative_studio_assets` expands its validated kind/mime contract only for `derived-image` and `derived-video`. Their `provenance` records the Vision job, operation, source asset IDs, dimensions, and tool version; no signed URL, raw source bytes, credentials, or provider response is stored in the database. Existing source and generated-video rows remain valid without rewrite.

## Shared security and recovery rules

- Every Vercel route calls the existing bearer-token owner allowlist before accessing a record. Repository methods query both resource ID and `owner_user_id`.
- New tables use UUID foreign keys, RLS, append-only safe events where lifecycle audit is needed, and no anonymous or authenticated browser policies.
- A queue claim is lease-based and idempotent. A worker restart recovers expired work; it cannot process another owner's record.
- Asset checks enforce same-project ownership and expected media kinds at every transition. Storage is private; download links are short-lived and owner-authorized.
- Director and Workflow approval use the existing model acknowledgements and hosted `preflightVideoGeneration` contract. There is no provider fallback and no automatic paid generation.
- Error records use stable safe codes/messages. They do not contain prompts beyond their durable user-owned record, source bytes, headers, signed URLs, credentials, or raw Alibaba/Qwen responses.
- No `insta-automation` source, deployment, environment variable, Supabase table, bucket, trigger, or queue is changed.

## User interface and routes

- Refactor `HostedStudio` into a small authenticated shell with stable navigation and feature routes/components for Motion, Assets, Director, Workflows, and Vision.
- Extend the browser API client with typed request/read methods for proposals, workflow versions/runs, and Vision jobs/capabilities.
- Preserve the current Motion state and model picker. The new navigation must not reload or discard an unsent Motion form without an explicit owner action.
- The Director page displays the proposal's exact model/media choices, evidence availability, and approval status.
- The Workflow page shows graph validation errors adjacent to the invalid node/edge and persisted run state per node.
- The Vision page shows operation-specific required inputs and actual capability reasons, including the distinction between installed CPU processing and unavailable optional inference.

## Verification

Automated coverage must include:

- owner/auth rejection, cross-owner resource rejection, and absence of browser credentials;
- Director request idempotency, sanitized manifest construction, malformed proposal rejection, immutable approval, and no job before approval;
- graph cycle/port validation, same-project asset enforcement, node idempotency, wait/resume after job completion, and failure propagation;
- Vision job validation, private signed-input handling, safe output/provenance persistence, FFmpeg argument construction, and accurate unavailable capability reporting;
- migration contracts for every table/index/RPC/RLS restriction and the `creative-studio` bucket's continued privacy;
- hosted and worker type checks, builds, unit suites, and the Vision Python tests/container build.

Release verification must use an authenticated owner account to create a project, upload a harmless source asset, draft but not approve a Director proposal, save and validate a non-generating workflow, and run a non-provider Vision overlay path. A real Alibaba/Qwen call or optional-model inference is a separate owner-controlled, potentially billable verification and is not performed merely to deploy.

## Explicit non-goals

- Public access, multi-user collaboration, public asset URLs, and iframe access to the old local app.
- Automatic video generation from a Director brief or workflow without the required acknowledgement and explicit owner action.
- Rehosting local SQLite files, existing Mac asset folders, local Vision caches, or model checkpoints.
- Silent CPU-to-GPU or free-to-paid provider fallback.
- Any Instagram automation change.
