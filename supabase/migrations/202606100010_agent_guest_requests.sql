create table if not exists public.agent_guest_requests (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('event_guests.add')),
  event_id text not null,
  luma_event_id text,
  event_title text not null,
  event_kind text not null check (event_kind in ('real', 'demo')),
  guest_adds text not null check (guest_adds in ('available', 'dry_run_only')),
  status text not null default 'pending' check (status in ('dry_run', 'pending', 'running', 'sent_to_luma', 'failed', 'blocked')),
  execute_requested boolean not null default false,
  approval_status text not null check (approval_status in ('approved', 'pending_approval', 'waitlist')),
  send_email boolean not null default false,
  requested_count integer not null check (requested_count >= 1 and requested_count <= 10),
  actor_name text,
  reason text,
  guests jsonb not null default '[]'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  scheduled_at timestamptz not null default now(),
  completed_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_guest_requests_status_created_idx
  on public.agent_guest_requests(status, scheduled_at, created_at desc);

create index if not exists agent_guest_requests_event_created_idx
  on public.agent_guest_requests(event_id, created_at desc);

alter table public.agent_guest_requests enable row level security;

drop policy if exists "event ops can read agent guest requests" on public.agent_guest_requests;
create policy "event ops can read agent guest requests" on public.agent_guest_requests
  for select using (public.event_ops_can_read());

drop policy if exists "event ops can write agent guest requests" on public.agent_guest_requests;
create policy "event ops can write agent guest requests" on public.agent_guest_requests
  for all using (public.event_ops_can_write()) with check (public.event_ops_can_write());

comment on table public.agent_guest_requests is
  'Internal YC OS audit/request records for scoped agent guest-add actions. Public agent responses expose only request status, not provider secrets.';

create or replace function public.claim_agent_guest_requests(
  p_limit integer default 10,
  p_worker_id text default 'yc-os-agent-guests'
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

comment on function public.claim_agent_guest_requests is
  'Claims queued YC OS agent guest-add requests with SKIP LOCKED so backend workers, not agents, own provider retries.';

revoke all on function public.claim_agent_guest_requests(integer, text) from public;
grant execute on function public.claim_agent_guest_requests(integer, text) to service_role;
