alter table public.clarification_email_jobs
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists response_payload jsonb not null default '{}'::jsonb;

create index if not exists clarification_email_jobs_processing_idx
  on public.clarification_email_jobs(status, scheduled_at, created_at);

create or replace function public.claim_clarification_email_jobs(
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

  return query
  with candidates as (
    select job.id
    from public.clarification_email_jobs job
    where job.status in ('queued', 'failed')
      and job.scheduled_at <= now()
    order by job.scheduled_at, job.created_at
    limit greatest(1, coalesce(p_limit, 20))
    for update skip locked
  ),
  claimed as (
    update public.clarification_email_jobs job
    set
      status = 'running',
      attempt_count = job.attempt_count + 1,
      locked_at = now(),
      locked_by = coalesce(nullif(btrim(p_worker_id), ''), 'yc-os'),
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

comment on function public.claim_clarification_email_jobs is
  'Atomically claims queued or retryable Resend clarification email jobs for server-side delivery.';

revoke all on function public.claim_clarification_email_jobs(integer, text) from public;
grant execute on function public.claim_clarification_email_jobs(integer, text) to service_role;
