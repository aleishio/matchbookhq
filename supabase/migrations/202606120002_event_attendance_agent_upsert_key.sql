do $$
begin
  if not exists (
    select 1
    from pg_index idx
    join pg_class table_class on table_class.oid = idx.indrelid
    join pg_namespace table_schema on table_schema.oid = table_class.relnamespace
    where table_schema.nspname = 'public'
      and table_class.relname = 'yc_event_attendance'
      and idx.indisunique
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(idx.indkey) with ordinality as key(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = table_class.oid
          and attribute.attnum = key.attnum
      ) = array['event_id', 'founder_id']
  ) then
    create unique index yc_event_attendance_event_founder_uidx
      on public.yc_event_attendance(event_id, founder_id);

    comment on index public.yc_event_attendance_event_founder_uidx is
      'Supports idempotent YC OS agent attendance upserts keyed by event and founder.';
  end if;
end $$;
