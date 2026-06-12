create index if not exists clarification_email_jobs_application_created_idx
  on public.clarification_email_jobs(application_id, created_at desc);

create index if not exists applicant_replies_application_created_idx
  on public.applicant_replies(application_id, created_at desc);

create index if not exists applicant_replies_ai_review_id_idx
  on public.applicant_replies(ai_review_id)
  where ai_review_id is not null;

comment on index public.clarification_email_jobs_application_created_idx is
  'Supports approval DTO mapping of the latest clarification email job per application.';
comment on index public.applicant_replies_application_created_idx is
  'Supports approval DTO mapping of the latest applicant reply per application.';
