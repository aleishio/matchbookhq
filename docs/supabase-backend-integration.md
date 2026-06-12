# Supabase and Backend Integration Plan

Date: 2026-06-09

## Current State

The YC Winter 2026 event-prep app now has a Supabase-backed implementation path
behind `EVENT_PREP_DATA_SOURCE=supabase`. The event approvals workspace has a
separate Supabase-backed implementation path behind
`EVENT_APPROVALS_DATA_SOURCE=supabase`.

Current app storage:

- `data/seed.json` is the local fallback/source fixture.
- `data/events.json`, `data/companies.json`, `data/founders.json`, `data/attendance.json`, `data/founder-needs.json`, `data/notes.json`, and `data/assets.json` are generated import slices.
- `public/founders/winter-2026/**` contains copied founder and company image assets.
- `app/lib/event-prep-data.ts` reads local JSON and adapts it as the fallback
  fixture.
- `app/lib/event-prep-repository.ts` and
  `app/lib/event-prep-supabase-repository.ts` serve paginated event-prep data
  from Supabase when `EVENT_PREP_DATA_SOURCE=supabase`.
- `app/api/event-prep` exposes the event-prep API used by the browser.
- Notes entered through the UI are React state only and disappear on refresh.

Read-only Supabase check from 2026-06-09 before the approvals migration:

- The connected Supabase project has no event-prep tables for founders, companies, events, notes, intros, YC batches, or assets.
- The current Supabase tables look like a gbrain/content schema.
- There were no listed migrations in the connected project.

Approval backend implementation status:

- `202606090001_event_approvals_foundation.sql` creates the durable approvals
  schema and was validated against the development Supabase project on
  2026-06-09.
- `202606090002_luma_sync_operations.sql` adds sync run tracking, writeback job
  locking/idempotency, and the RPC functions used by the backend routes.
- `app/lib/event-approvals-supabase-repository.ts` switches approval list,
  dossier, and bulk-action routes to Supabase when
  `EVENT_APPROVALS_DATA_SOURCE=supabase`.
- `app/api/luma/sync`, `app/api/luma/webhook`, `app/api/luma/writebacks`,
  and `supabase/functions/luma-writebacks` implement scheduled sync, webhook
  ingestion, retry/watchdog processing, and immediate scoped Lu.ma status
  updates.
- See `docs/luma-sync-architecture.md` for diagrams and rollout details.

Event-prep backend implementation status:

- `202606100003_event_prep_foundation.sql` creates the public YC event-prep
  tables for events, companies, founders, event attendance, founder needs,
  notes, and intro suggestions.
- `scripts/seed-event-prep-supabase.ts` imports the current public YC seed into
  those tables and preserves deterministic public-data IDs.
- The `/` event-prep route is dynamic and hydrates from the repository contract;
  client-side filtering and pagination call `/api/event-prep`.

## Goal

Move the prototype from local static JSON to a backend that supports:

- persistent event notes
- multi-user event prep
- paginated/searchable founder directory
- durable intro suggestions and decisions
- source provenance for public YC/enrichment data
- Lu.ma event and application sync
- user-triggered approval, rejection, waitlist, and clarification decisions
- Resend clarification emails and inbound reply analysis
- AI-assisted applicant verification with manual fallback
- optional future sync into a second brain

Do not migrate private office-hours material until auth, access rules, and data retention are explicit.

## Event Approvals Scope

The `/approvals` workspace is a separate ops workflow from the event-prep
dossier. The backend should support a community owner or ops manager reviewing a
large Lu.ma application queue, selecting a filtered set, and executing an action
without leaving the page.

Implementation foundation already in the repo:

- `supabase/migrations/202606090001_event_approvals_foundation.sql` defines the
  durable approvals schema, RLS, ops membership roles, source comparisons, AI
  reviews, user decisions, bulk operations, Lu.ma writeback jobs, Resend email
  jobs, applicant replies, and provider webhook storage.
- `app/lib/event-approvals-repository.ts` defines the backend repository contract
  that a future Supabase implementation should satisfy.
