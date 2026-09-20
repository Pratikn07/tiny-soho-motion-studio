# Hosted Tiny Soho Creative Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy an owner-only Tiny Soho Motion Studio as a separate Vercel application that uses the existing Tiny Soho Supabase project for Auth, private media storage, durable projects, and Wan generation jobs.

**Architecture:** Add an independent Next.js app in `hosted/` and configure the new Vercel project to use that directory as its Root Directory. Its browser authenticates through the existing Supabase Auth project and calls same-origin routes with a bearer token; those routes validate the owner allowlist and use a server-only Supabase service client. New namespaced tables plus a private bucket persist all hosted state while the root local Studio remains unchanged.

**Tech Stack:** Next.js 15.5.25, React 19.1.1, TypeScript 5.9.2, Vitest 5.0.1, Zod 3.25.76, Supabase Auth/Postgres/Storage, Alibaba Model Studio Wan, Vercel Node.js 24.

**Spec:** `docs/superpowers/specs/2026-09-20-hosted-creative-studio-design.md`

## Global Constraints

- The Vercel project Root Directory is `hosted`; do not deploy the repository root local studio.
- Keep all provider, Supabase service-role, and owner-allowlist values server-only; never place them in `NEXT_PUBLIC_*` variables or write them to source, tests, logs, or chat.
- The only browser-exposed Supabase values are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Preserve the root local Studio, its SQLite data, local `server/worker.ts`, Vision sidecar, FFmpeg composition, and all existing tests without modification.
- Do not modify `insta-automation`, its Vercel project, Railway workers, Meta integration, or its existing Supabase tables, Storage paths, triggers, policies, or configuration.
- Add only `creative_studio_projects`, `creative_studio_assets`, and `creative_studio_jobs`, and only the private `creative-studio` bucket to the active Tiny Soho Supabase project.
- Hosted MVP supports only Wan 2.7 I2V and Wan 3 Video with a required start image and optional end image. It has no paid-model fallback.
- Each mutation validates the caller via Supabase `auth.getUser(token)`, checks `TINY_SOHO_STUDIO_ADMIN_EMAILS`, scopes every database query by `owner_user_id`, and uses an idempotency UUID for generation creation.
- Every new production behavior starts with a focused Vitest that fails for the expected missing behavior, then receives the smallest implementation needed to pass.
- Do not create a Vercel project, configure Vercel production variables, apply the Supabase migration, or submit a live Alibaba generation until all local hosted-app tests, TypeScript checks, and production build succeed.

---

### Task 1: Create the isolated hosted application shell

**Files:**

- Create: `hosted/package.json`
- Create: `hosted/package-lock.json`
- Create: `hosted/tsconfig.json`
- Create: `hosted/next.config.mjs`
- Create: `hosted/vitest.config.ts`
- Create: `hosted/.gitignore`
- Create: `hosted/.env.example`
- Create: `hosted/app/layout.tsx`
- Create: `hosted/app/globals.css`
- Create: `hosted/app/page.tsx`
- Create: `hosted/tests/app-shell.test.ts`

**Interfaces:**

- Consumes: no hosted application code.
- Produces: a self-contained Next.js project whose `npm run test`, `npm run check`, and `npm run build` run from `hosted/` without importing the root local Studio.

- [ ] **Step 1: Write the failing shell boundary test**

```ts
// hosted/tests/app-shell.test.ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("hosted Studio app shell", () => {
  it("has an independent Next package and does not run the local worker", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(manifest.name).toBe("tiny-soho-hosted-creative-studio");
    expect(manifest.scripts.dev).not.toMatch(/server\/worker/);
    expect(manifest.scripts.start).not.toMatch(/server\/worker/);
  });
});
```

- [ ] **Step 2: Run the test to verify the expected red failure**

Run: `cd hosted && npm test -- tests/app-shell.test.ts`

Expected: FAIL because `hosted/package.json` does not exist.

- [ ] **Step 3: Create the minimal independent Next application**

