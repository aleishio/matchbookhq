update public.luma_events
set
  title = 'AI Infra Office Hours in SF',
  raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
    'primary_event', true,
    'default_for', jsonb_build_array('approvals', 'event_prep'),
    'default_rank', 0
  )
where
  coalesce(raw_payload->>'seed_id', '') = 'ai-infra-office-hours'
  or luma_event_id = 'ai-infra-office-hours'
  or lower(title) like '%ai infra%';

update public.luma_events
set raw_payload = coalesce(raw_payload, '{}'::jsonb) - 'primary_event' - 'default_for' || jsonb_build_object(
  'default_rank',
  case
    when lower(title) like '%dogpatch%' then 1
    else 2
  end
)
where
  not (
    coalesce(raw_payload->>'seed_id', '') = 'ai-infra-office-hours'
    or luma_event_id = 'ai-infra-office-hours'
    or lower(title) like '%ai infra%'
  );

update public.yc_events
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'primary_event', true,
  'default_for', jsonb_build_array('approvals', 'event_prep'),
  'approval_event_ids',
  jsonb_build_array('yc-founder-mixer', 'ai-infra-office-hours', 'founder-dinner'),
  'primary_approval_event_id',
  'ai-infra-office-hours',
  'display_kind',
  'example'
)
where id = 'w26-founder-mixer-example';
