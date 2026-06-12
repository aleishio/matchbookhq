create extension if not exists pgcrypto;

create table if not exists public.yc_events (
  id text primary key,
  title text not null,
  location text,
  starts_at timestamptz,
  attendee_count integer check (attendee_count is null or attendee_count >= 0),
  source_kind text,
  source_url text,
  retrieved_at timestamptz,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.yc_companies (
  id text primary key,
  source_id text,
  name text not null,
  slug text,
  batch text,
  stage text,
  category text,
  industry text,
  subindustry text,
  one_liner text,
  long_description text,
  website text,
  yc_url text,
  location text,
  city text,
  country text,
  team_size integer check (team_size is null or team_size >= 0),
  year_founded integer,
  is_hiring boolean,
  top_company boolean,
  tags text[] not null default '{}'::text[],
  regions text[] not null default '{}'::text[],
  primary_group_partner jsonb,
  social_links jsonb not null default '{}'::jsonb,
  image_paths jsonb not null default '{}'::jsonb,
  public_counts jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

create table if not exists public.yc_founders (
  id text primary key,
  source_id text,
  company_id text not null references public.yc_companies(id) on delete cascade,
  name text not null,
  role text,
  location text,
  bio text,
  is_active boolean,
  has_public_email_flag boolean,
  social_links jsonb not null default '{}'::jsonb,
  image_paths jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

create table if not exists public.yc_event_attendance (
  event_id text not null references public.yc_events(id) on delete cascade,
  founder_id text not null references public.yc_founders(id) on delete cascade,
  company_id text references public.yc_companies(id) on delete set null,
  status text not null default 'expected',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (event_id, founder_id)
);

create table if not exists public.yc_founder_needs (
  id text primary key,
  event_id text references public.yc_events(id) on delete cascade,
  founder_id text not null references public.yc_founders(id) on delete cascade,
  company_id text references public.yc_companies(id) on delete set null,
  need_text text not null,
  need_category text,
  source text,
  source_url text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.yc_notes (
  id text primary key,
  event_id text references public.yc_events(id) on delete cascade,
  founder_id text references public.yc_founders(id) on delete cascade,
  company_id text references public.yc_companies(id) on delete set null,
  note_type text not null check (note_type in ('office_hours', 'other_founder', 'room', 'user')),
  body text not null,
  source_kind text,
  source_url text,
  author_id uuid,
  author_name text,
  visibility text not null default 'team',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.yc_intro_suggestions (
  id text primary key,
  event_id text not null references public.yc_events(id) on delete cascade,
  from_founder_id text not null references public.yc_founders(id) on delete cascade,
  to_founder_id text not null references public.yc_founders(id) on delete cascade,
  fit_label text not null check (fit_label in ('strong', 'good', 'check')),
  reason text not null,
  opener text,
  caution text,
  evidence jsonb not null default '[]'::jsonb,
  same_company boolean not null default false,
  algorithm_version text not null,
  created_at timestamptz not null default now(),
  unique (event_id, from_founder_id, to_founder_id, algorithm_version)
);

create index if not exists yc_events_starts_at_idx on public.yc_events(starts_at);
create index if not exists yc_companies_batch_idx on public.yc_companies(batch);
create index if not exists yc_companies_tags_idx on public.yc_companies using gin(tags);
create index if not exists yc_founders_company_idx on public.yc_founders(company_id);
create index if not exists yc_event_attendance_event_idx on public.yc_event_attendance(event_id, status);
create index if not exists yc_founder_needs_event_founder_idx
  on public.yc_founder_needs(event_id, founder_id)
  where is_current;
create index if not exists yc_notes_event_founder_idx on public.yc_notes(event_id, founder_id, created_at desc);
create index if not exists yc_intro_suggestions_event_from_idx
  on public.yc_intro_suggestions(event_id, from_founder_id);
create index if not exists yc_intro_suggestions_event_to_idx
  on public.yc_intro_suggestions(event_id, to_founder_id);

alter table public.yc_events enable row level security;
alter table public.yc_companies enable row level security;
alter table public.yc_founders enable row level security;
alter table public.yc_event_attendance enable row level security;
alter table public.yc_founder_needs enable row level security;
alter table public.yc_notes enable row level security;
alter table public.yc_intro_suggestions enable row level security;

drop policy if exists "event ops can read yc events" on public.yc_events;
create policy "event ops can read yc events" on public.yc_events
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write yc events" on public.yc_events;
create policy "event ops can write yc events" on public.yc_events
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read yc companies" on public.yc_companies;
create policy "event ops can read yc companies" on public.yc_companies
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write yc companies" on public.yc_companies;
create policy "event ops can write yc companies" on public.yc_companies
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read yc founders" on public.yc_founders;
create policy "event ops can read yc founders" on public.yc_founders
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write yc founders" on public.yc_founders;
create policy "event ops can write yc founders" on public.yc_founders
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read yc attendance" on public.yc_event_attendance;
create policy "event ops can read yc attendance" on public.yc_event_attendance
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write yc attendance" on public.yc_event_attendance;
create policy "event ops can write yc attendance" on public.yc_event_attendance
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read yc needs" on public.yc_founder_needs;
create policy "event ops can read yc needs" on public.yc_founder_needs
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write yc needs" on public.yc_founder_needs;
create policy "event ops can write yc needs" on public.yc_founder_needs
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read yc notes" on public.yc_notes;
create policy "event ops can read yc notes" on public.yc_notes
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write yc notes" on public.yc_notes;
create policy "event ops can write yc notes" on public.yc_notes
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

drop policy if exists "event ops can read yc intros" on public.yc_intro_suggestions;
create policy "event ops can read yc intros" on public.yc_intro_suggestions
  for select to authenticated using (public.event_ops_can_read());
drop policy if exists "event ops can write yc intros" on public.yc_intro_suggestions;
create policy "event ops can write yc intros" on public.yc_intro_suggestions
  for all to authenticated using (public.event_ops_can_write()) with check (public.event_ops_can_write());

comment on table public.yc_events is
  'Public YC event-prep event records imported for YC OS demos and ops workflows.';
comment on table public.yc_founders is
  'Public YC founder directory data only. Do not import private office-hours data without explicit auth and retention rules.';
comment on table public.yc_notes is
  'Event-prep notes and generated public-profile notes. Private notes require explicit visibility and access policy review.';
comment on table public.yc_intro_suggestions is
  'Durable intro suggestions generated from public YC profile, need, and event context signals.';
