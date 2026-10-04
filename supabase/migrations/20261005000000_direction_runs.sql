-- Direction runs: a creator pastes finished slides (text baked in) and a Claude Code routine directs them. It
-- removes the text, re-sets it in brand type with motion, critiques its own frames, and uploads per slide a clean
-- background, a transparent text layer, a motion plan and a preview. The app turns those uploads into the slide's
-- layers, and the existing pipeline (review, generation, finishing) continues unchanged.
-- Additive: no existing table, column, constraint or policy changes. The bucket gains one file type.

create table if not exists public.creative_studio_direction_runs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  project_id uuid not null references public.creative_studio_projects(id) on delete cascade,
  idempotency_key uuid not null,
  -- [{ "slideId": uuid, "finishedAssetId": uuid }], in slide order.
  slides jsonb not null check (jsonb_typeof(slides) = 'array' and jsonb_array_length(slides) between 1 and 20),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  routine_session_id text check (routine_session_id is null or char_length(routine_session_id) <= 200),
  routine_session_url text check (routine_session_url is null or char_length(routine_session_url) <= 500),
  fired_at timestamptz,
  completed_at timestamptz,
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);

create index if not exists creative_studio_direction_runs_owner_project_idx
  on public.creative_studio_direction_runs (owner_user_id, project_id, created_at desc);

-- Same access model as every other creative_studio table: row level security on, no policies, so only the
-- service role (the hosted API) can read or write.
alter table public.creative_studio_direction_runs enable row level security;

-- The routine uploads each slide's motion plan and the run's result manifest as JSON.
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime_type order by mime_type)
  from unnest(allowed_mime_types || array['application/json']::text[]) as mime_type
)
where id = 'creative-studio'
  and not ('application/json' = any (allowed_mime_types));
