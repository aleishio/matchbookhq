# Email Replies and Tracking Schema

This started as the schema plan for the Resend + Supabase backend. The current
implementation uses the approved event approvals tables already in the app:
`provider_webhook_events`, `clarification_email_jobs`, `applicant_replies`, and
`applicant_ai_reviews`.

## Product Goal

Users should be able to reply to emails from YC OS. Replies should be captured,
stored in Supabase, and queued for AI analysis. Link/open tracking should also be
stored so we can understand whether a founder engaged before or after replying.

For event approvals, the main reply use case is identity clarification. An ops
user sends an email from the approval queue, the applicant replies with YC
company/batch/contact details, and the backend analyzes that reply before the
application is approved, rejected, or kept in manual review.

Resend Automations are not the right primary system for this. Automations send
email steps from custom app events. Inbound replies and tracking should use:

- Resend Receiving for `email.received`.
- Resend Webhooks for `email.received`, `email.clicked`, `email.opened`, and
  delivery lifecycle events.
- Supabase tables for durable event storage and analysis state.

Automations may become useful later for follow-up sequences after our app has
already analyzed a reply and emitted its own custom event.

## Resend Configuration State

Domain: `events.matchbookhq.com`

Already enabled in Resend:

- Sending
- Receiving
- Receiving MX is verified
- Open tracking
- Click tracking
- Tracking subdomain: `links.events.matchbookhq.com`

Pending DNS record in Cloudflare:

```text
CNAME  links.events     links1.resend-dns.com
```

After the tracking CNAME propagates, verify the domain in Resend again. The
domain is expected to move from `partially_verified` back to `verified`.

## Webhook Events

Resend webhook already configured:

```text
POST https://matchbookhq.com/api/resend/webhook
```

Configured event types:

```text
email.received
email.clicked
email.opened
email.delivered
email.bounced
email.complained
email.failed
email.suppressed
```

Store the webhook signing secret as:

```text
RESEND_WEBHOOK_SECRET
```

The backend must verify Svix headers before doing any work:

```text
svix-id
svix-timestamp
svix-signature
```

Use `svix-id` for idempotency because Resend webhooks are delivered at least
once and may be replayed.

## Tables

These table definitions are still design candidates. They should be finalized
with the broader Supabase event approvals schema before any migration is
created.

### `resend_webhook_events`

Raw immutable event ledger. This is the first write for every webhook.

```sql
create table public.resend_webhook_events (
  id uuid primary key default gen_random_uuid(),
  svix_id text not null unique,
  event_type text not null,
  event_created_at timestamptz,
  webhook_received_at timestamptz not null default now(),
  resend_email_id text,
  payload jsonb not null,
  processing_status text not null default 'stored',
  processing_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
```

Indexes:

```sql
create index resend_webhook_events_event_type_idx
  on public.resend_webhook_events(event_type);

create index resend_webhook_events_resend_email_id_idx
  on public.resend_webhook_events(resend_email_id);
```

### `email_replies`

Normalized inbound replies. Resend `email.received` webhooks contain metadata
only; the backend must call the Resend Receiving API to fetch text, HTML,
headers, and attachment metadata.

```sql
create table public.email_replies (
  id uuid primary key default gen_random_uuid(),
  resend_email_id text not null unique,
  svix_id text unique,
  outbound_email_job_id uuid,
  event_application_id uuid,
  message_id text,
  from_email text not null,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  bcc_emails text[] not null default '{}',
  reply_to_emails text[] not null default '{}',
  subject text,
  text_body text,
  html_body text,
  headers jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz,
  webhook_received_at timestamptz not null default now(),
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'processing', 'complete', 'failed', 'skipped')),
  analysis_result jsonb,
  analysis_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Indexes:

```sql
create index email_replies_from_email_idx
  on public.email_replies(from_email);

create index email_replies_analysis_status_idx
  on public.email_replies(analysis_status);

create index email_replies_event_application_id_idx
  on public.email_replies(event_application_id);
