create extension if not exists pgcrypto;

create table if not exists public.event_ops_members (
  user_id uuid primary key,
  role text not null check (role in ('owner', 'manager', 'reviewer')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.event_ops_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_ops_members
    where user_id = auth.uid()
      and role in ('owner', 'manager', 'reviewer')
  );
$$;

create or replace function public.event_ops_can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_ops_members
    where user_id = auth.uid()
      and role in ('owner', 'manager')
  );
$$;

create table if not exists public.external_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('luma', 'resend', 'yc_directory', 'ai')),
  provider_account_id text not null,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

create table if not exists public.luma_events (
  id uuid primary key default gen_random_uuid(),
  external_account_id uuid references public.external_accounts(id) on delete set null,
  luma_event_id text not null,
  calendar_id text,
  title text not null,
  url text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  location_text text,
  capacity integer check (capacity is null or capacity >= 0),
  approval_mode text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_account_id, luma_event_id)
);

create table if not exists public.luma_event_applications (
  id uuid primary key default gen_random_uuid(),
  luma_event_id uuid not null references public.luma_events(id) on delete cascade,
  luma_guest_id text not null,
  applicant_name text not null,
  applicant_email text,
  applicant_phone text,
  luma_status text not null default 'pending_approval',
  approval_status text not null default 'manual' check (
    approval_status in ('ready', 'needs_info', 'awaiting_reply', 'manual', 'waitlist', 'approved', 'rejected')
  ),
  match_confidence numeric(5,2) not null default 0 check (match_confidence >= 0 and match_confidence <= 100),
  relation text,
  recommendation text,
  rule_code text,
  primary_action text not null default 'manual_review' check (
    primary_action in ('approve', 'send_info', 'manual_review', 'waitlist', 'none')
  ),
  selected_default boolean not null default false,
  luma_fields jsonb not null default '{}'::jsonb,
  luma_payload jsonb not null default '{}'::jsonb,
  ai_recommendation jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (luma_event_id, luma_guest_id)
);

