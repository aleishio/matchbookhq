create or replace function public.claim_clarification_email_jobs_for_operation(
  p_operation_id uuid,
  p_limit integer default 20,
  p_worker_id text default null
)
returns table (
  id uuid,
  application_id uuid,
  attempt_count integer,
  to_email text,
  from_email text,
  subject text,
  body_preview text,
  payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.event_ops_can_write() then
    raise exception 'event ops write access required';
  end if;

  if p_operation_id is null then
    raise exception 'claim_clarification_email_jobs_for_operation requires an operation id';
  end if;

  return query
  with candidates as (
    select job.id
    from public.clarification_email_jobs job
    where job.bulk_operation_id = p_operation_id
      and job.status in ('queued', 'failed')
      and job.scheduled_at <= now()
    order by job.scheduled_at, job.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ),
  claimed as (
    update public.clarification_email_jobs job
    set
      status = 'running',
      attempt_count = job.attempt_count + 1,
      locked_at = now(),
      locked_by = coalesce(nullif(btrim(p_worker_id), ''), 'yc-os-agent'),
      last_error = null
    from candidates
    where job.id = candidates.id
    returning
      job.id,
      job.application_id,
      job.attempt_count,
      job.to_email,
      job.from_email,
      job.subject,
      job.body_preview,
      job.payload
  )
  select
    claimed.id,
    claimed.application_id,
    claimed.attempt_count,
    claimed.to_email,
    claimed.from_email,
    claimed.subject,
    claimed.body_preview,
    claimed.payload
  from claimed;
end;
$$;

comment on function public.claim_clarification_email_jobs_for_operation is
  'Atomically claims only the clarification email jobs created by one approval bulk operation, allowing agent-triggered immediate delivery without stealing unrelated queued jobs.';

revoke all on function public.claim_clarification_email_jobs_for_operation(uuid, integer, text) from public;
grant execute on function public.claim_clarification_email_jobs_for_operation(uuid, integer, text) to service_role;
