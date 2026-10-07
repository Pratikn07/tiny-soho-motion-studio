-- Reels: story-led motion-graphics reels made step by step (idea, script, storyboard, voice, images, build,
-- sound, export). Each step that needs work becomes a reel job; the Studio Mac runner claims jobs, runs Claude
-- Code only for the thinking steps, renders locally, and reports back. The creator approves each step.
-- Additive: no existing table, column, constraint or policy changes. Files reuse creative_studio_assets and the
-- existing creative-studio bucket.

create table if not exists public.creative_studio_reels (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'ready', 'archived')),
  current_step text not null default 'idea'
    check (current_step in ('idea', 'script', 'storyboard', 'voice', 'images', 'build', 'sound', 'export')),
  -- The reel's working document: idea, script lines, voice settings, scene plan, asset ids, approvals.
  document jsonb not null default '{}'::jsonb check (jsonb_typeof(document) = 'object'),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creative_studio_reels_owner_updated_idx
  on public.creative_studio_reels (owner_user_id, updated_at desc);

create table if not exists public.creative_studio_reel_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  reel_id uuid not null references public.creative_studio_reels(id) on delete cascade,
  idempotency_key uuid not null,
  step text not null
    check (step in ('idea', 'script', 'storyboard', 'voice', 'images', 'build', 'sound', 'export')),
  -- 'draft' makes a step's first version; 'revise' applies the creator's comments; 'render' and 'mix' are
  -- mechanical and use no Claude.
  kind text not null default 'draft' check (kind in ('draft', 'revise', 'render', 'mix')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'needs_review', 'completed', 'failed', 'canceled')),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  runner_id text check (runner_id is null or char_length(runner_id) <= 120),
  worker_lease_id uuid,
  worker_lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  progress text check (progress is null or char_length(progress) <= 200),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reel_id, idempotency_key)
);

create index if not exists creative_studio_reel_jobs_queue_idx
  on public.creative_studio_reel_jobs (status, created_at) where status in ('queued', 'running');
create index if not exists creative_studio_reel_jobs_owner_reel_idx
  on public.creative_studio_reel_jobs (owner_user_id, reel_id, created_at desc);

-- One row per runner machine (for now, the Studio Mac). The app shows its status from last_seen_at.
create table if not exists public.creative_studio_runners (
  id text primary key check (char_length(id) between 1 and 120),
  owner_user_id uuid not null,
  label text not null check (char_length(label) between 1 and 120),
  claude_auth text not null default 'subscription' check (claude_auth in ('subscription', 'api_key')),
  version text check (version is null or char_length(version) <= 60),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same access model as every other creative_studio table: row level security on, no policies, so only the
-- service role (the hosted API) can read or write.
alter table public.creative_studio_reels enable row level security;
alter table public.creative_studio_reel_jobs enable row level security;
alter table public.creative_studio_runners enable row level security;

-- Claims the oldest available reel job for a runner, with a two-minute lease the runner renews while it works.
create or replace function public.claim_creative_studio_reel_job(runner text)
returns public.creative_studio_reel_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_job public.creative_studio_reel_jobs;
begin
  with candidate as (
    select id
    from public.creative_studio_reel_jobs
    where status in ('queued', 'running')
      and (worker_lease_expires_at is null or worker_lease_expires_at <= now())
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.creative_studio_reel_jobs as job
  set status = 'running',
      runner_id = runner,
      worker_lease_id = gen_random_uuid(),
      worker_lease_expires_at = now() + interval '2 minutes',
      attempt_count = job.attempt_count + 1,
      started_at = coalesce(job.started_at, now()),
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.* into claimed_job;

  return claimed_job;
end;
$$;

revoke all on function public.claim_creative_studio_reel_job(text) from public, anon, authenticated;
grant execute on function public.claim_creative_studio_reel_job(text) to service_role;
