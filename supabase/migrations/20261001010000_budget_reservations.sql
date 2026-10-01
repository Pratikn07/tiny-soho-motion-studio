-- O1: hard monthly spending cap. A take reserves its estimated cost before any provider call; the reservation is
-- converted into a ledger row (creative_studio_spend) when the provider reports the real cost, or released when the
-- job ends without one. A per-owner advisory lock makes two concurrent reservations unable to pass the last dollars.

create table if not exists public.creative_studio_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  reservation_key text not null unique check (char_length(btrim(reservation_key)) between 1 and 200),
  run_id uuid references public.creative_studio_pipeline_runs(id) on delete set null,
  usd numeric not null check (usd >= 0),
  status text not null default 'open' check (status in ('open', 'converted', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creative_studio_budget_reservations_owner_open_idx
  on public.creative_studio_budget_reservations (owner_user_id)
  where status = 'open';

alter table public.creative_studio_budget_reservations enable row level security;

-- True when the reservation fits under the cap (or already exists for this key); false means "do not spend".
create or replace function public.reserve_creative_studio_budget(
  p_owner_user_id uuid,
  p_reservation_key text,
  p_run_id uuid,
  p_usd numeric,
  p_cap_usd numeric
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  spent numeric;
  reserved numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('creative_studio_budget:' || p_owner_user_id::text, 0));

  if exists (
    select 1 from public.creative_studio_budget_reservations
    where reservation_key = p_reservation_key and status in ('open', 'converted')
  ) then
    return true;
  end if;

  select coalesce(sum(usd), 0) into spent
  from public.creative_studio_spend
  where owner_user_id = p_owner_user_id and occurred_at >= month_start;

  select coalesce(sum(usd), 0) into reserved
  from public.creative_studio_budget_reservations
  where owner_user_id = p_owner_user_id and status = 'open';

  if spent + reserved + p_usd > p_cap_usd then
    return false;
  end if;

  insert into public.creative_studio_budget_reservations (owner_user_id, reservation_key, run_id, usd)
  values (p_owner_user_id, p_reservation_key, p_run_id, p_usd)
  on conflict (reservation_key) do update
    set status = 'open', usd = excluded.usd, run_id = excluded.run_id, updated_at = now();

  if p_run_id is not null then
    update public.creative_studio_pipeline_runs
    set budget_reserved_usd = budget_reserved_usd + p_usd
    where id = p_run_id;
  end if;
  return true;
end;
$$;

-- Records a finished provider job's cost once and settles its take's reservation. Safe to call repeatedly.
create or replace function public.settle_creative_studio_job_spend(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job public.creative_studio_jobs;
  take public.creative_studio_takes;
  key text;
begin
  select * into job from public.creative_studio_jobs where id = p_job_id;
  if not found then
    return 'missing';
  end if;
  select * into take from public.creative_studio_takes where job_id = job.id limit 1;
  key := case when take.id is null then null else take.run_id::text || ':' || take.attempt::text end;

  if job.status = 'completed' and job.cost_usd is not null then
    perform pg_advisory_xact_lock(hashtextextended('creative_studio_budget:' || job.owner_user_id::text, 0));
    insert into public.creative_studio_spend (owner_user_id, provider, model_id, job_id, take_id, usd, gpu_seconds)
    values (job.owner_user_id, job.provider, job.model_id, job.id, take.id, job.cost_usd, job.gpu_seconds)
    on conflict (job_id) where job_id is not null do nothing;
    update public.creative_studio_budget_reservations
    set status = 'converted', usd = job.cost_usd, updated_at = now()
    where reservation_key = key and status = 'open';
    return 'recorded';
  end if;

  if job.status in ('failed', 'canceled') then
    update public.creative_studio_budget_reservations
    set status = 'released', updated_at = now()
    where reservation_key = key and status = 'open';
    return 'released';
  end if;

  -- needs_attention (for example a possible duplicate submit) keeps the reservation until someone decides.
  return 'open';
end;
$$;

revoke all on function public.reserve_creative_studio_budget(uuid, text, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.settle_creative_studio_job_spend(uuid) from public, anon, authenticated;
grant execute on function public.reserve_creative_studio_budget(uuid, text, uuid, numeric, numeric) to service_role;
grant execute on function public.settle_creative_studio_job_spend(uuid) to service_role;
