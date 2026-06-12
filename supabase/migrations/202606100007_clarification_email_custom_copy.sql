drop function if exists public.queue_luma_approval_action(uuid[], text, uuid, text, text, jsonb, boolean);

create or replace function public.queue_luma_approval_action(
  p_application_ids uuid[],
  p_action text,
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_reason text default null,
  p_filter_payload jsonb default '{}'::jsonb,
  p_dry_run boolean default false,
  p_email_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer := coalesce(array_length(p_application_ids, 1), 0);
  v_applied_count integer := 0;
  v_skipped_count integer := 0;
  v_event_count integer := 0;
  v_event_id uuid;
  v_operation_id uuid;
  v_next_status text;
  v_decision_id uuid;
  v_eligible boolean;
  v_skip_reason text;
  v_email_payload jsonb;
  v_email_subject text;
  v_email_body text;
  v_updated_count integer;
  rec record;
begin
  v_email_payload := case
    when jsonb_typeof(coalesce(p_email_payload, '{}'::jsonb)) = 'object' then coalesce(p_email_payload, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_email_subject := left(
    coalesce(nullif(btrim(v_email_payload->>'subject'), ''), 'Confirming your YC event details'),
    140
  );
  v_email_body := left(
    coalesce(
      nullif(btrim(v_email_payload->>'body'), ''),
      'Please reply with your YC company, batch, role, and any mapped YC email.'
    ),
    2000
  );

  if auth.role() <> 'service_role' and not public.event_ops_can_write() then
    raise exception 'event ops write access required';
  end if;

  if v_requested_count = 0 then
    raise exception 'queue_luma_approval_action requires at least one application id';
  end if;

  if p_action not in ('approve', 'reject', 'send_info', 'waitlist') then
    raise exception 'unsupported approval action %', p_action;
  end if;

  select count(distinct luma_event_id), min(luma_event_id::text)::uuid
  into v_event_count, v_event_id
  from public.luma_event_applications
  where id = any(p_application_ids);

  if v_event_count <> 1 then
    raise exception 'all approval action targets must belong to exactly one Lu.ma event';
  end if;

  v_next_status := case p_action
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    when 'send_info' then 'awaiting_reply'
    when 'waitlist' then 'waitlist'
  end;

  if not p_dry_run then
    insert into public.approval_bulk_operations (
      luma_event_id,
      actor_id,
      actor_name,
      action,
      filter_payload,
      requested_count,
      status
    )
    values (
      v_event_id,
      p_actor_id,
      p_actor_name,
      p_action,
      coalesce(p_filter_payload, '{}'::jsonb),
      v_requested_count,
      'running'
    )
    returning id into v_operation_id;
  end if;

  for rec in
    select
      app.*,
      event.luma_event_id as event_api_id
    from public.luma_event_applications app
    join public.luma_events event on event.id = app.luma_event_id
    where app.id = any(p_application_ids)
    order by app.created_at, app.id
  loop
    v_eligible := case p_action
      when 'approve' then rec.approval_status not in ('approved', 'rejected')
      when 'reject' then rec.approval_status not in ('approved', 'rejected')
      when 'send_info' then rec.approval_status in ('needs_info', 'manual')
      when 'waitlist' then rec.approval_status in ('ready', 'manual', 'needs_info')
      else false
    end;
    v_skip_reason := null;

    if p_action = 'send_info' and (rec.applicant_email is null or rec.applicant_email = '') then
      v_eligible := false;
      v_skip_reason := 'missing applicant email';
    end if;

    if not v_eligible then
      v_skipped_count := v_skipped_count + 1;
      if not p_dry_run then
        insert into public.approval_bulk_operation_items (
          bulk_operation_id,
          application_id,
          status,
          reason
        )
        values (
          v_operation_id,
          rec.id,
          'skipped',
          coalesce(v_skip_reason, rec.approval_status || ' is not eligible for ' || p_action)
        );
      end if;
      continue;
    end if;

    if p_dry_run then
      v_applied_count := v_applied_count + 1;
      continue;
    end if;

    update public.luma_event_applications
    set
      approval_status = v_next_status,
      primary_action = case when v_next_status in ('approved', 'rejected', 'waitlist') then 'none' else 'manual_review' end,
      updated_at = now()
    where id = rec.id
      and approval_status = rec.approval_status;

    get diagnostics v_updated_count = row_count;

    if v_updated_count = 0 then
      v_skipped_count := v_skipped_count + 1;
      insert into public.approval_bulk_operation_items (
        bulk_operation_id,
        application_id,
        status,
        reason
      )
      values (
        v_operation_id,
        rec.id,
        'skipped',
        'approval status changed before action could be applied'
      );
      continue;
    end if;

    v_applied_count := v_applied_count + 1;

    insert into public.approval_decisions (
      application_id,
      actor_id,
      actor_name,
      decision,
      prior_status,
      next_status,
      reason,
      metadata
    )
    values (
      rec.id,
      p_actor_id,
      p_actor_name,
      case p_action when 'approve' then 'approve' when 'reject' then 'reject' when 'send_info' then 'send_info' else 'waitlist' end,
      rec.approval_status,
      v_next_status,
      p_reason,
      jsonb_build_object('bulk_operation_id', v_operation_id)
    )
    returning id into v_decision_id;

    insert into public.approval_bulk_operation_items (
      bulk_operation_id,
      application_id,
      status,
      reason
    )
    values (
      v_operation_id,
      rec.id,
      'applied',
      p_reason
    );

    if p_action in ('approve', 'reject') then
      insert into public.luma_writeback_jobs (
        application_id,
        bulk_operation_id,
        decision_id,
        target_status,
        payload,
        idempotency_key
      )
      values (
        rec.id,
        v_operation_id,
        v_decision_id,
        case when p_action = 'approve' then 'approved' else 'declined' end,
        jsonb_build_object(
          'event_api_id', rec.event_api_id,
          'guest', case
            when nullif(rec.luma_fields->>'guest_api_id', '') is not null then
              jsonb_build_object('type', 'api_id', 'api_id', rec.luma_fields->>'guest_api_id')
            else
              jsonb_build_object('type', 'email', 'email', rec.applicant_email)
          end,
          'status', case when p_action = 'approve' then 'approved' else 'declined' end,
          'send_email', false
        ),
        md5(v_operation_id::text || ':' || rec.id::text || ':' || p_action)
      )
      on conflict (idempotency_key) where idempotency_key is not null do nothing;
    elsif p_action = 'send_info' then
      insert into public.clarification_email_jobs (
        application_id,
        bulk_operation_id,
        to_email,
        from_email,
        subject,
        body_preview,
        payload
      )
      values (
        rec.id,
        v_operation_id,
        rec.applicant_email,
        'yc@events.matchbookhq.com',
        v_email_subject,
        v_email_body,
        jsonb_build_object(
          'event_api_id', rec.event_api_id,
          'guest_api_id', rec.luma_guest_id,
          'template', 'event_approval_clarification',
          'subject', v_email_subject,
          'body', v_email_body,
          'body_preview', v_email_body,
          'custom_copy', (v_email_payload ? 'subject') or (v_email_payload ? 'body')
        )
      );
    end if;
  end loop;

  if not p_dry_run then
    update public.approval_bulk_operations
    set
      applied_count = v_applied_count,
      skipped_count = v_skipped_count,
      status = 'completed',
      completed_at = now()
    where id = v_operation_id;
  end if;

  return jsonb_build_object(
    'operation_id', v_operation_id,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'applied_count', v_applied_count,
    'skipped_count', v_skipped_count
  );
end;
$$;

comment on function public.queue_luma_approval_action is
  'Atomically records user-triggered approval decisions, bulk operation items, and external jobs. Optional user-authored clarification email copy is stored on clarification_email_jobs and is not an AI decision.';

revoke all on function public.queue_luma_approval_action(uuid[], text, uuid, text, text, jsonb, boolean, jsonb) from public;
grant execute on function public.queue_luma_approval_action(uuid[], text, uuid, text, text, jsonb, boolean, jsonb) to authenticated, service_role;
