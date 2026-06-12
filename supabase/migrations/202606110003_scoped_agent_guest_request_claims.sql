create or replace function public.claim_agent_guest_requests(
  p_limit integer default 10,
  p_worker_id text default 'yc-os-agent-guests',
  p_request_id uuid default null
)
returns table (
  id uuid,
  event_id text,
  luma_event_id text,
  approval_status text,
  guests jsonb,
  send_email boolean,
  attempt_count integer
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
    select request.id
    from public.agent_guest_requests request
    where request.status in ('pending', 'failed')
      and request.execute_requested is true
      and request.event_kind = 'real'
      and request.guest_adds = 'available'
      and request.luma_event_id is not null
      and request.scheduled_at <= now()
      and request.attempt_count < 8
      and request.completed_at is null
      and (p_request_id is null or request.id = p_request_id)
    order by request.scheduled_at, request.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update skip locked
  ),
  claimed as (
    update public.agent_guest_requests request
    set
      status = 'running',
      attempt_count = request.attempt_count + 1,
      locked_at = now(),
      locked_by = coalesce(p_worker_id, 'yc-os-agent-guests'),
      error_message = null,
      updated_at = now()
    from candidates
    where request.id = candidates.id
    returning request.*
  )
  select
    claimed.id,
    claimed.event_id,
    claimed.luma_event_id,
    claimed.approval_status,
    claimed.guests,
    claimed.send_email,
    claimed.attempt_count
  from claimed;
end;
$$;

comment on function public.claim_agent_guest_requests(integer, text, uuid) is
  'Claims queued YC OS agent guest-add requests with SKIP LOCKED. Optional request id scopes immediate MCP-triggered execution to one request.';

revoke all on function public.claim_agent_guest_requests(integer, text, uuid) from public;
grant execute on function public.claim_agent_guest_requests(integer, text, uuid) to service_role;
