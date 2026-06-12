insert into public.yc_events (
  id,
  title,
  location,
  starts_at,
  attendee_count,
  source_kind,
  source_url,
  metadata
)
select
  'w26-founder-mixer-example',
  'W26 Founder Mixer Example',
  'Dogpatch Labs, San Francisco',
  '2026-06-24T01:00:00Z'::timestamptz,
  count(*),
  'synthetic_example',
  null,
  jsonb_build_object(
    'display_kind', 'example',
    'copied_from_event_id', 'yc-w26-event-prep',
    'description', 'Large synthetic event-prep example copied from public YC W26 data.'
  )
from public.yc_event_attendance
where event_id = 'yc-w26-event-prep'
on conflict (id) do update
set
  title = excluded.title,
  location = excluded.location,
  starts_at = excluded.starts_at,
  attendee_count = excluded.attendee_count,
  source_kind = excluded.source_kind,
  source_url = excluded.source_url,
  metadata = public.yc_events.metadata || excluded.metadata;

insert into public.yc_event_attendance (
  event_id,
  founder_id,
  company_id,
  status,
  source,
  metadata
)
select
  'w26-founder-mixer-example',
  founder_id,
  company_id,
  status,
  'synthetic_example',
  metadata || jsonb_build_object('copied_from_event_id', event_id)
from public.yc_event_attendance
where event_id = 'yc-w26-event-prep'
on conflict (event_id, founder_id) do update
set
  company_id = excluded.company_id,
  status = excluded.status,
  source = excluded.source,
  metadata = excluded.metadata;

insert into public.yc_founder_needs (
  id,
  event_id,
  founder_id,
  company_id,
  need_text,
  need_category,
  source,
  source_url,
  is_current,
  created_at,
  updated_at,
  metadata
)
select
  'w26-founder-mixer-example_' || id,
  'w26-founder-mixer-example',
  founder_id,
  company_id,
  need_text,
  need_category,
  source,
  source_url,
  is_current,
  created_at,
  updated_at,
  metadata || jsonb_build_object('copied_from_event_id', event_id)
from public.yc_founder_needs
where event_id = 'yc-w26-event-prep'
on conflict (id) do update
set
  need_text = excluded.need_text,
  need_category = excluded.need_category,
  source = excluded.source,
  source_url = excluded.source_url,
  is_current = excluded.is_current,
  updated_at = excluded.updated_at,
  metadata = excluded.metadata;

insert into public.yc_notes (
  id,
  event_id,
  founder_id,
  company_id,
  note_type,
  body,
  source_kind,
  source_url,
  author_id,
  author_name,
  visibility,
  created_at,
  updated_at,
  metadata
)
select
  'w26-founder-mixer-example_' || id,
  'w26-founder-mixer-example',
  founder_id,
  company_id,
  note_type,
  body,
  source_kind,
  source_url,
  author_id,
  author_name,
  visibility,
  created_at,
  updated_at,
  metadata || jsonb_build_object('copied_from_event_id', event_id)
from public.yc_notes
where event_id = 'yc-w26-event-prep'
on conflict (id) do update
set
  note_type = excluded.note_type,
  body = excluded.body,
  source_kind = excluded.source_kind,
  source_url = excluded.source_url,
  author_id = excluded.author_id,
  author_name = excluded.author_name,
  visibility = excluded.visibility,
  updated_at = excluded.updated_at,
  metadata = excluded.metadata;

insert into public.yc_intro_suggestions (
  id,
  event_id,
  from_founder_id,
  to_founder_id,
  fit_label,
  reason,
  opener,
  caution,
  evidence,
  same_company,
  algorithm_version,
  created_at
)
select
  replace(id, 'yc-w26-event-prep', 'w26-founder-mixer-example'),
  'w26-founder-mixer-example',
  from_founder_id,
  to_founder_id,
  fit_label,
  reason,
  opener,
  caution,
  evidence,
  same_company,
  algorithm_version,
  created_at
from public.yc_intro_suggestions
where event_id = 'yc-w26-event-prep'
on conflict (event_id, from_founder_id, to_founder_id, algorithm_version) do update
set
  fit_label = excluded.fit_label,
  reason = excluded.reason,
  opener = excluded.opener,
  caution = excluded.caution,
  evidence = excluded.evidence,
  same_company = excluded.same_company;

update public.yc_events
set metadata = metadata || jsonb_build_object('display_kind', 'hidden')
where id = 'yc-w26-event-prep';

update public.yc_events
set
  source_url = coalesce(source_url, metadata->>'luma_url'),
  metadata = metadata || jsonb_build_object(
    'display_kind', 'live',
    'luma_url', coalesce(source_url, metadata->>'luma_url')
  )
where id = 'dogpatch-founder-breakfast';