```

### `email_engagement_events`

Normalized send/open/click/delivery events. `email.clicked` rows should store
the clicked URL separately for quick analysis.

```sql
create table public.email_engagement_events (
  id uuid primary key default gen_random_uuid(),
  svix_id text not null unique,
  resend_email_id text,
  outbound_email_job_id uuid,
  event_application_id uuid,
  event_type text not null,
  event_created_at timestamptz,
  webhook_received_at timestamptz not null default now(),
  subject text,
  from_email text,
  to_emails text[] not null default '{}',
  clicked_url text,
  click_ip text,
  click_user_agent text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
```

Indexes:

```sql
create index email_engagement_events_resend_email_id_idx
  on public.email_engagement_events(resend_email_id);

create index email_engagement_events_event_type_idx
  on public.email_engagement_events(event_type);

create index email_engagement_events_event_application_id_idx
  on public.email_engagement_events(event_application_id);
```

### Approval-Specific Reply Interpretation

The final approval schema should include a table that links a normalized inbound
reply to an application-level interpretation. This keeps raw email storage
separate from the approval decision model.

Candidate table: `applicant_reply_reviews`

Fields to design:

- `id`
- `event_application_id`
- `email_reply_id`
- `analysis_status`
- `model`
- `prompt_version`
- `extracted_company`
- `extracted_batch`
- `extracted_yc_email`
- `extracted_role`
- `relationship_summary`
- `recommended_queue`
- `recommended_action`
- `confidence_label`
- `reason`
- `evidence`
- `reviewed_by`
- `reviewed_at`
- `created_at`

Recommended queues should be limited to values the approval UI understands:
`ready`, `manual`, `needs_info`, and `rejected_candidate`. The AI should not
write directly to Lu.ma.

## Security

Enable RLS on all three tables. Do not add browser-readable policies at first.
The webhook backend should write with the server-side Supabase service role.

```sql
alter table public.resend_webhook_events enable row level security;
alter table public.email_replies enable row level security;
alter table public.email_engagement_events enable row level security;
```

Required server-only env vars for the later backend:

```text
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
```

## Current Backend Flow

1. Receive webhook request at `POST /api/resend/webhook`.
2. Read the raw request body.
3. Verify the Resend webhook signature with `RESEND_WEBHOOK_SECRET`.
4. Insert the raw event into `provider_webhook_events` using `svix-id` as
   `provider_event_id` for idempotency.
5. If `event.type === "email.received"`, call the Resend Receiving API for the
   full email content and insert a linked row into `applicant_replies` when the
   sender matches an approval application or clarification email job.
6. If the event is `email.clicked` or `email.opened`, keep it in the raw
   provider webhook ledger until a dedicated engagement table is approved.
7. Link the email to an outbound clarification job and event application when
   possible.
8. Store parsed reply fields as advisory evidence for the approvals UI.
9. Run AI analysis in a separate worker or cron job that claims pending replies,
   writes `analysis_result`, and marks rows `complete` or `failed`.
10. For approval replies, write an approval-specific interpretation row and
   update the application queue only through the approval workflow.

## AI Analysis Output Shape

Use structured JSON in `email_replies.analysis_result`:

```json
{
  "sentiment": "positive",
  "intent": "interested",
  "urgency": "normal",
  "summary": "Founder is interested and asked for a time next week.",
  "follow_up_required": true,
  "suggested_next_step": "Offer two meeting slots.",
  "entities": {
    "company": null,
    "person": null
  }
}
```

Keep raw email bodies in `email_replies`; store only the model's structured
interpretation in `analysis_result`.

For event approval clarification replies, use a stricter shape:

```json
{
  "intent": "identity_clarification",
  "summary": "Applicant says they are a W24 founder at ExampleCo and used a personal email on Lu.ma.",
  "recommended_queue": "ready",
  "recommended_action": "approve_candidate",
  "confidence_label": "high",
  "reason": "Reply includes company, batch, role, and a YC-connected email candidate.",
  "extracted": {
    "company": "ExampleCo",
    "batch": "W24",
    "yc_email": "founder@example.com",
    "role": "founder",
    "relationship": "founder"
  },
  "missing": [],
  "manual_review_required": false
}
```

If `confidence_label` is not `high`, or if the applicant claims investor/network
status without a mapped trusted record, the recommended queue should be
`manual`.
