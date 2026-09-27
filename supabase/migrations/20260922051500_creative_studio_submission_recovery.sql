-- A Worker may restart after claiming a queued job and before it can submit it
-- to Alibaba.  Those jobs remain in `submitting` with no provider task yet, so
-- make an expired lease eligible for the normal idempotent submission retry.
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
    where status in ('queued', 'submitting', 'submitted', 'running', 'downloading')
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