```json
// hosted/package.json
{
  "name": "tiny-soho-hosted-creative-studio",
  "private": true,
  "version": "0.1.0",
  "engines": { "node": "24.x" },
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1 --port 3002",
    "build": "next build",
    "start": "next start --hostname 127.0.0.1 --port 3002",
    "check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "2.106.2",
    "next": "15.5.25",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@types/node": "24.3.0",
    "@types/react": "19.1.12",
    "@types/react-dom": "19.1.9",
    "typescript": "5.9.2",
    "vitest": "5.0.1"
  }
}
```

```ts
// hosted/app/page.tsx
export default function Home() {
  return <main><h1>Tiny Soho Motion Studio</h1><p>Sign in to create typography-safe motion.</p></main>;
}
```

Set the TypeScript alias `@/*` to `./*`, configure Vitest to include `tests/**/*.test.ts`, and add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TINY_SOHO_STUDIO_ADMIN_EMAILS`, `DASHSCOPE_API_KEY`, and `ALIBABA_WORKSPACE_ID` as empty names only in `.env.example`.

- [ ] **Step 4: Install and verify the green shell**

Run: `cd hosted && npm install && npm test -- tests/app-shell.test.ts && npm run check && npm run build`

Expected: all commands exit 0; the build emits a standalone hosted homepage and no local worker process starts.

- [ ] **Step 5: Commit the shell**

```bash
git add hosted
git commit -m "feat: add hosted creative studio shell"
```

### Task 2: Create the namespaced Supabase schema and private media bucket

**Files:**

- Create via `supabase migration new hosted_creative_studio`: the generated `supabase/migrations/*_hosted_creative_studio.sql`
- Create: `hosted/tests/schema-contract.test.ts`
- Modify: `hosted/.env.example`

**Interfaces:**

- Consumes: the active Supabase project `kukpvpklizsvedcmybhn` and the server environment names created in Task 1.
- Produces: three new server-only tables and a private `creative-studio` bucket with no browser policies.

- [ ] **Step 1: Write the migration contract test**

```ts
// hosted/tests/schema-contract.test.ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

describe("hosted Studio schema", () => {
  it("creates only the namespaced tables and a private media bucket", async () => {
    const files: string[] = [];
    for await (const file of glob(new URL("../../supabase/migrations/*_hosted_creative_studio.sql", import.meta.url))) files.push(String(file));
    expect(files).toHaveLength(1);
    const sql = await readFile(files[0], "utf8");
    expect(sql).toContain("create table public.creative_studio_projects");
    expect(sql).toContain("create table public.creative_studio_assets");
    expect(sql).toContain("create table public.creative_studio_jobs");
    expect(sql).toContain("values ('creative-studio', 'creative-studio', false");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toMatch(/create policy/i);
  });
});
```

- [ ] **Step 2: Run the test to verify the expected red failure**

Run: `cd hosted && npm test -- tests/schema-contract.test.ts`

Expected: FAIL because no hosted Studio migration exists.

- [ ] **Step 3: Generate and fill the migration**

Run: `supabase migration new hosted_creative_studio --workdir .`

Put this SQL in the generated migration file:

```sql
create extension if not exists pgcrypto;

create table public.creative_studio_projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  canvas text not null default '1080x1920',
  free_quota_models jsonb not null default '[]'::jsonb,
  free_quota_confirmed_at jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index creative_studio_projects_owner_updated_idx on public.creative_studio_projects (owner_user_id, updated_at desc);

create table public.creative_studio_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  kind text not null check (kind in ('source-image', 'generated-video')),
  name text not null check (char_length(btrim(name)) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4')),
  object_path text not null unique,
  byte_size bigint not null check (byte_size > 0),
  width integer,
  height integer,
  duration_seconds numeric,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index creative_studio_assets_project_created_idx on public.creative_studio_assets (project_id, created_at desc);

create table public.creative_studio_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  idempotency_key uuid not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  model_id text not null,
  task text not null check (task = 'image-to-video'),
  prompt text not null check (char_length(prompt) between 1 and 5000),
  input_assets jsonb not null,
  options jsonb not null,
  status text not null check (status in ('queued', 'submitting', 'submitted', 'running', 'downloading', 'completed', 'failed', 'needs_attention', 'canceled')),
  provider_task_id text,
  output_asset_id uuid references public.creative_studio_assets(id),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);
create index creative_studio_jobs_owner_status_updated_idx on public.creative_studio_jobs (owner_user_id, status, updated_at desc);

alter table public.creative_studio_projects enable row level security;
alter table public.creative_studio_assets enable row level security;
alter table public.creative_studio_jobs enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creative-studio', 'creative-studio', false, 262144000, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
```

- [ ] **Step 4: Run the schema test and inspect the migration**

Run: `cd hosted && npm test -- tests/schema-contract.test.ts && git diff --check`

Expected: the contract passes and the migration contains no policy, trigger, or reference to existing automation tables.

- [ ] **Step 5: Commit the schema migration**

```bash
git add supabase/migrations hosted/tests/schema-contract.test.ts
git commit -m "feat: add hosted creative studio schema"
```

### Task 3: Build the owner authentication and server data boundary

**Files:**

- Create: `hosted/lib/env.ts`
- Create: `hosted/lib/auth.ts`
- Create: `hosted/lib/supabase-server.ts`
- Create: `hosted/lib/types.ts`
- Create: `hosted/lib/errors.ts`
- Create: `hosted/tests/auth.test.ts`
- Create: `hosted/app/api/health/route.ts`

**Interfaces:**

- Consumes: `Authorization: Bearer <Supabase access token>` and server environment variables.
- Produces: `requireOwner(request): Promise<{ userId: string; email: string }>` and `healthResponse(): { ok: true; configured: boolean }`.

- [ ] **Step 1: Write failing auth tests**

```ts
// hosted/tests/auth.test.ts
import { describe, expect, it } from "vitest";
import { ownerFromAuthorization } from "@/lib/auth";

const user = { id: "8db9e0d7-089a-4f7c-a248-9a4d7199c10f", email: "owner@tinysoho.test" };

describe("hosted Studio owner authentication", () => {
  it("accepts an allowlisted Supabase user", async () => {
    await expect(ownerFromAuthorization("Bearer valid", async () => ({ data: { user }, error: null }), [user.email!]))
      .resolves.toEqual({ userId: user.id, email: user.email });
  });

  it("rejects a missing token and a valid non-owner token without exposing data", async () => {
    await expect(ownerFromAuthorization(undefined, async () => ({ data: { user }, error: null }), [user.email!])).rejects.toMatchObject({ status: 401, code: "missing_bearer_token" });
    await expect(ownerFromAuthorization("Bearer valid", async () => ({ data: { user }, error: null }), ["other@tinysoho.test"])).rejects.toMatchObject({ status: 403, code: "not_allowed" });
  });
});
```

- [ ] **Step 2: Run the focused red test**

Run: `cd hosted && npm test -- tests/auth.test.ts`

Expected: FAIL because `@/lib/auth` does not exist.

- [ ] **Step 3: Implement strict configuration and auth**

```ts
// hosted/lib/errors.ts
export class StudioError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StudioError";
  }
}

// hosted/lib/auth.ts
import { StudioError } from "@/lib/errors";

export type UserLookup = (token: string) => Promise<{ data: { user: { id: string; email?: string } | null }; error: unknown }>;

export async function ownerFromAuthorization(header: string | null | undefined, getUser: UserLookup, allowlist: readonly string[]) {
  if (!header?.startsWith("Bearer ")) throw new StudioError(401, "missing_bearer_token", "Authentication is required.");
  const token = header.slice(7).trim();
  if (!token) throw new StudioError(401, "empty_bearer_token", "Authentication is required.");
  const { data, error } = await getUser(token);
  if (error || !data.user?.email) throw new StudioError(401, "invalid_token", "Authentication is required.");
  const email = data.user.email.toLowerCase();
  if (!allowlist.includes(email)) throw new StudioError(403, "not_allowed", "Studio access is not available for this account.");
  return { userId: data.user.id, email };
}
```

`env.ts` must throw at server startup when any server-only setting is absent, split the comma-separated allowlist to lower-case values, and expose only a boolean configuration status to `/api/health`. `supabase-server.ts` must use `createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })` and must be imported only from route handlers or other server-only modules.

- [ ] **Step 4: Verify authentication and configuration behavior**

Run: `cd hosted && npm test -- tests/auth.test.ts && npm run check`

Expected: both commands exit 0; no test contains a real token, key, or email.

- [ ] **Step 5: Commit the data boundary**

```bash
git add hosted/lib hosted/app/api/health hosted/tests/auth.test.ts
git commit -m "feat: add hosted studio owner boundary"
```

### Task 4: Add project, settings, and private asset repositories

**Files:**

- Create: `hosted/lib/repository.ts`
- Create: `hosted/lib/storage.ts`
- Create: `hosted/lib/image.ts`
- Create: `hosted/tests/repository.test.ts`
- Create: `hosted/tests/storage.test.ts`
- Create: `hosted/app/api/projects/route.ts`
- Create: `hosted/app/api/projects/[id]/route.ts`
- Create: `hosted/app/api/assets/route.ts`
- Create: `hosted/app/api/assets/[id]/download/route.ts`

**Interfaces:**

- Consumes: authenticated owner context from Task 3 and files restricted to PNG, JPEG, and WebP.
- Produces: owner-scoped `StudioRepository`, `uploadSourceImage`, `signAssetDownload`, and route handlers returning only public Studio records.

- [ ] **Step 1: Write failing owner-scope and asset-validation tests**

```ts
// hosted/tests/repository.test.ts
import { describe, expect, it } from "vitest";
import { projectFilter, visibleAsset } from "@/lib/repository";

describe("hosted Studio repository ownership", () => {
  it("always scopes project queries to the authenticated owner", () => {
    expect(projectFilter("owner-a")).toEqual({ owner_user_id: "owner-a" });
  });
  it("does not expose an asset belonging to another owner", () => {
    expect(visibleAsset({ id: "asset-a", owner_user_id: "owner-a" }, "owner-b")).toBeNull();
  });
});
```

```ts
// hosted/tests/storage.test.ts
import { describe, expect, it } from "vitest";
import { validateSourceImage } from "@/lib/storage";

describe("hosted Studio source images", () => {
  it("rejects an executable disguised as a source image", async () => {
    await expect(validateSourceImage(new File(["not-an-image"], "frame.png", { type: "image/png" }))).rejects.toThrow(/readable image/i);
  });
});
```

- [ ] **Step 2: Run the focused red tests**

Run: `cd hosted && npm test -- tests/repository.test.ts tests/storage.test.ts`

Expected: FAIL because repository and storage modules do not exist.

- [ ] **Step 3: Implement owner-scoped persistence and media operations**

```ts
// hosted/lib/repository.ts
export const projectFilter = (ownerUserId: string) => ({ owner_user_id: ownerUserId });
export const visibleAsset = <T extends { owner_user_id: string }>(asset: T | null, ownerUserId: string) => asset?.owner_user_id === ownerUserId ? asset : null;
```

Implement all `StudioRepository` methods with `eq("owner_user_id", owner.userId)` in addition to the resource ID: list/create project, update a project's quota confirmation values, list/create/get asset, list/create/get/update job. Asset upload must validate byte size at or below 20 MiB, MIME allowlist, decoded width/height, and a 40,000,000 pixel cap before it computes SHA-256 and writes an object. Generate paths as `owners/${ownerId}/projects/${projectId}/sources/${assetId}-${safeFilename}` and never accept a browser path. On database insert failure, delete only the just-written object path. Download routes create a five-minute signed URL only after `visibleAsset` succeeds.

- [ ] **Step 4: Verify data and asset boundary behavior**

Run: `cd hosted && npm test -- tests/repository.test.ts tests/storage.test.ts && npm run check`

Expected: both tests pass; TypeScript rejects any asset read that omits owner context.

- [ ] **Step 5: Commit persistence and assets**

```bash
git add hosted/lib hosted/app/api/projects hosted/app/api/assets hosted/tests
git commit -m "feat: add hosted studio projects and assets"
```

### Task 5: Port the narrow Wan image-to-video contract

**Files:**

- Create: `hosted/lib/models.ts`
- Create: `hosted/lib/generation.ts`
- Create: `hosted/lib/alibaba.ts`
- Create: `hosted/tests/generation.test.ts`
- Create: `hosted/tests/alibaba.test.ts`

**Interfaces:**

- Consumes: owned source-image asset records and the Alibaba server environment.
- Produces: `preflightGeneration`, `generationFingerprint`, `submitWanJob`, and `checkWanTask`.

- [ ] **Step 1: Write failing model-preflight and provider-payload tests**

```ts
// hosted/tests/generation.test.ts
import { describe, expect, it } from "vitest";
import { preflightGeneration } from "@/lib/generation";

describe("hosted Wan image-to-video preflight", () => {
  it("requires a start frame before a Wan 2.7 job exists", () => {
    expect(() => preflightGeneration({ modelId: "wan2.7-i2v", prompt: "Gentle movement", media: [], options: { duration: 5, resolution: "720P" }, freeQuotaModels: ["wan2.7-i2v"] })).toThrow(/start image/i);
  });
  it("rejects a model without an explicit Free Quota confirmation", () => {
    expect(() => preflightGeneration({ modelId: "wan3-video", prompt: "Gentle movement", media: [{ assetId: "start", role: "start-image" }], options: { duration: 5, resolution: "720P", aspectRatio: "9:16" }, freeQuotaModels: [] })).toThrow(/free quota/i);
  });
});
```

```ts
// hosted/tests/alibaba.test.ts
import { describe, expect, it, vi } from "vitest";
import { submitWanJob } from "@/lib/alibaba";

describe("hosted Wan provider payload", () => {
  it("maps start and end media to first_frame and last_frame", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: { task_id: "task-1" } }), { status: 200 }));
    await submitWanJob({ modelId: "wan2.7-i2v", prompt: "Move", options: { duration: 5, resolution: "720P" } }, [{ role: "start-image", mimeType: "image/png", bytes: Buffer.from("start") }, { role: "end-image", mimeType: "image/png", bytes: Buffer.from("end") }], { apiKey: "test", workspaceId: "workspace", fetcher });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.input.media.map((entry: { type: string }) => entry.type)).toEqual(["first_frame", "last_frame"]);
  });
});
```

- [ ] **Step 2: Run the focused red tests**

Run: `cd hosted && npm test -- tests/generation.test.ts tests/alibaba.test.ts`

Expected: FAIL because hosted model and provider modules do not exist.

- [ ] **Step 3: Implement exactly the hosted MVP model contract**

Implement the two model records with these provider IDs and limits:

```ts
const MODELS = {
  "wan2.7-i2v": { providerModel: "wan2.7-i2v-2026-04-25", duration: [2, 15], resolutions: ["720P", "1080P"], endFrame: true },
  "wan3-video": { providerModel: "wan3.0-video", duration: [2, 30], resolutions: ["480P", "720P", "1080P"], ratios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], endFrame: true }
} as const;
```

`preflightGeneration` must trim and cap prompt length at 5,000 characters, require exactly one owned start image, permit at most one owned end image, restrict duration/resolution/ratio by model, and require project-confirmed free quota. `generationFingerprint` is SHA-256 over canonical JSON containing model ID, prompt, ordered asset IDs/roles, and normalized options. `submitWanJob` must set `X-DashScope-Async: enable`, use the Singapore workspace base URL, set `AbortSignal.timeout(60_000)`, and map only safe provider error code/message to a thrown `StudioError`. `checkWanTask` uses a 30-second timeout and returns only `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELED`, or `UNKNOWN` plus an optional result URL.

- [ ] **Step 4: Verify hosted generation contracts**

Run: `cd hosted && npm test -- tests/generation.test.ts tests/alibaba.test.ts && npm run check`

Expected: preflight and payload tests pass; no test or source contains real credentials.

- [ ] **Step 5: Commit the Wan contract**

```bash
git add hosted/lib/models.ts hosted/lib/generation.ts hosted/lib/alibaba.ts hosted/tests/generation.test.ts hosted/tests/alibaba.test.ts
git commit -m "feat: add hosted Wan generation contract"
```

### Task 6: Add idempotent job submission and provider synchronization routes

**Files:**

- Create: `hosted/lib/jobs.ts`
- Create: `hosted/app/api/jobs/route.ts`
- Create: `hosted/app/api/jobs/[id]/route.ts`
- Create: `hosted/tests/jobs.test.ts`

**Interfaces:**

- Consumes: authenticated owner, repository, Storage, and Wan contract from Tasks 3-5.
- Produces: `createOrGetJob`, `synchronizeJob`, `POST /api/jobs`, and `GET /api/jobs/:id`.

- [ ] **Step 1: Write failing idempotency and recovery tests**

```ts
// hosted/tests/jobs.test.ts
import { describe, expect, it } from "vitest";
import { createOrGetJob, synchronizeJob } from "@/lib/jobs";

describe("hosted Studio jobs", () => {
  it("returns the original job for an identical idempotency replay", async () => {
    const existing = { id: "job-1", fingerprint: "same", status: "submitted" };
    await expect(createOrGetJob({ find: async () => existing, create: async () => { throw new Error("must not create"); } }, { idempotencyKey: "ce82a151-4c9d-47b0-a112-48fa8bcbe9cf", fingerprint: "same" })).resolves.toEqual(existing);
  });
  it("marks provider success as needs_attention when result ingestion fails", async () => {
    const result = await synchronizeJob({ id: "job-1", status: "submitted", providerTaskId: "provider-1" }, { checkTask: async () => ({ status: "SUCCEEDED", outputUrl: "https://provider.test/result.mp4" }), ingestResult: async () => { throw new Error("storage unavailable"); }, update: async (patch) => ({ ...patch }) });
    expect(result).toMatchObject({ status: "needs_attention" });
  });
});
```

- [ ] **Step 2: Run the focused red tests**

Run: `cd hosted && npm test -- tests/jobs.test.ts`

Expected: FAIL because `@/lib/jobs` does not exist.

- [ ] **Step 3: Implement durable state transitions**

`createOrGetJob` must reject a same idempotency UUID with a different fingerprint as `409 idempotency_conflict`, otherwise return the prior job without resubmitting. New job creation records `queued`, changes it to `submitting` with a compare-and-set update, submits once, then saves either `submitted` plus `provider_task_id`, or `needs_attention` when submission may have reached Alibaba but no task can be safely classified. `synchronizeJob` must never query Alibaba for a terminal state; record `running` for nonterminal provider states; move provider `FAILED`, `CANCELED`, and `UNKNOWN` to `failed` or `needs_attention`; and, on success, ingest the video to `creative-studio`, create a generated-video asset, then atomically set `completed` with `output_asset_id`. Failure to ingest retains the provider task ID and sets `needs_attention`, never re-submits.

The routes must call `requireOwner` before resource lookup, select jobs by both `id` and `owner_user_id`, accept only UUID idempotency keys, return safe public job fields, and add a five-minute signed result URL only for a completed owned job.

- [ ] **Step 4: Verify job lifecycle behavior**

Run: `cd hosted && npm test -- tests/jobs.test.ts && npm run check`

Expected: tests pass and no lifecycle path calls `submitWanJob` twice for one idempotency key.

- [ ] **Step 5: Commit job routes**

```bash
git add hosted/lib/jobs.ts hosted/app/api/jobs hosted/tests/jobs.test.ts
git commit -m "feat: add hosted studio job lifecycle"
```

### Task 7: Build the authenticated Motion Studio interface

**Files:**

- Create: `hosted/lib/supabase-browser.ts`
- Create: `hosted/lib/api.ts`
- Create: `hosted/components/Login.tsx`
- Create: `hosted/components/MotionStudio.tsx`
- Modify: `hosted/app/page.tsx`
- Modify: `hosted/app/globals.css`
- Create: `hosted/tests/motion-studio.test.tsx`
- Modify: `hosted/vitest.config.ts`
- Modify: `hosted/package.json`

**Interfaces:**

- Consumes: Supabase browser session and JSON routes from Tasks 3-6.
- Produces: owner sign-in, project selection/creation, source/end-frame upload, confirmed-model settings, submit button, job polling, and signed-result links.

- [ ] **Step 1: Write the failing interface behavior test**

```tsx
// hosted/tests/motion-studio.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MotionStudio } from "@/components/MotionStudio";

describe("hosted Motion Studio", () => {
  it("does not enable generation before a start frame and quota confirmation", () => {
    render(<MotionStudio api={{ listProjects: vi.fn().mockResolvedValue([]) }} as never />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /new project/i }));
    expect(screen.getByText(/confirm free quota/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused red test**

Run: `cd hosted && npm test -- tests/motion-studio.test.tsx`

Expected: FAIL because the component and React Testing Library configuration do not exist.

- [ ] **Step 3: Implement the minimal owner UI**

Add `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, and matching type packages as hosted dev dependencies. The browser Supabase client uses only public variables and `signInWithPassword`. `api.ts` retrieves the session access token immediately before every call and sets `Authorization: Bearer <token>`; it never decides authorization from browser session claims.

Render a plain login form until Supabase supplies a session. Once authenticated, render a project selector, New project action, Settings section that changes only the selected project's explicit Free Quota confirmations, start/end image controls, model/duration/resolution/ratio controls, a disabled Generate button until a start image and confirmation exist, and a job history list. Poll only nonterminal job IDs every 15 seconds while the page is mounted; clear the interval on unmount. Never auto-submit, retry, or call Meta.

- [ ] **Step 4: Verify UI tests, type checks, and build**

Run: `cd hosted && npm test -- tests/motion-studio.test.tsx && npm run check && npm run build`

Expected: interface behavior passes, browser bundle contains no service-role key, and production build succeeds.

- [ ] **Step 5: Commit the Motion UI**

```bash
git add hosted
git commit -m "feat: add hosted motion studio interface"
```

### Task 8: Harden the hosted deployment boundary and prove local non-interference

**Files:**

- Create: `hosted/vercel.json`
- Create: `hosted/README.md`
- Create: `hosted/tests/deployment-boundary.test.ts`
- Modify: `hosted/next.config.mjs`

**Interfaces:**

- Consumes: complete hosted app from Tasks 1-7.
- Produces: Vercel Node.js deployment config, documented required variables, strict browser headers, and a non-interference check.

- [ ] **Step 1: Write the failing deployment-boundary test**

```ts
// hosted/tests/deployment-boundary.test.ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("hosted deployment boundary", () => {
  it("is an independent Vercel application and cannot import the local worker", async () => {
    const config = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
    const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
    expect(config).toContain('"framework": "nextjs"');
    expect(config).toContain('"regions": ["iad1"]');
    expect(packageJson).not.toContain("server/worker.ts");
  });
});
```

- [ ] **Step 2: Run the focused red test**

Run: `cd hosted && npm test -- tests/deployment-boundary.test.ts`

Expected: FAIL because `hosted/vercel.json` does not exist.

- [ ] **Step 3: Configure production-safe hosting**

```json
// hosted/vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "app/api/jobs/route.ts": { "maxDuration": 60 },
    "app/api/jobs/[id]/route.ts": { "maxDuration": 60 }
  }
}
```

Set a restrictive Content-Security-Policy in `next.config.mjs`: `default-src 'self'; connect-src 'self' https://kukpvpklizsvedcmybhn.supabase.co; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. The README must document the Vercel Root Directory, the six required environment variable names, the fact that the bucket is private, and exact local commands. It must explicitly state that this hosted app does not run Instagram automation or a permanent provider worker.

- [ ] **Step 4: Verify the deployment boundary**

Run: `cd hosted && npm test -- tests/deployment-boundary.test.ts && npm test && npm run check && npm run build`

Expected: all hosted tests, TypeScript, and build pass; `git diff --name-only origin/main...HEAD` contains no `insta-automation/` path and no root local Studio source change.

- [ ] **Step 5: Commit deployment configuration**

```bash
git add hosted
git commit -m "chore: configure hosted studio deployment"
```

### Task 9: Apply the migration, create and configure the separate Vercel project, and verify production

**Files:**

- Modify: `hosted/README.md` only if the deployed Vercel URL differs from the documented output.

**Interfaces:**

- Consumes: all tested hosted commits and the approved migration.
- Produces: an active Supabase schema/bucket and a separate production Vercel deployment from the exact pushed commit.

- [ ] **Step 1: Run the complete local verification gate**

Run: `cd hosted && npm test && npm run check && npm run build`

Expected: all tests pass with no test failure; build exits 0.

- [ ] **Step 2: Review and apply the exact migration to the active project**

Run advisors first using the Supabase MCP security and performance advisor calls for project `kukpvpklizsvedcmybhn`. Review the migration SQL, then apply that exact SQL once with the Supabase MCP `apply_migration` call named `hosted_creative_studio`. Do not run any existing migration, trigger, RLS-policy, or data-repair SQL from `insta-automation`.

- [ ] **Step 3: Verify the live database and bucket**

Use Supabase MCP `list_tables` for schemas `public` and `storage`, then verify:

```text
public.creative_studio_projects: RLS enabled
public.creative_studio_assets: RLS enabled
public.creative_studio_jobs: RLS enabled
storage.buckets row creative-studio: private
storage.objects: no new broad anon/authenticated policy
```

Run the security advisor again. Any new high-severity Studio finding blocks deployment; existing unrelated automation advisories are reported but not modified.

- [ ] **Step 4: Push the tested branch and create the Vercel project**

Run:

```bash
git push -u origin codex/creative-studio-vercel
cd hosted
vercel project add tiny-soho-creative-studio
vercel link --project tiny-soho-creative-studio
```

Set the Vercel project Root Directory to `hosted` and Node.js to `24.x`. Add the six environment values through `vercel env add`, reading each value directly from secure local configuration without printing it. The two `NEXT_PUBLIC_` Supabase values go to preview and production; `SUPABASE_SERVICE_ROLE_KEY`, `TINY_SOHO_STUDIO_ADMIN_EMAILS`, `DASHSCOPE_API_KEY`, and `ALIBABA_WORKSPACE_ID` go to preview and production as server-only values. Never reuse or alter `tinysoho-admin` environment variables.

- [ ] **Step 5: Deploy and verify the exact production artifact**

Run: `vercel --prod --yes`

Capture the deployment URL printed by the command and verify that returned URL and its production alias with:

```bash
vercel inspect "$DEPLOYMENT_URL"
curl --fail --silent --show-error "$DEPLOYMENT_URL/api/health"
```

Set `DEPLOYMENT_URL` in the current terminal only to the exact URL returned by the immediately preceding `vercel --prod --yes` command; never guess or reuse a previous deployment URL. Confirm the inspected deployment references the pushed `codex/creative-studio-vercel` commit, health reports only safe configuration booleans, and an unauthenticated project request returns `401`. In a browser, sign in with the existing Tiny Soho owner account, create one project, upload one harmless PNG, confirm no jobs are submitted until Free Quota is explicitly checked, and confirm a non-allowlisted session receives access denied. Do not submit live Alibaba work unless the selected model is confirmed Free Quota Only.

- [ ] **Step 6: Run the non-interference production check**

Read the existing `insta-automation` production health endpoint and current Railway/Vercel deployment state without changing them. Confirm its API health succeeds and no automation environment variable, deployment, worker, table, Storage path, or Meta action changed during this release. Report Studio deployment evidence separately from automation health evidence.

- [ ] **Step 7: Commit any deployed URL documentation update**

```bash
git add hosted/README.md
git commit -m "docs: record hosted studio deployment"
git push
```
