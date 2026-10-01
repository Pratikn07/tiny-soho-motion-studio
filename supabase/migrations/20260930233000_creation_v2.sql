-- Creation v2 (docs/tasks/T0-contract.md): layered slides, provider-routed jobs, AI reviews,
-- server-side pipeline runs, takes and a spend ledger. Additive: every legacy column,
-- kind, status and RPC keeps working until O2 removes the legacy carousel flow.

-- Asset kinds: add the two uploaded layers.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.creative_studio_assets'::regclass
      and contype = 'c'
      and conname in ('creative_studio_assets_kind_check', 'creative_studio_assets_kind_mime_check')
  loop
    execute format('alter table public.creative_studio_assets drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.creative_studio_assets
  add constraint creative_studio_assets_kind_check
    check (kind in (
      'source-image', 'source-video', 'source-audio', 'generated-video', 'derived-image', 'derived-video',
      'background-image', 'text-layer'
    )),
  add constraint creative_studio_assets_kind_mime_check
    check (
      (kind in ('source-image', 'background-image') and mime_type in ('image/jpeg', 'image/png', 'image/webp'))
      or (kind = 'text-layer' and mime_type = 'image/png')
      or (kind = 'source-video' and mime_type in ('video/mp4', 'video/quicktime', 'video/webm'))
      or (kind = 'source-audio' and mime_type in ('audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4'))
      or (kind in ('generated-video', 'derived-video') and mime_type = 'video/mp4')
      or (kind = 'derived-image' and mime_type in ('image/png', 'image/webp'))
    );

-- Provider jobs: which provider runs them, what they cost, and a submit attempt id (B4).
alter table public.creative_studio_jobs
  add column if not exists provider text not null default 'alibaba',
  add column if not exists seed integer,
  add column if not exists cost_usd numeric,
  add column if not exists gpu_seconds numeric,
  add column if not exists submit_attempt_id uuid;

alter table public.creative_studio_jobs
  drop constraint if exists creative_studio_jobs_provider_check,
  drop constraint if exists creative_studio_jobs_seed_check,
  drop constraint if exists creative_studio_jobs_cost_usd_check,
  drop constraint if exists creative_studio_jobs_gpu_seconds_check;

alter table public.creative_studio_jobs
  add constraint creative_studio_jobs_provider_check check (provider in ('modal-ltx', 'alibaba')),
  add constraint creative_studio_jobs_seed_check check (seed is null or seed between 0 and 2147483647),
  add constraint creative_studio_jobs_cost_usd_check check (cost_usd is null or cost_usd >= 0),
  add constraint creative_studio_jobs_gpu_seconds_check check (gpu_seconds is null or gpu_seconds >= 0);

-- Every job status is a valid event type (the worker writes event_type = status).
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.creative_studio_job_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%event_type%'
  loop
    execute format('alter table public.creative_studio_job_events drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.creative_studio_job_events
  add constraint creative_studio_job_events_event_type_check
    check (event_type in (
      'queued', 'submitting', 'submitted', 'running', 'downloading', 'completed', 'failed',
      'needs_attention', 'canceled', 'claimed', 'polled'
    ));

-- Vision jobs: finishing (P4) and checks (P5), with a structured result.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.creative_studio_vision_jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%operation%'
  loop
    execute format('alter table public.creative_studio_vision_jobs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.creative_studio_vision_jobs
  add column if not exists result jsonb;

alter table public.creative_studio_vision_jobs
  drop constraint if exists creative_studio_vision_jobs_result_check;

alter table public.creative_studio_vision_jobs
  add constraint creative_studio_vision_jobs_operation_check
    check (operation in ('inspect', 'overlay', 'plate', 'compose', 'ocr', 'segment', 'layers', 'finish', 'check')),
  add constraint creative_studio_vision_jobs_result_check
    check (result is null or jsonb_typeof(result) = 'object');

-- AI slide reviews and creator-idea checks (P1).
create table if not exists public.creative_studio_review_runs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  slide_id uuid not null,
  reviewer_provider text not null check (char_length(btrim(reviewer_provider)) between 1 and 40),
  reviewer_model text not null check (char_length(btrim(reviewer_model)) between 1 and 160),
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  creator_idea text check (creator_idea is null or char_length(creator_idea) <= 1000),
  creator_idea_result jsonb check (creator_idea_result is null or jsonb_typeof(creator_idea_result) = 'object'),
  cost_usd numeric check (cost_usd is null or cost_usd >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creative_studio_review_runs_owner_slide_idx
  on public.creative_studio_review_runs (owner_user_id, project_id, slide_id, created_at desc);

-- One pipeline run per "generate this slide" request (B3).
create table if not exists public.creative_studio_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  slide_id uuid not null,
  idempotency_key uuid not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  model_id text not null check (char_length(btrim(model_id)) between 1 and 120),
  provider text not null check (provider in ('modal-ltx', 'alibaba')),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 5000),
  motion_style text not null check (motion_style in ('calm', 'lively')),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  allow_fallback boolean not null default false,
  seeds_planned integer[] not null check (cardinality(seeds_planned) between 1 and 10),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  status text not null default 'queued' check (status in (
    'queued', 'generating', 'finishing', 'checking', 'completed', 'needs_attention', 'failed', 'canceled'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  budget_reserved_usd numeric not null default 0 check (budget_reserved_usd >= 0),
  worker_lease_id uuid,
  worker_lease_expires_at timestamptz,
  next_step_at timestamptz not null default now(),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key),
  check (attempt_count <= max_attempts)
);

create index if not exists creative_studio_pipeline_runs_claim_idx
  on public.creative_studio_pipeline_runs (next_step_at, created_at)
  where status in ('queued', 'generating', 'finishing', 'checking');

create index if not exists creative_studio_pipeline_runs_owner_slide_idx
  on public.creative_studio_pipeline_runs (owner_user_id, project_id, slide_id, created_at desc);

-- At most one active run per slide (`run_in_progress`).
create unique index if not exists creative_studio_pipeline_runs_active_slide_idx
  on public.creative_studio_pipeline_runs (project_id, slide_id)
  where status in ('queued', 'generating', 'finishing', 'checking');

-- One take per seed attempt.
create table if not exists public.creative_studio_takes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.creative_studio_pipeline_runs(id) on delete cascade,
  owner_user_id uuid not null,
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  slide_id uuid not null,
  attempt integer not null check (attempt between 1 and 10),
  seed integer not null check (seed between 0 and 2147483647),
  model_id text not null check (char_length(btrim(model_id)) between 1 and 120),
  provider text not null check (provider in ('modal-ltx', 'alibaba')),
  job_id uuid references public.creative_studio_jobs(id) on delete set null,
  raw_asset_id uuid references public.creative_studio_assets(id) on delete set null,
  final_asset_id uuid references public.creative_studio_assets(id) on delete set null,
  cover_asset_id uuid references public.creative_studio_assets(id) on delete set null,
  finish_job_id uuid references public.creative_studio_vision_jobs(id) on delete set null,
  check_job_id uuid references public.creative_studio_vision_jobs(id) on delete set null,
  stage text not null default 'generating' check (stage in ('generating', 'finishing', 'checking', 'done', 'failed')),
  checks jsonb check (checks is null or jsonb_typeof(checks) = 'object'),
  verdict text not null default 'pending' check (verdict in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, attempt),
  unique (run_id, seed),
  check (verdict = 'pending' or checks is not null)
);

create index if not exists creative_studio_takes_run_idx
  on public.creative_studio_takes (run_id, attempt);

create index if not exists creative_studio_takes_owner_slide_idx
  on public.creative_studio_takes (owner_user_id, project_id, slide_id, created_at desc);

create index if not exists creative_studio_takes_job_idx
  on public.creative_studio_takes (job_id) where job_id is not null;

-- Spend ledger (O1): one row per paid call, written once.
create table if not exists public.creative_studio_spend (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  provider text not null check (char_length(btrim(provider)) between 1 and 40),
  model_id text not null check (char_length(btrim(model_id)) between 1 and 160),
  job_id uuid references public.creative_studio_jobs(id) on delete set null,
  take_id uuid references public.creative_studio_takes(id) on delete set null,
  review_run_id uuid references public.creative_studio_review_runs(id) on delete set null,
  usd numeric not null check (usd >= 0),
  gpu_seconds numeric check (gpu_seconds is null or gpu_seconds >= 0),
  video_seconds numeric check (video_seconds is null or video_seconds >= 0),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (job_id is not null or review_run_id is not null)
);

create unique index if not exists creative_studio_spend_job_idx
  on public.creative_studio_spend (job_id) where job_id is not null;

create unique index if not exists creative_studio_spend_review_run_idx
  on public.creative_studio_spend (review_run_id) where review_run_id is not null;

create index if not exists creative_studio_spend_owner_occurred_idx
  on public.creative_studio_spend (owner_user_id, occurred_at desc);

alter table public.creative_studio_review_runs enable row level security;
alter table public.creative_studio_pipeline_runs enable row level security;
alter table public.creative_studio_takes enable row level security;
alter table public.creative_studio_spend enable row level security;

-- Claims the next pipeline run whose step is due. Status and attempt_count are left to the
-- orchestrator: attempt_count counts paid generations, not claims.
create or replace function public.claim_creative_studio_pipeline_run()
returns public.creative_studio_pipeline_runs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_run public.creative_studio_pipeline_runs;
begin
  with candidate as (
    select id
    from public.creative_studio_pipeline_runs
    where status in ('queued', 'generating', 'finishing', 'checking')
      and next_step_at <= now()
      and (worker_lease_expires_at is null or worker_lease_expires_at <= now())
    order by next_step_at asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.creative_studio_pipeline_runs as run
  set worker_lease_id = gen_random_uuid(),
      worker_lease_expires_at = now() + interval '2 minutes',
      next_step_at = now() + interval '15 seconds',
      updated_at = now()
  from candidate
  where run.id = candidate.id
  returning run.* into claimed_run;

  return claimed_run;
end;
$$;

-- Same as claim_creative_studio_job, limited to providers the worker is configured for (B4), so
-- Modal jobs run while Alibaba jobs wait for credentials and vice versa.
create or replace function public.claim_creative_studio_provider_job(allowed_providers text[])
returns public.creative_studio_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_job public.creative_studio_jobs;
begin
  with candidate as (
    select id
    from public.creative_studio_jobs
    where status in ('queued', 'submitting', 'submitted', 'running', 'downloading')
      and provider = any(allowed_providers)
      and next_poll_at <= now()
      and (worker_lease_expires_at is null or worker_lease_expires_at <= now())
    order by next_poll_at asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.creative_studio_jobs as job
  set status = case when job.status = 'queued' then 'submitting' else job.status end,
      worker_lease_id = gen_random_uuid(),
      worker_lease_expires_at = now() + interval '2 minutes',
      next_poll_at = now() + interval '15 seconds',
      attempt_count = job.attempt_count + 1,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.* into claimed_job;

  return claimed_job;
end;
$$;

-- The legacy claim only ever submitted to Alibaba; keep it from picking up Modal jobs.
create or replace function public.claim_creative_studio_job()
returns public.creative_studio_jobs
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from public.claim_creative_studio_provider_job(array['alibaba']);
$$;

revoke all on function public.claim_creative_studio_pipeline_run() from public, anon, authenticated;
revoke all on function public.claim_creative_studio_provider_job(text[]) from public, anon, authenticated;
revoke all on function public.claim_creative_studio_job() from public, anon, authenticated;
grant execute on function public.claim_creative_studio_pipeline_run() to service_role;
grant execute on function public.claim_creative_studio_provider_job(text[]) to service_role;
grant execute on function public.claim_creative_studio_job() to service_role;
