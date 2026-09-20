# Hosted Tiny Soho Creative Studio Design

## Goal

Ship a separate, owner-only Tiny Soho Creative Studio at its own Vercel project and URL. The first hosted release creates and retains motion-generation projects, uploads private source frames, submits supported Alibaba Wan image-to-video work, and makes completed videos available for download.

The existing root application remains the local studio. Its SQLite database, Mac filesystem, Vision sidecar, local FFmpeg composition, Director, and workflow editor remain local-only and are not moved or weakened by this release.

## Scope

### Included

- A new Next.js application under `hosted/`, deployed from that directory as its own Vercel project.
- Existing Tiny Soho Supabase Auth with password sign-in, session persistence, and an explicit owner-email allowlist.
- A hosted Motion page for Wan 2.7 I2V and Wan 3 image-to-video generation using a required start frame and optional end frame.
- Private Supabase Storage for input frames and completed video outputs.
- Three new Supabase tables: `creative_studio_projects`, `creative_studio_assets`, and `creative_studio_jobs`.
- Server-side model validation, safe Alibaba request serialization, provider polling, durable job state, idempotency, and download URLs.
- A Vercel deployment, production environment configuration, database migration, health check, and authenticated browser smoke test.

### Deliberately deferred

- Hosted Director, workflows, storyboard batching, image generation, reference-video/audio inputs, Vision sidecar features, and FFmpeg composition.
- A permanently running polling process, Vercel Cron, queues, or a Railway worker. Job status is synchronized by a protected request while the Studio page is open and again when the owner returns.
- Public sharing, multi-user collaboration, customer-facing access, and any Instagram or guide-delivery automation change.

## Chosen architecture

`hosted/` is an independent Next.js app inside the existing Git repository. Vercel's project Root Directory is `hosted`; it does not build or run the root local studio. The hosted app uses the same active Tiny Soho Supabase project as the existing admin console, but all new state has a `creative_studio_` namespace and a separate private Storage bucket named `creative-studio`.

The browser may use only the Supabase publishable key for login. All Studio reads, writes, asset uploads, asset downloads, Alibaba calls, and signed URL creation go through hosted Next.js route handlers. Each route validates the bearer token with Supabase Auth and checks the user email against `TINY_SOHO_STUDIO_ADMIN_EMAILS`. The Supabase service-role key is server-only and never reaches the browser.

The hosted server performs both submission and status synchronization. On submission it validates the project, assets, media roles, model options, and free-quota confirmation; creates or retrieves the idempotent job; reads private inputs from Storage; and sends the model-specific request to Alibaba. When a browser polls a job, the route checks Alibaba if it has a provider task ID. A successful result is downloaded immediately to the private bucket before the temporary Alibaba URL expires. Returning to the Studio repeats synchronization for non-terminal jobs, so a closed browser cannot lose task state.

## Data model

All three tables live in `public`, have RLS enabled, and deliberately have no browser-access policies. The hosted server uses the service role after authenticating and allowlisting the caller itself. This avoids exposing Studio rows or Storage objects through the Data API, while retaining RLS as a fail-closed guard against accidental direct client access.

`creative_studio_projects`

- `id uuid primary key`, `owner_user_id uuid not null`, `name text not null`, `canvas text not null default '1080x1920'`, `free_quota_models jsonb not null default '[]'`, `free_quota_confirmed_at jsonb not null default '{}'`, `created_at timestamptz not null`, and `updated_at timestamptz not null`.
- Index `(owner_user_id, updated_at desc)`.

`creative_studio_assets`

- `id uuid primary key`, `project_id uuid not null references creative_studio_projects(id) on delete cascade`, `owner_user_id uuid not null`, `kind text not null`, `name text not null`, `mime_type text not null`, `object_path text not null unique`, `byte_size bigint not null`, `width integer`, `height integer`, `duration_seconds numeric`, `sha256 text not null`, `provenance jsonb not null`, and `created_at timestamptz not null`.
- Index `(project_id, created_at desc)`.
- Object paths are server-generated and begin `owners/<owner-user-id>/projects/<project-id>/`.

`creative_studio_jobs`

- `id uuid primary key`, `project_id uuid not null references creative_studio_projects(id) on delete cascade`, `owner_user_id uuid not null`, `idempotency_key uuid not null`, `fingerprint text not null`, `model_id text not null`, `task text not null`, `prompt text not null`, `input_assets jsonb not null`, `options jsonb not null`, `status text not null`, `provider_task_id text`, `output_asset_id uuid references creative_studio_assets(id)`, `error_code text`, `error_message text`, `created_at timestamptz not null`, and `updated_at timestamptz not null`.
- A unique constraint on `(project_id, idempotency_key)` and an index on `(owner_user_id, status, updated_at desc)`.
- Status values: `queued`, `submitting`, `submitted`, `running`, `downloading`, `completed`, `failed`, `needs_attention`, and `canceled`.
- The fingerprint binds the model, prompt, media role/asset IDs, and normalized options. Reusing an idempotency key with a different fingerprint is rejected.