- `app/api/approvals/events`, `app/api/events/[eventId]/approvals`,
  `app/api/events/[eventId]/approvals/bulk`, and
  `app/api/approvals/[applicationId]/dossier` expose the initial API surface.
- `app/lib/luma/client.ts` isolates Lu.ma API calls behind a server-only adapter
  using Lu.ma's current public API base URL and `x-luma-api-key` authentication.

The default repository implementation is still backed by deterministic local
data. Set `EVENT_APPROVALS_DATA_SOURCE=supabase` only after both approval
migrations are applied and the server-only Supabase and Lu.ma secrets are
configured.

Required product flows:

- Load all Lu.ma events for the configured calendar/account.
- For each event, sync applications and preserve the raw Lu.ma payload.
- Match each applicant against YC records by primary email, alternate emails,
  phone, name, company, batch, and known network/investor context.
- Classify applicants into operational queues: `ready`, `needs_info`,
  `awaiting_reply`, `manual`, `waitlist`, `approved`, and `rejected`.
- Expose useful segments for review: YC founders, possible YC founders,
  investors, network/guests, unmapped applicants, and capacity holds.
- Let users select all rows in the current queue/filter and approve, reject, or
  send clarification emails in bulk.
- Queue Lu.ma writebacks only after a user-triggered approval/rejection.
- Keep a durable audit trail for every match, email, AI analysis, manual
  decision, and external API writeback.
- Open a dossier-style applicant card in the approval page, not a navigation
  away from the queue.

## Agent-Native Runtime

YC OS should be AI-first at the operation layer. Agents are first-class
operators that use the same guarded YC OS tools as the UI, while Supabase and
server workers provide the secure runtime for secrets, idempotency, retries, and
provider API calls.

Agent-facing MCP tools should support the full loop:

- `list_approval_events` and `list_approval_queue` find work.
- `get_guest_context` opens the private guest/application context, including
  contact fields, registration answers, matching evidence, email/reply logs, AI
  review state, decisions, and provider writeback status.
- `request_application_info execute=true` records the decision, creates the
  clarification email job, and, when Supabase/Resend are configured, immediately
  claims only that operation's email jobs for scoped delivery.
- `approve_applications` and `reject_applications` record durable decisions and
  queue provider writebacks through the YC OS runtime.
- `add_event_guests` creates durable agent guest-add requests for backend Lu.ma
  execution and exposes request status back to the agent.

The important boundary is not "agent versus backend." The agent owns workflow
execution through MCP. The backend owns secrets, database mutations, provider
side effects, retry state, and audit logs. Agents should never call Lu.ma or
Resend directly and should not paste private contact fields into public logs.

Non-goals for the first backend pass:

- Do not auto-reject applicants.
- Do not auto-approve solely from an AI reply without an explicit rule and an
  auditable confidence threshold.
- Do not store service-role credentials or Lu.ma/Resend API keys in browser
  code.
- Do not merge private office-hours or CRM data until access rules and
  retention are explicit.

## Data Model

Use deterministic text IDs for imported public data so imports are idempotent. Use UUIDs for user-created records.
The migration prefixes the event-prep tables with `yc_` (`yc_events`,
`yc_companies`, `yc_founders`, etc.) because the connected Supabase project also
contains shared gbrain/content tables with generic names.

### Core Tables

`events`

- `id text primary key`
- `title text not null`
- `location text`
- `starts_at timestamptz`
- `attendee_count integer`
- `source_kind text`
- `source_url text`
- `retrieved_at timestamptz`
- `imported_at timestamptz not null default now()`
- `metadata jsonb not null default '{}'::jsonb`

`companies`

- `id text primary key`
- `source_id text`
- `name text not null`
- `slug text`
- `batch text`
- `stage text`
- `category text`
- `industry text`
- `subindustry text`
- `one_liner text`
- `long_description text`
- `website text`
- `yc_url text`
- `location text`
- `city text`
- `country text`
- `team_size integer`
- `year_founded integer`
- `is_hiring boolean`
- `top_company boolean`
- `tags text[] not null default '{}'::text[]`
- `regions text[] not null default '{}'::text[]`
- `primary_group_partner jsonb`
- `social_links jsonb not null default '{}'::jsonb`
- `public_counts jsonb not null default '{}'::jsonb`
- `metadata jsonb not null default '{}'::jsonb`
- `imported_at timestamptz not null default now()`

