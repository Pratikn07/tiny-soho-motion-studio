alter table public.creative_studio_assets
  drop constraint if exists creative_studio_assets_kind_check,
  drop constraint if exists creative_studio_assets_mime_check,
  drop constraint if exists creative_studio_assets_kind_mime_check;

alter table public.creative_studio_assets
  add constraint creative_studio_assets_kind_check
    check (kind in ('source-image', 'source-video', 'source-audio', 'generated-video', 'derived-image', 'derived-video')),
  add constraint creative_studio_assets_mime_check
    check (mime_type in (
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4'
    )),
  add constraint creative_studio_assets_kind_mime_check
    check (
      (kind = 'source-image' and mime_type in ('image/jpeg', 'image/png', 'image/webp'))
      or (kind = 'source-video' and mime_type in ('video/mp4', 'video/quicktime', 'video/webm'))
      or (kind = 'source-audio' and mime_type in ('audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4'))
      or (kind in ('generated-video', 'derived-video') and mime_type = 'video/mp4')
      or (kind = 'derived-image' and mime_type in ('image/png', 'image/webp'))
    );

create table public.creative_studio_director_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  idempotency_key uuid not null,
  brief text not null check (char_length(btrim(brief)) between 1 and 5000),
  status text not null check (status in ('queued', 'running', 'drafted', 'failed', 'needs_attention', 'canceled')),
  worker_lease_id uuid,
  worker_lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);

create index creative_studio_director_requests_claim_idx
  on public.creative_studio_director_requests (created_at)
  where status in ('queued', 'running');

create index creative_studio_director_requests_owner_project_idx
  on public.creative_studio_director_requests (owner_user_id, project_id, created_at desc);

create table public.creative_studio_director_proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.creative_studio_director_requests(id) on delete cascade,
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('drafted', 'approved', 'failed', 'canceled')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (approved_at is not null))
);

create index creative_studio_director_proposals_owner_project_idx
  on public.creative_studio_director_proposals (owner_user_id, project_id, created_at desc);

create table public.creative_studio_workflows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  graph_version smallint not null check (graph_version = 2),
  graph jsonb not null check (jsonb_typeof(graph) = 'object'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (owner_user_id, fingerprint)
);

create index creative_studio_workflows_owner_project_idx
  on public.creative_studio_workflows (owner_user_id, project_id, created_at desc);

create table public.creative_studio_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.creative_studio_workflows(id) on delete restrict,
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  idempotency_key uuid not null,
  graph_snapshot jsonb not null check (jsonb_typeof(graph_snapshot) = 'object'),
  node_state jsonb not null default '{}'::jsonb check (jsonb_typeof(node_state) = 'object'),
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'needs_attention', 'canceled')),
  next_run_at timestamptz not null default now(),
  worker_lease_id uuid,
  worker_lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);

create index creative_studio_workflow_runs_claim_idx
  on public.creative_studio_workflow_runs (next_run_at, created_at)
  where status in ('queued', 'running');

create index creative_studio_workflow_runs_owner_project_idx
  on public.creative_studio_workflow_runs (owner_user_id, project_id, updated_at desc);

create table public.creative_studio_vision_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  source_asset_id uuid not null references public.creative_studio_assets(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null check (operation in ('inspect', 'overlay', 'plate', 'compose', 'ocr', 'segment', 'layers')),
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  input_asset_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(input_asset_ids) = 'array'),
  output_asset_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(output_asset_ids) = 'array'),
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'needs_attention', 'canceled')),
  worker_lease_id uuid,
  worker_lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);

create index creative_studio_vision_jobs_claim_idx
  on public.creative_studio_vision_jobs (created_at)
  where status in ('queued', 'running');

create index creative_studio_vision_jobs_owner_project_idx
  on public.creative_studio_vision_jobs (owner_user_id, project_id, updated_at desc);

create table public.creative_studio_vision_capabilities (
  capability_id text primary key check (char_length(btrim(capability_id)) between 1 and 120),
  service_version text not null check (char_length(btrim(service_version)) between 1 and 80),
  status text not null check (status in ('available', 'unavailable')),
  reason text,
  refreshed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.creative_studio_director_requests enable row level security;
alter table public.creative_studio_director_proposals enable row level security;
alter table public.creative_studio_workflows enable row level security;
alter table public.creative_studio_workflow_runs enable row level security;
alter table public.creative_studio_vision_jobs enable row level security;
alter table public.creative_studio_vision_capabilities enable row level security;

create or replace function public.claim_creative_studio_director_request()
returns public.creative_studio_director_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_request public.creative_studio_director_requests;
begin
  with candidate as (
    select id
    from public.creative_studio_director_requests
    where status in ('queued', 'running')
      and (worker_lease_expires_at is null or worker_lease_expires_at <= now())
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.creative_studio_director_requests as request
  set status = 'running',
      worker_lease_id = gen_random_uuid(),
      worker_lease_expires_at = now() + interval '2 minutes',
      attempt_count = request.attempt_count + 1,
      updated_at = now()
  from candidate
  where request.id = candidate.id
  returning request.* into claimed_request;

  return claimed_request;
end;
$$;

create or replace function public.claim_creative_studio_workflow_run()
returns public.creative_studio_workflow_runs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_run public.creative_studio_workflow_runs;
begin
  with candidate as (
    select id
    from public.creative_studio_workflow_runs
    where status in ('queued', 'running')
      and next_run_at <= now()
      and (worker_lease_expires_at is null or worker_lease_expires_at <= now())
    order by next_run_at asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.creative_studio_workflow_runs as run
  set status = 'running',
      worker_lease_id = gen_random_uuid(),
      worker_lease_expires_at = now() + interval '2 minutes',
      next_run_at = now() + interval '15 seconds',
      attempt_count = run.attempt_count + 1,
      updated_at = now()
  from candidate
  where run.id = candidate.id
  returning run.* into claimed_run;

  return claimed_run;
end;
$$;

create or replace function public.claim_creative_studio_vision_job()
returns public.creative_studio_vision_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_job public.creative_studio_vision_jobs;
begin
  with candidate as (
    select id
    from public.creative_studio_vision_jobs
    where status in ('queued', 'running')
      and (worker_lease_expires_at is null or worker_lease_expires_at <= now())
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.creative_studio_vision_jobs as job
  set status = 'running',
      worker_lease_id = gen_random_uuid(),
      worker_lease_expires_at = now() + interval '2 minutes',
      attempt_count = job.attempt_count + 1,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.* into claimed_job;

  return claimed_job;
end;
$$;

revoke all on function public.claim_creative_studio_director_request() from public, anon, authenticated;
revoke all on function public.claim_creative_studio_workflow_run() from public, anon, authenticated;
revoke all on function public.claim_creative_studio_vision_job() from public, anon, authenticated;
grant execute on function public.claim_creative_studio_director_request() to service_role;
grant execute on function public.claim_creative_studio_workflow_run() to service_role;
grant execute on function public.claim_creative_studio_vision_job() to service_role;