The `creative-studio` bucket is private, has a restrictive file-size limit, and permits only image and MP4 MIME types required by this release. It receives no broad `anon` or `authenticated` object policies. The server returns short-lived signed download URLs only after ownership and allowlist checks.

## API and browser flow

1. The unauthenticated browser displays a Tiny Soho password sign-in form backed by the existing Supabase Auth project.
2. A signed-in non-allowlisted account receives a generic access-denied page and none of the Studio API routes disclose project or provider data.
3. The owner creates or selects a project. The app lists only that owner's Studio projects and assets.
4. The owner uploads a PNG, JPEG, or WebP frame. The API rejects unsupported MIME types, oversized input, undecodable dimensions, or images beyond the configured pixel cap; it hashes the bytes, writes the private object, and records an asset row.
5. The owner selects Wan 2.7 I2V or Wan 3 Video, a start frame, an optional end frame, prompt, permitted duration/resolution, and (for Wan 3) aspect ratio. A setting explicitly records which exact models have Free Quota Only enabled in Alibaba; an unchecked model cannot submit.
6. `POST /api/jobs` validates and claims the idempotency key, sends the Alibaba request, and returns the durable job. It does not return Alibaba response bodies, credentials, or arbitrary provider URLs.
7. The browser polls `GET /api/jobs/<id>`. For pending work, this route synchronizes with Alibaba and records state changes. On success, it downloads the provider result into private Storage, creates a generated asset record, marks the job completed, and returns a short-lived signed URL.
8. The job history shows terminal state, safe failure text, and a signed result link. It never exposes another owner's asset path or job.

## Provider and safety rules

The hosted provider serializer is derived from the local studio's tested model contract but is owned by `hosted/`; the local application is not imported or bundled by Vercel. It supports only:

- Wan 2.7 I2V with `start-image` or `start-image` plus `end-image`, 2-15 seconds, 720P or 1080P.
- Wan 3 Video with the same first/last-frame roles, 2-30 seconds, 480P/720P/1080P, and the allowed Wan 3 ratios.

Every request uses a Singapore-region workspace endpoint and sets the asynchronous DashScope header for video generation. Server code has explicit request and provider polling timeouts. Provider error handling records a safe code/message only; it does not persist headers, provider bodies, source frames, or credentials in logs.

The Free Quota confirmation is a deliberate owner setting, not an inference from the selected model. The app has no paid-model fallback.

## Hosted application structure

- `hosted/app/` contains the owner-facing Motion UI, login UI, and protected API route handlers.
- `hosted/lib/auth.ts` owns bearer-token verification and email allowlist enforcement.
- `hosted/lib/db.ts` owns service-role database calls and maps raw rows to narrow Studio types.
- `hosted/lib/storage.ts` owns path creation, validation, object writes, provider-result ingestion, and signed URLs.
- `hosted/lib/models.ts`, `hosted/lib/generation.ts`, and `hosted/lib/alibaba.ts` own the hosted model catalogue, preflight validation, serialization, submission, and task polling.
- `hosted/lib/settings.ts` reads and writes the `creative_studio_projects.free_quota_models` and `free_quota_confirmed_at` fields. Confirmation is project-scoped: every new project begins with no confirmed model, and each job stores the effective confirmation state in its options for auditability.

## Error handling and recovery

- Unauthorized, expired, malformed, or non-allowlisted sessions get `401` or `403` without revealing whether a resource exists.
- An idempotency key replay returns the original identical job; a mismatched replay is `409`.
- If Alibaba accepts submission but the response cannot be classified, the job becomes `needs_attention`; the route never blindly resubmits it.
- If a task is still pending, repeated reads are safe. Completed jobs do not call Alibaba again.
- If ingesting a successful provider result fails, the job stays `needs_attention` with a safe recovery message and can be explicitly retried from the same provider task ID.
- Upload cleanup deletes a private object only when its matching database insertion fails; it never lists or deletes a bucket prefix.

## Verification and release criteria

Automated tests must cover allowlist enforcement, cross-owner rejection, input validation, model/media preflight, idempotency conflict behavior, provider payloads, safe provider error mapping, result ingestion, and signed-URL authorization. Each new behavior follows a failing-test then minimal-implementation cycle.

Before production release, run the hosted unit suite, TypeScript check, production build, and a local authenticated smoke test against a disposable/no-provider submission path. Apply the reviewed migration to the active Tiny Soho Supabase project; inspect the resulting tables, bucket privacy, RLS, and advisors. Configure a new Vercel project with `hosted/` as its root, production-only server secrets, and the production Supabase URL/publishable key. Deploy the exact pushed commit, verify Vercel's deployed SHA and health endpoint, then perform an authenticated production smoke test that creates a project and uploads a harmless test frame without submitting a paid generation. A live Alibaba generation requires the owner to have enabled Free Quota Only for the selected model; it is separately verified only when that is true.

## Non-goals and release boundary

This release does not alter `insta-automation`, its Vercel project, Railway workers, Supabase tables, Meta integration, or public guide assets. It does not transfer or delete local Studio media. A successful Vercel deployment alone is not a verified generation; provider completion and Storage ingestion remain distinct checks.