`founders`

- `id text primary key`
- `source_id text`
- `company_id text not null references companies(id) on delete cascade`
- `name text not null`
- `role text`
- `location text`
- `bio text`
- `is_active boolean`
- `has_public_email_flag boolean`
- `social_links jsonb not null default '{}'::jsonb`
- `metadata jsonb not null default '{}'::jsonb`
- `imported_at timestamptz not null default now()`

`event_attendance`

- `event_id text not null references events(id) on delete cascade`
- `founder_id text not null references founders(id) on delete cascade`
- `company_id text references companies(id) on delete set null`
- `status text not null default 'expected'`
- `source text`
- `metadata jsonb not null default '{}'::jsonb`
- primary key: `(event_id, founder_id)`

`founder_needs`

- `id uuid primary key default gen_random_uuid()`
- `event_id text references events(id) on delete cascade`
- `founder_id text not null references founders(id) on delete cascade`
- `company_id text references companies(id) on delete set null`
- `need_text text not null`
- `need_category text`
- `source text`
- `source_url text`
- `is_current boolean not null default true`
- `created_at timestamptz not null default now()`

`notes`

- `id uuid primary key default gen_random_uuid()`
- `event_id text references events(id) on delete cascade`
- `founder_id text references founders(id) on delete cascade`
- `company_id text references companies(id) on delete set null`
- `note_type text not null`
- `body text not null`
- `source_kind text`
- `source_url text`
- `author_id uuid`
- `author_name text`
- `visibility text not null default 'team'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `metadata jsonb not null default '{}'::jsonb`

`intro_suggestions`

- `id uuid primary key default gen_random_uuid()`
- `event_id text not null references events(id) on delete cascade`
- `from_founder_id text not null references founders(id) on delete cascade`
- `to_founder_id text not null references founders(id) on delete cascade`
- `fit_label text not null`
- `reason text not null`
- `opener text`
- `caution text`
- `evidence jsonb not null default '[]'::jsonb`
- `same_company boolean not null default false`
- `algorithm_version text not null`
- `created_at timestamptz not null default now()`
- unique: `(event_id, from_founder_id, to_founder_id, algorithm_version)`

`intro_decisions`

- `id uuid primary key default gen_random_uuid()`
- `intro_suggestion_id uuid not null references intro_suggestions(id) on delete cascade`
- `status text not null`
- `decided_by uuid`
- `decided_at timestamptz not null default now()`
- `reason text`
- `metadata jsonb not null default '{}'::jsonb`

Use statuses like `queued`, `made`, `skipped`, `avoid`, and `follow_up`.

`assets`

- `id uuid primary key default gen_random_uuid()`
- `owner_type text not null`
- `owner_id text not null`
- `asset_type text not null`
- `public_path text`
- `storage_bucket text`
- `storage_path text`
- `source_url text`
- `source_path text`
- `sha256 text`
- `bytes integer`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

`job_posts`

- `id text primary key`
- `company_id text not null references companies(id) on delete cascade`
- `title text not null`
- `role text`
- `location text`
- `url text`
- `description text`
- `source text`
- `is_active boolean`
- `metadata jsonb not null default '{}'::jsonb`
- `imported_at timestamptz not null default now()`

`source_snapshots`

- `id uuid primary key default gen_random_uuid()`
- `source_kind text not null`
- `source_url text`
- `retrieved_at timestamptz`
- `imported_at timestamptz not null default now()`
- `record_count integer`
- `sha256 text`
- `metadata jsonb not null default '{}'::jsonb`

This table is for provenance, not full raw HTML dumps.

### Event Approval Tables

The approval tables are implemented in
`202606090001_event_approvals_foundation.sql`. Operational sync and writeback
additions are implemented in `202606090002_luma_sync_operations.sql`.

`external_accounts`

- Stores connected provider accounts such as Lu.ma and future Resend/AI sources.
- Browser clients should never receive provider secrets.

`luma_events`

- One row per Lu.ma event.
- Stores Lu.ma event ID, calendar ID, URL, title, start/end time, location,
  capacity, approval mode, raw payload, and sync time.
- Link to canonical `events` later when an event is promoted into the YC OS
  event-prep surface.

`luma_event_applications`

- One row per Lu.ma application/guest request.
- Stores Lu.ma guest ID, applicant name, email, phone, Lu.ma status, submitted
  time, normalized fields, raw payload, current YC OS approval status, primary
  action, selected default, sync time, and last-seen time.
- Unique key prevents duplicate rows across repeated syncs.

`applicant_identity_matches`

- Stores deterministic and AI-assisted match evidence.
- Fields to consider: application ID, matched founder/company/person IDs,
  match kind, relation label, confidence label, evidence JSON, rule version,
  recommendation, created at, and superseded at.
- Evidence should explain why someone is `ready`, `needs_info`, `manual`, or
  `waitlist` without exposing raw private data unnecessarily.

`approval_decisions`

- Stores every user-triggered approval workflow decision with actor, prior
  status, next status, reason, and metadata.
- Current actions include approve, reject, send clarification, and waitlist.

`approval_bulk_operations`

- Groups select-all actions from the UI.
- Stores event, actor, action, filter payload, requested/applied/skipped counts,
  status, created time, completed time, and error summary.
- This is important because a user may approve 120 applicants at once.
- For `send_info`, the RPC accepts optional user-authored email subject/body
  payload and copies it onto each clarification email job.

`luma_writeback_jobs`

- Durable queue for Lu.ma API writes.
- Stores application, bulk operation, decision, target status, idempotency key,
  payload, attempts, locks, status, response payload, last error, retry time,
  and completion time.
- Writebacks are claimed with `FOR UPDATE SKIP LOCKED` and retried safely.

`clarification_email_jobs`

- Durable queue for outbound Resend clarification emails.
- Fields to consider: application ID, decision ID, recipient, sender,
  reply-to, subject, body, template version, resend email ID, status, attempts,
  last error, sent at, and metadata.
- The sender should be a verified subdomain address such as
  `events@events.ycombinator.com` or the configured Matchbook equivalent.
- User-authored custom copy belongs on this job, not only in UI state, so reply
  analysis and manual review can see what the applicant was asked.

`applicant_replies`

- Links normalized inbound email replies to the approval application.
- Fields to consider: application ID, email reply ID, extracted company,
  extracted batch, extracted YC email candidate, extracted role, AI decision
  candidate, confidence label, summary, reason, status, reviewed by, and
  reviewed at.
- The raw email body belongs in the email reply table; this table should store
  approval-specific interpretation.

`provider_webhook_events`

- Raw immutable ledger for Lu.ma and Resend webhooks.
- Stores provider, provider event ID, event type, received time, payload,
  processing status, processing error, and processed time.
- Provider event IDs are used for idempotency when available.

## Indexes

Minimum indexes:

```sql
create index companies_batch_idx on companies(batch);
create index companies_category_idx on companies(category);
create index companies_stage_idx on companies(stage);
create index founders_company_id_idx on founders(company_id);
create index founders_name_idx on founders using gin (to_tsvector('english', coalesce(name, '')));
create index founder_needs_founder_id_idx on founder_needs(founder_id);
create index notes_founder_id_created_at_idx on notes(founder_id, created_at desc);
create index notes_event_id_created_at_idx on notes(event_id, created_at desc);
create index intro_suggestions_event_from_idx on intro_suggestions(event_id, from_founder_id);
create index intro_suggestions_event_to_idx on intro_suggestions(event_id, to_founder_id);
create index assets_owner_idx on assets(owner_type, owner_id);
```

For search, start simple with Postgres `ilike` and `to_tsvector`. Add embeddings later only if natural-language search becomes a core feature.

Approval-specific indexes to plan:

```sql
-- Conceptual only; finalize names and columns during backend design.
-- luma_event_applications(event_id, approval_status)
-- luma_event_applications(event_id, current_segment)
-- luma_event_applications(email)
-- luma_event_applications(phone)
-- applicant_identity_matches(application_id, created_at desc)
-- approval_decisions(application_id, created_at desc)
-- approval_bulk_operations(event_id, created_at desc)
-- luma_writeback_jobs(status, next_retry_at)
-- clarification_email_jobs(status, created_at)
-- applicant_replies(application_id, created_at desc)
```

## RLS Posture

Default to internal-team access, not public anonymous access.

Suggested roles:

- `event_viewer`: can read event prep data.
- `event_editor`: can create notes and intro decisions.
- `event_admin`: can import data and manage events.
- `event_ops`: can review applications and trigger approvals/rejections.

Initial policies:

- Authenticated team members can read events, companies, founders, attendance, current needs, assets, job posts, and intro suggestions.
- Authenticated team members can insert notes.
- Note authors can update their own notes.
- Event ops users can read approval queues and create approval decisions.
- Admin/service role handles imports, Lu.ma sync, Resend webhooks, AI analysis,
  and Lu.ma writebacks.
- No client-side service role key.

For the YC application demo, it is acceptable to run locally from `data/seed.json`. For a real shared tool, implement auth before writing private notes.

## Backend Shape

Prefer server-side data access first. Keep the client component focused on UI state.

Recommended files:

- `app/lib/data/event-prep-repository.ts`
- `app/lib/data/local-event-prep-repository.ts`
- `app/lib/data/supabase-event-prep-repository.ts`
- `app/lib/supabase/server.ts`
- `app/actions/notes.ts`
- `app/api/events/[eventId]/founders/route.ts`
- `app/api/founders/[founderId]/route.ts`
- `app/api/founders/[founderId]/notes/route.ts`
- `app/api/founders/[founderId]/intros/route.ts`
- `app/api/events/[eventId]/approvals/route.ts`
- `app/api/events/[eventId]/approvals/bulk/route.ts`
- `app/api/approvals/[applicationId]/route.ts`
- `app/api/approvals/[applicationId]/dossier/route.ts`
- `app/api/luma/sync/route.ts`
- `app/api/luma/webhook/route.ts`
- `app/api/resend/webhook/route.ts`
- `app/jobs/luma-writeback.ts`
- `app/jobs/clarification-emails.ts`
- `app/jobs/applicant-reply-analysis.ts`

Use a repository interface so the app can switch between local JSON and Supabase:

```ts
type FounderDirectoryQuery = {
  eventId: string;
  page: number;
  pageSize: number;
  lens?: "all" | "intro" | "caution" | "ai";
  query?: string;
};

