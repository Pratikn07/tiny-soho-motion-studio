create extension if not exists pgcrypto;

create table public.creative_studio_projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  canvas text not null default '1080x1920',
  free_quota_models jsonb not null default '[]'::jsonb check (jsonb_typeof(free_quota_models) = 'array'),
  free_quota_confirmed_at jsonb not null default '{}'::jsonb check (jsonb_typeof(free_quota_confirmed_at) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creative_studio_projects_owner_updated_idx
  on public.creative_studio_projects (owner_user_id, updated_at desc);

create table public.creative_studio_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  kind text not null check (kind in ('source-image', 'generated-video')),
  name text not null check (char_length(btrim(name)) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4')),
  object_path text not null unique check (object_path like 'owners/%'),
  byte_size bigint not null check (byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_seconds numeric check (duration_seconds is null or duration_seconds > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  check (
    (kind = 'source-image' and mime_type in ('image/jpeg', 'image/png', 'image/webp'))
    or (kind = 'generated-video' and mime_type = 'video/mp4')
  )
);

create index creative_studio_assets_owner_project_created_idx
  on public.creative_studio_assets (owner_user_id, project_id, created_at desc);

create table public.creative_studio_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  owner_user_id uuid not null,
  idempotency_key uuid not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  model_id text not null check (model_id in ('wan2.7-i2v', 'wan3-video')),
  task text not null check (task = 'image-to-video'),
  prompt text not null check (char_length(prompt) between 1 and 5000),
  input_assets jsonb not null check (jsonb_typeof(input_assets) = 'array'),
  options jsonb not null check (jsonb_typeof(options) = 'object'),
  status text not null check (status in ('queued', 'submitting', 'submitted', 'running', 'downloading', 'completed', 'failed', 'needs_attention', 'canceled')),
  provider_task_id text,
  output_asset_id uuid references public.creative_studio_assets(id),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);

create index creative_studio_jobs_owner_project_updated_idx
  on public.creative_studio_jobs (owner_user_id, project_id, updated_at desc);

create index creative_studio_jobs_owner_status_updated_idx
  on public.creative_studio_jobs (owner_user_id, status, updated_at desc);

alter table public.creative_studio_projects enable row level security;
alter table public.creative_studio_assets enable row level security;
alter table public.creative_studio_jobs enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creative-studio',
  'creative-studio',
  false,
  262144000,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
)
on conflict (id) do nothing;;
