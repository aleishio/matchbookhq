insert into public.yc_events (
  id,
  title,
  location,
  starts_at,
  attendee_count,
  source_kind,
  source_url,
  retrieved_at,
  metadata
)
select
  event.id::text,
  event.title,
  event.location_text,
  event.starts_at,
  0,
  'luma_approval',
  event.url,
  event.synced_at,
  jsonb_build_object(
    'agent_write_anchor', true,
    'luma_event_id', event.luma_event_id,
    'calendar_id', event.calendar_id
  )
from public.luma_events event
on conflict (id) do nothing;

comment on table public.yc_events is
  'YC OS event-prep event anchors, including Lu.ma approval events that agents can enrich or attach attendees to.';
