alter table public.creative_studio_assets
  add column if not exists updated_at timestamptz not null default now();

alter table public.creative_studio_jobs
  add column if not exists next_poll_at timestamptz not null default now(),
  add column if not exists worker_lease_expires_at timestamptz,
  add column if not exists worker_lease_id uuid,
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0);

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.creative_studio_assets'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) like '%kind%'
        or pg_get_constraintdef(oid) like '%mime_type%'
      )
  loop
    execute format('alter table public.creative_studio_assets drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.creative_studio_assets
  add constraint creative_studio_assets_kind_check
    check (kind in ('source-image', 'source-video', 'source-audio', 'generated-video')),
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
      or (kind = 'generated-video' and mime_type = 'video/mp4')
    );

alter table public.creative_studio_jobs
  drop constraint if exists creative_studio_jobs_model_id_check,
  drop constraint if exists creative_studio_jobs_task_check,
  drop constraint if exists creative_studio_jobs_prompt_check;

alter table public.creative_studio_jobs
  add constraint creative_studio_jobs_model_id_check
    check (char_length(btrim(model_id)) between 1 and 120),
  add constraint creative_studio_jobs_task_check
    check (task in (
      'text-to-video', 'image-to-video', 'keyframe-to-video',
      'reference-to-video', 'video-edit', 'animate-move', 'animate-mix'
    )),
  add constraint creative_studio_jobs_prompt_check
    check (char_length(prompt) <= 5000);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creative-studio',
  'creative-studio',
  false,
  262144000,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.creative_studio_model_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  model_id text not null check (char_length(btrim(model_id)) between 1 and 120),
  contract_version text not null check (char_length(btrim(contract_version)) between 1 and 80),
  acknowledgement_text_version text not null check (char_length(btrim(acknowledgement_text_version)) between 1 and 80),
  billing_acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_user_id, model_id, contract_version)
);

create index if not exists creative_studio_model_acknowledgements_owner_idx
  on public.creative_studio_model_acknowledgements (owner_user_id, billing_acknowledged_at desc);

create table if not exists public.creative_studio_job_media (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.creative_studio_jobs(id) on delete cascade,
  asset_id uuid not null references public.creative_studio_assets(id) on delete restrict,
  owner_user_id uuid not null,
  role text not null check (role in (
    'first_frame', 'last_frame', 'reference_image', 'reference_video',
    'source_video', 'driving_video', 'driving_audio', 'first_clip', 'mask_image'
  )),
  ordinal integer not null check (ordinal > 0),
  created_at timestamptz not null default now(),
  unique (job_id, role, ordinal)
);

create index if not exists creative_studio_job_media_job_ordinal_idx
  on public.creative_studio_job_media (job_id, ordinal);

create index if not exists creative_studio_job_media_owner_asset_idx
  on public.creative_studio_job_media (owner_user_id, asset_id);

create table if not exists public.creative_studio_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.creative_studio_jobs(id) on delete cascade,
  owner_user_id uuid not null,
  event_type text not null check (event_type in ('claimed', 'submitted', 'polled', 'downloading', 'completed', 'failed', 'needs_attention', 'canceled')),
  safe_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_detail) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists creative_studio_job_events_job_created_idx
  on public.creative_studio_job_events (job_id, created_at desc);

create index if not exists creative_studio_jobs_worker_claim_idx
  on public.creative_studio_jobs (next_poll_at, created_at)
  where status in ('queued', 'submitted', 'running', 'downloading');

alter table public.creative_studio_model_acknowledgements enable row level security;
alter table public.creative_studio_job_media enable row level security;
alter table public.creative_studio_job_events enable row level security;

create or replace function public.claim_creative_studio_job()
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
    where status in ('queued', 'submitted', 'running', 'downloading')
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

revoke all on function public.claim_creative_studio_job() from public, anon, authenticated;
grant execute on function public.claim_creative_studio_job() to service_role;