type EventPrepRepository = {
  getEvent(eventId: string): Promise<EventPrepData["event"]>;
  listFounders(query: FounderDirectoryQuery): Promise<{
    founders: EventPrepFounder[];
    total: number;
  }>;
  getFounder(eventId: string, founderId: string): Promise<EventPrepFounder | null>;
  addNote(input: {
    eventId: string;
    founderId: string;
    body: string;
    noteType: "user" | "room" | "office_hours" | "other_founder";
  }): Promise<EventPrepNote>;
};
```

Approval repository shape to design:

```ts
type ApprovalQueue = "all" | "ready" | "needs_info" | "awaiting_reply" | "manual" | "waitlist" | "approved" | "rejected";
type ApprovalSegment = "all" | "yc_founders" | "possible_yc" | "investors" | "network" | "unmapped" | "capacity";

type EventApprovalsQuery = {
  eventId: string;
  queue: ApprovalQueue;
  segment: ApprovalSegment;
  query?: string;
  page: number;
  pageSize: number;
};

type EventApprovalsRepository = {
  listEvents(): Promise<Array<{ id: string; title: string; seats: number; applicationCount: number }>>;
  listApplications(query: EventApprovalsQuery): Promise<{
    applications: EventApprovalApplication[];
    total: number;
    counts: Record<ApprovalQueue, number>;
    segmentCounts: Record<ApprovalSegment, number>;
  }>;
  getApplicationDossier(applicationId: string): Promise<EventApprovalApplication | null>;
  createBulkOperation(input: {
    eventId: string;
    queue: ApprovalQueue;
    segment: ApprovalSegment;
    query?: string;
    applicationIds: string[];
    action: "approve" | "reject" | "send_info" | "waitlist";
    clarificationEmail?: { subject?: string; body?: string };
  }): Promise<{ operationId: string }>;
};
```

Environment switch:

```text
EVENT_PREP_DATA_SOURCE=local
```

Later:

```text
EVENT_PREP_DATA_SOURCE=supabase
```

Approval data source switch:

```text
EVENT_APPROVALS_DATA_SOURCE=local
```

Later:

```text
EVENT_APPROVALS_DATA_SOURCE=supabase
```

## External Integration Plan

### Lu.ma

Lu.ma is the source of truth for public event listings and application status.
YC OS should be the review and decision layer.

Implemented backend responsibilities:

1. Sync events for the configured calendar/account.
2. Sync applications for each managed event.
3. Preserve raw Lu.ma payloads for audit and reprocessing.
4. Normalize applicant identity fields: name, email, phone, company, answers,
   submitted time, Lu.ma status, and application ID.
5. Preserve existing YC OS decisions while Lu.ma still reports a pending
   application.
6. Queue approve/reject writebacks after user-triggered decisions.
7. Retry failed writebacks with idempotency keys, job locks, and visible error
   states.
8. Verify and store Lu.ma webhooks for low-latency refresh signals.

Implemented files:

- `app/lib/luma/client.ts`: Lu.ma REST adapter with retries and current
  `event_id` writeback payload.
- `app/lib/luma/sync.ts`: paginated event/application sync into Supabase.
- `app/lib/luma/webhooks.ts`: raw-body HMAC verification and webhook ledger
  storage.
- `app/lib/luma/writebacks.ts`: writeback worker with retry/backoff.
- `app/lib/luma/writeback-worker.ts`: immediate worker trigger that invokes the
  Supabase Edge Function for product-facing UI/MCP writebacks. A local Next
  worker override is limited to explicit non-production development.
- `app/api/luma/sync/route.ts`: manual or scheduled sync route.
- `app/api/luma/webhook/route.ts`: Lu.ma webhook endpoint.
- `app/api/luma/writebacks/route.ts`: signed retry/watchdog writeback route.
- `supabase/functions/luma-writebacks/index.ts`: Supabase Edge Function for
  scoped immediate writebacks after approve/reject actions.
- `supabase/functions/agent-guest-requests/index.ts`: Supabase Edge Function
  for scoped or batched agent-created Lu.ma guest-add requests.
- `supabase/functions/clarification-emails/index.ts`: Supabase Edge Function
  for scoped or batched Resend clarification email delivery.

Edge Function operating notes:

- Keep the immediate path scoped by bulk operation id; do not let a single UI
  action drain unrelated queued writebacks.
- Cap interactive batches with `LUMA_IMMEDIATE_WRITEBACK_BATCH_SIZE`. Supabase
  Edge Functions have finite memory, CPU, request idle, and wall-clock limits,
  so long queues should be handled by the signed retry/watchdog route.
- Prefer running the function in the Supabase database region because every
  writeback claims and updates database rows.
- Keep `LUMA_WRITEBACK_WORKER_STRATEGY=supabase` or unset in production so
  failures are visible instead of silently falling back to the Next route.
- Monitor `luma_writeback_jobs`, `agent_guest_requests`, and
  `clarification_email_jobs` by status, scheduled time, locks, attempts, and
  last error.

## Agent-Native Runtime Strategy Review

Engineering review verdict: YC OS should be agent-native. The agent should be
able to operate every product workflow through MCP/API tools, including reads,
dry-runs, event-prep writes, guest-add requests, approval decisions, rejection
reversals, and clarification requests. The backend still matters, but as the
secure runtime behind those tools, not as a separate human-only workflow owner.

The runtime has three external side-effect lanes:

- Lu.ma approval writebacks from approve/reject decisions.
- Lu.ma guest-add requests created by agent tools.
- Resend clarification emails created by send-info decisions.

Use the same durable-job principle for all three lanes: the user or agent MCP
action records intent in Supabase first, and server-side runtime code owns
provider calls, retries, idempotency, and status updates. Browser clients and
external agents must not call Lu.ma, Resend, Supabase service-role, shell, or
dashboard APIs directly.

Current recommendation:

- Keep all product-facing provider effects behind Supabase runtime functions.
  `luma-writebacks` handles approval/rejection writebacks,
  `agent-guest-requests` handles agent-created guest adds, and
  `clarification-emails` handles Resend clarification delivery.
- Keep the signed Next routes as watchdog/manual retry drains. They can process
  old failed jobs, but they should not be the normal immediate execution path
  after the Supabase functions are deployed.
- Keep the three functions separate. They share the durable-job principle, but
  they have different payloads, safeguards, provider APIs, idempotency keys, and
  failure language.
- Add operational dashboards or SQL snippets for pending/running/failed counts
  across `luma_writeback_jobs`, `agent_guest_requests`, and
  `clarification_email_jobs`.
- Consider a dedicated queue/workflow service only if these jobs become
  high-volume, need long-running orchestration, or need richer retry policies
  than Supabase functions plus durable job tables can comfortably provide.

Do not use database triggers to call providers directly. Database triggers can
record or signal work, but provider side effects should stay in observable
workers that claim durable jobs and write explicit success/failure state.

Remaining Lu.ma work:

- Wire webhook inserts to a focused event-only sync worker.
- Add a scheduled production cron once preview validation is complete.
- Decide whether YC OS should ever create Lu.ma events; current design only
  reads events and writes application status.

### Resend

Resend handles clarification emails and inbound replies.

Backend responsibilities:

1. Send clarification emails only after a user action.
2. Store outbound email jobs and Resend email IDs.
3. Receive Resend webhooks at `POST /api/resend/webhook`.
4. Verify Svix signatures before storing events.
5. Fetch full inbound reply bodies through Resend Receiving.
6. Link replies to applications by Resend email ID, reply headers, plus fallback
   matching on sender email and event/application context.
7. Queue AI analysis and expose the result as an approval recommendation.

Design questions:

- What is the final sender: `events@events.ycombinator.com`,
  `yc@events.matchbookhq.com`, or another subdomain address?
- Should reply-to point to a root mailbox, Resend receiving, or both?
- Do clarification emails use one template per event type or one global
  template?
- What reply should count as enough proof for auto-ready vs manual review?

### Supabase

Supabase is the durable app database, not the source of truth for Lu.ma.

Backend responsibilities:

1. Store normalized events, founders, companies, notes, approvals, emails, and
   audit trails.
2. Keep raw external payloads in append-only webhook/snapshot tables where
   needed.
3. Enforce RLS for browser access.
4. Use service role only in server routes, jobs, importers, and webhooks.
5. Support server-side pagination, filtering, and search for approval queues.
6. Store enough audit history to explain every approval decision later.

Implemented for approvals:

- Supabase REST service-role client in `app/lib/supabase/service-client.ts`.
- Approval repository switch in `app/lib/event-approvals-repository.ts`.
- Supabase implementation in
  `app/lib/event-approvals-supabase-repository.ts`.
- Bulk approval RPC in `queue_luma_approval_action`.
- Writeback claim RPC in `claim_luma_writeback_jobs`.

Remaining Supabase questions:

- Should approvals live in the same Supabase project as event prep, or in a
  separate project until auth/data boundaries are settled?
- Should event ops users be modeled with Supabase Auth, Vercel auth, or another
  YC identity provider?
- Which tables can browser clients read directly, and which must only be served
  through server routes?

### AI Analysis

AI should assist human review, not silently make irreversible decisions.

Backend responsibilities:

1. Analyze inbound replies for company, batch, YC email, relationship type, and
   confidence.
2. Produce structured output with a recommended action and reason.
3. Mark uncertain cases for manual review.
4. Never hide the evidence behind the recommendation.
5. Version prompts/rules so old decisions remain explainable.

Design questions:

- What confidence/rule combination is enough to mark a reply `ready`?
- Which actions can AI suggest but not execute?
- How do we audit prompt version, model, input summary, and output?

## Import Pipeline

Keep `scripts/import-yc-data.mjs` as the local deterministic importer.

Add a second importer:

```text
scripts/import-yc-to-supabase.mjs
```

Responsibilities:

1. Read `data/seed.json`.
2. Validate required arrays and IDs.
3. Upsert in this order:
   - `events`
   - `companies`
   - `founders`
   - `event_attendance`
   - `founder_needs`
   - `notes`
   - `assets`
   - `job_posts`
   - `intro_suggestions`
4. Use service role from server-only env.
5. Never run from browser code.
6. Be idempotent. Re-running the import should not duplicate public seed records.

Do not import private Airtable, WhatsApp, CRM, or office-hours data until the permission model is explicit.

Add a Lu.ma sync job after the provider contract is confirmed:

```text
scripts/sync-luma-events.mjs
```

Responsibilities:

1. Read Lu.ma account/calendar configuration from server-only env.
2. Fetch events and applications.
3. Upsert Lu.ma event/application records.
4. Recompute applicant identity matches.
5. Leave existing user decisions intact.
6. Record sync summary and errors for ops visibility.

## Migration Sequence

1. Finalize the backend design for event prep and event approvals together.
2. Confirm Lu.ma API capabilities, webhook support, auth model, and rate limits.
3. Confirm Resend sender/reply topology and webhook payload shape.
4. Create `supabase/migrations/001_event_prep_schema.sql`.
5. Create `supabase/migrations/002_event_approvals_schema.sql` only after the
   approval table design is reviewed.
6. Create local repository tests against `data/seed.json`.
7. Create Supabase repositories with the same interfaces.
8. Add `EVENT_PREP_DATA_SOURCE` and `EVENT_APPROVALS_DATA_SOURCE`.
9. Add import/sync scripts with dry-run modes.
10. Import into Supabase dev project.
11. Compare event-prep counts:
   - 1 event
   - 198 companies
   - 415 founders
   - 415 attendance records
   - 415 founder needs
   - 1,245 seed notes
12. Compare approval seed counts:
   - 3 synced events
   - 730 event applications
   - 600 applications for YC Founder Mixer
   - 120 ready approvals
   - 214 needs-info applications
   - 140 manual review applications
13. Move note creation and approval decisions to server actions/API routes.
14. Replace all-data page serialization with server-backed pagination.
15. Add auth and RLS policies before private notes or production approvals.

## Backend Acceptance Criteria

The integration is ready when:

- The app can run with `EVENT_PREP_DATA_SOURCE=local`.
- The app can run with `EVENT_PREP_DATA_SOURCE=supabase`.
- The first page of founders returns 25 records.
- Search and lenses are executed server-side.
- Selected founder details include photo, company, ask, intro, caution, and notes.
- Add-note persists after refresh.
- Approval queues return server-side counts by queue and segment.
- Bulk approve/reject/send-info creates an auditable operation and individual
  decision rows.
- Lu.ma writebacks are queued and retryable.
- Clarification email sends are queued and linked to applications.
- Resend replies are ingested, analyzed, and linked back to applications.
- Re-running the import does not duplicate records.
- No service role key is exposed to the browser.
- Supabase RLS is enabled and policies are intentional.

## Open Questions

- Which auth provider should represent event/community team members?
- Should founder images stay public, or move to Supabase Storage with signed URLs?
- Should generated intro suggestions be recomputed on every import or stored as event-specific snapshots?
- Should private notes be event-scoped only, or visible across future events?
- What is the retention policy for private notes and sensitive "avoid" context?
- What exact Lu.ma API endpoints and scopes are available for approval
  writeback?
- Should YC OS sync all Lu.ma events, or only events tagged/selected for YC OS?
- Should event capacity be enforced in YC OS, Lu.ma, or only as an ops warning?
- Which applicant identity fields are allowed to be used for matching?
- What should be auto-ready after a clarification reply, and what must always
  require manual review?
- How long should raw email replies, webhook payloads, and AI analysis inputs be
  retained?