create table if not exists public.applicant_identity_matches (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.luma_event_applications(id) on delete cascade,
  source_kind text not null check (
    source_kind in ('yc_founder', 'yc_company', 'yc_network', 'luma', 'email_reply', 'ai_review')
  ),
  source_record_id text,
  match_kind text not null check (
    match_kind in ('email', 'alternate_email', 'phone', 'name', 'company', 'batch', 'network', 'reply')
  ),
  confidence numeric(5,2) not null default 0 check (confidence >= 0 and confidence <= 100),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.applicant_source_comparisons (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.luma_event_applications(id) on delete cascade,
  field_name text not null check (
    field_name in ('email', 'alternate_email', 'phone', 'name', 'company', 'batch', 'role', 'network', 'reply')
  ),
  source_kind text not null check (
    source_kind in ('yc_founder', 'yc_company', 'yc_network', 'luma', 'email_reply', 'ai_review')
  ),
  luma_value text,
  yc_value text,
  result text not null check (result in ('match', 'partial', 'missing', 'conflict', 'not_checked')),
  weight numeric(5,2) not null default 0,
  notes text,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.applicant_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.luma_event_applications(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  decision text not null check (decision in ('approve', 'send_info', 'manual', 'waitlist', 'reject')),
  confidence numeric(5,2) not null check (confidence >= 0 and confidence <= 100),
  reasoning text not null,
  signals jsonb not null default '[]'::jsonb,
  input_summary jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  is_authoritative boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.luma_event_applications(id) on delete cascade,
  actor_id uuid,
  actor_name text,
  decision text not null check (decision in ('approve', 'reject', 'send_info', 'waitlist', 'manual_review')),
  prior_status text not null,
  next_status text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_bulk_operations (
  id uuid primary key default gen_random_uuid(),
  luma_event_id uuid not null references public.luma_events(id) on delete cascade,
  actor_id uuid,
  actor_name text,
  action text not null check (action in ('approve', 'reject', 'send_info', 'waitlist')),
  filter_payload jsonb not null default '{}'::jsonb,
  requested_count integer not null default 0 check (requested_count >= 0),
  applied_count integer not null default 0 check (applied_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.approval_bulk_operation_items (
  id uuid primary key default gen_random_uuid(),
  bulk_operation_id uuid not null references public.approval_bulk_operations(id) on delete cascade,
  application_id uuid not null references public.luma_event_applications(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'applied', 'skipped', 'failed')),
  reason text,
  created_at timestamptz not null default now(),
  unique (bulk_operation_id, application_id)
);

create table if not exists public.luma_writeback_jobs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.luma_event_applications(id) on delete cascade,
  bulk_operation_id uuid references public.approval_bulk_operations(id) on delete set null,
  target_status text not null check (target_status in ('approved', 'declined', 'pending_approval', 'waitlist')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  scheduled_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.clarification_email_jobs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.luma_event_applications(id) on delete cascade,
  bulk_operation_id uuid references public.approval_bulk_operations(id) on delete set null,
  to_email text not null,
  from_email text not null,
  subject text not null,
  body_preview text not null,
  resend_email_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.applicant_replies (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.luma_event_applications(id) on delete cascade,
  clarification_email_job_id uuid references public.clarification_email_jobs(id) on delete set null,
  provider_message_id text,
  from_email text not null,
  received_at timestamptz not null,
  subject text,
  body_text text,
  parsed_fields jsonb not null default '{}'::jsonb,
  ai_review_id uuid references public.applicant_ai_reviews(id) on delete set null,
  status text not null default 'pending_review' check (status in ('pending_review', 'auto_ready', 'manual', 'ignored')),
  created_at timestamptz not null default now()
);

create table if not exists public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('luma', 'resend')),
  event_type text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists luma_events_starts_at_idx on public.luma_events(starts_at);
create index if not exists luma_event_applications_event_status_idx
  on public.luma_event_applications(luma_event_id, approval_status);
create index if not exists luma_event_applications_email_idx
  on public.luma_event_applications(lower(applicant_email));
create index if not exists luma_event_applications_phone_idx
  on public.luma_event_applications(applicant_phone);
create index if not exists luma_event_applications_luma_payload_idx
  on public.luma_event_applications using gin(luma_payload);
create index if not exists applicant_identity_matches_application_idx
  on public.applicant_identity_matches(application_id);
create index if not exists applicant_source_comparisons_application_result_idx
  on public.applicant_source_comparisons(application_id, result);
create index if not exists applicant_ai_reviews_application_idx
  on public.applicant_ai_reviews(application_id, created_at desc);
create index if not exists approval_decisions_application_idx
  on public.approval_decisions(application_id, created_at desc);
create index if not exists luma_writeback_jobs_status_idx
  on public.luma_writeback_jobs(status, scheduled_at);
create index if not exists clarification_email_jobs_status_idx
  on public.clarification_email_jobs(status, scheduled_at);
create index if not exists provider_webhook_events_created_idx
  on public.provider_webhook_events(provider, created_at desc);

alter table public.event_ops_members enable row level security;
alter table public.external_accounts enable row level security;
alter table public.luma_events enable row level security;
alter table public.luma_event_applications enable row level security;
alter table public.applicant_identity_matches enable row level security;
alter table public.applicant_source_comparisons enable row level security;
alter table public.applicant_ai_reviews enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.approval_bulk_operations enable row level security;
alter table public.approval_bulk_operation_items enable row level security;
alter table public.luma_writeback_jobs enable row level security;
alter table public.clarification_email_jobs enable row level security;
alter table public.applicant_replies enable row level security;
alter table public.provider_webhook_events enable row level security;

drop policy if exists "event ops members can read own row" on public.event_ops_members;
create policy "event ops members can read own row"
  on public.event_ops_members for select
  to authenticated
  using (user_id = auth.uid() or public.event_ops_can_read());

drop policy if exists "event ops managers can manage memberships" on public.event_ops_members;
create policy "event ops managers can manage memberships"
  on public.event_ops_members for all
  to authenticated
  using (public.event_ops_can_write())
  with check (public.event_ops_can_write());

drop policy if exists "event ops can read external accounts" on public.external_accounts;
create policy "event ops can read external accounts" on public.external_accounts
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write external accounts" on public.external_accounts;
create policy "event ops can write external accounts" on public.external_accounts
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read luma events" on public.luma_events;
create policy "event ops can read luma events" on public.luma_events
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write luma events" on public.luma_events;
create policy "event ops can write luma events" on public.luma_events
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read luma applications" on public.luma_event_applications;
create policy "event ops can read luma applications" on public.luma_event_applications
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write luma applications" on public.luma_event_applications;
create policy "event ops can write luma applications" on public.luma_event_applications
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read identity matches" on public.applicant_identity_matches;
create policy "event ops can read identity matches" on public.applicant_identity_matches
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write identity matches" on public.applicant_identity_matches;
create policy "event ops can write identity matches" on public.applicant_identity_matches
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read source comparisons" on public.applicant_source_comparisons;
create policy "event ops can read source comparisons" on public.applicant_source_comparisons
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write source comparisons" on public.applicant_source_comparisons;
create policy "event ops can write source comparisons" on public.applicant_source_comparisons
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read ai reviews" on public.applicant_ai_reviews;
create policy "event ops can read ai reviews" on public.applicant_ai_reviews
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write ai reviews" on public.applicant_ai_reviews;
create policy "event ops can write ai reviews" on public.applicant_ai_reviews
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read decisions" on public.approval_decisions;
create policy "event ops can read decisions" on public.approval_decisions
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write decisions" on public.approval_decisions;
create policy "event ops can write decisions" on public.approval_decisions
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read bulk operations" on public.approval_bulk_operations;
create policy "event ops can read bulk operations" on public.approval_bulk_operations
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write bulk operations" on public.approval_bulk_operations;
create policy "event ops can write bulk operations" on public.approval_bulk_operations
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read bulk operation items" on public.approval_bulk_operation_items;
create policy "event ops can read bulk operation items" on public.approval_bulk_operation_items
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write bulk operation items" on public.approval_bulk_operation_items;
create policy "event ops can write bulk operation items" on public.approval_bulk_operation_items
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read luma writeback jobs" on public.luma_writeback_jobs;
create policy "event ops can read luma writeback jobs" on public.luma_writeback_jobs
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write luma writeback jobs" on public.luma_writeback_jobs;
create policy "event ops can write luma writeback jobs" on public.luma_writeback_jobs
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read clarification email jobs" on public.clarification_email_jobs;
create policy "event ops can read clarification email jobs" on public.clarification_email_jobs
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write clarification email jobs" on public.clarification_email_jobs;
create policy "event ops can write clarification email jobs" on public.clarification_email_jobs
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read applicant replies" on public.applicant_replies;
create policy "event ops can read applicant replies" on public.applicant_replies
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write applicant replies" on public.applicant_replies;
create policy "event ops can write applicant replies" on public.applicant_replies
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read provider webhooks" on public.provider_webhook_events;
create policy "event ops can read provider webhooks" on public.provider_webhook_events
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write provider webhooks" on public.provider_webhook_events;
create policy "event ops can write provider webhooks" on public.provider_webhook_events
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

comment on table public.luma_event_applications is
  'Lu.ma guest/application rows normalized for YC OS event approvals. Preserve luma_payload and luma_fields for source review.';
comment on table public.applicant_source_comparisons is
  'Field-level comparison between Lu.ma application data, YC records, reply parsing, network context, and AI review signals.';
comment on table public.applicant_ai_reviews is
  'AI recommendations are advisory. User-triggered approval_decisions remain the authoritative event operation.';
