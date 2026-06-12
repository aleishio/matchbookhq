create unique index if not exists applicant_replies_provider_message_id_unique_idx
  on public.applicant_replies(provider_message_id)
  where provider_message_id is not null;

create index if not exists clarification_email_jobs_to_email_created_idx
  on public.clarification_email_jobs(lower(to_email), created_at desc);

create index if not exists clarification_email_jobs_resend_email_id_idx
  on public.clarification_email_jobs(resend_email_id)
  where resend_email_id is not null;

comment on index public.applicant_replies_provider_message_id_unique_idx is
  'Makes Resend inbound reply ingestion idempotent across webhook replays.';
comment on index public.clarification_email_jobs_to_email_created_idx is
  'Supports linking inbound Resend replies to the latest clarification job by applicant email.';
