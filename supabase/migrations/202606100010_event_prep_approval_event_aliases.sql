update public.yc_events
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'approval_event_ids',
  jsonb_build_array('yc-founder-mixer', 'ai-infra-office-hours', 'founder-dinner'),
  'description',
  coalesce(metadata->>'description', 'Large synthetic event-prep example copied from public YC W26 data.')
)
where id = 'w26-founder-mixer-example';

update public.yc_events
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'approval_event_ids',
  jsonb_build_array('dogpatch-founder-breakfast'),
  'display_kind',
  'live',
  'luma_url',
  coalesce(source_url, metadata->>'luma_url')
)
where id = 'dogpatch-founder-breakfast';
