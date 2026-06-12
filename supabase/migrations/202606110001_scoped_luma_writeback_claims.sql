create or replace function public.claim_luma_writeback_jobs(
  p_limit integer default 20,
  p_worker_id text default 'yc-os',
  p_bulk_operation_id uuid default null,
  p_job_ids uuid[] default null
)
returns table (
  id uuid,
  application_id uuid,
  target_status text,
  attempt_count integer,
  event_api_id text,
  guest_api_id text,
  guest_email text,
  should_refund boolean,
  send_email boolean
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
    from public.luma_writeback_jobs job
    where job.status in ('queued', 'failed')
      and job.scheduled_at <= now()
      and job.attempt_count < 8
      and job.completed_at is null
      and (
        p_bulk_operation_id is null
        or job.bulk_operation_id = p_bulk_operation_id
      )
      and (
        p_job_ids is null
        or array_length(p_job_ids, 1) is null
        or job.id = any(p_job_ids)
      )
    order by job.scheduled_at, job.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ),
  claimed as (
    update public.luma_writeback_jobs job
    set
      status = 'running',
      attempt_count = job.attempt_count + 1,
      locked_at = now(),
      locked_by = coalesce(p_worker_id, 'yc-os'),
      last_error = null
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select
    claimed.id,
    claimed.application_id,
    claimed.target_status,
    claimed.attempt_count,
    coalesce(claimed.payload->>'event_api_id', event.luma_event_id) as event_api_id,
    case
      when claimed.payload#>>'{guest,type}' = 'email' then null
      when nullif(claimed.payload#>>'{guest,api_id}', '') is not null then claimed.payload#>>'{guest,api_id}'
      when nullif(app.luma_fields->>'guest_api_id', '') is not null then app.luma_fields->>'guest_api_id'
      when app.luma_guest_id !~* '^[^@]+@[^@]+$' then app.luma_guest_id
      else null
    end as guest_api_id,
    coalesce(nullif(claimed.payload#>>'{guest,email}', ''), app.applicant_email) as guest_email,
    (claimed.payload->>'should_refund')::boolean as should_refund,
    (claimed.payload->>'send_email')::boolean as send_email
  from claimed
  join public.luma_event_applications app on app.id = claimed.application_id
  join public.luma_events event on event.id = app.luma_event_id;
end;
$$;

comment on function public.claim_luma_writeback_jobs is
  'Claims queued Lu.ma writeback jobs with SKIP LOCKED. Optional bulk operation or job ids scope user-triggered immediate writebacks.';
