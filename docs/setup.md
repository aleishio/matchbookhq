# Setup

## 1. Vercel

Create a Vercel project from the GitHub repo.

Use Vercel Environment Variables for real values. Do not commit real env files.

Suggested environments:

- Development
- Preview
- Production

No custom domain is needed at first. Use the Vercel project URL.

## 2. Supabase

Create separate Supabase projects:

- App dev project.
- gbrain dev project.
- Production app project later, when needed.

For browser code, only expose:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Keep server-only:

```text
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
DATABASE_URL
GBRAIN_SUPABASE_POOLER_URL
```

Enable RLS before writing user-facing app data.

Backend design docs:

- `docs/supabase-backend-integration.md` covers event prep, event approvals,
  Lu.ma sync, Resend reply ingestion, and the future Supabase schema design.
- `docs/luma-sync-architecture.md` covers the implemented Lu.ma sync routes,
  webhook path, Supabase RPCs, writeback worker, and rollout order.
- `docs/email-replies-schema.md` covers the Resend webhook/reply tables and
  approval-specific reply analysis.

## 3. Lu.ma

Lu.ma should be treated as the source of truth for event applications and final
application status. YC OS should store a synced copy, match applicants against
YC data, and queue writebacks after user-triggered decisions.

Server-only values:

```text
LUMA_API_KEY
LUMA_API_BASE_URL=https://public-api.luma.com
LUMA_CALENDAR_ID # optional; sync infers Lu.ma calendar ids per event
LUMA_WEBHOOK_SECRET
LUMA_SYNC_SECRET
LUMA_SYNC_EVENT_PAGE_LIMIT=50
LUMA_SYNC_GUEST_PAGE_LIMIT=100
LUMA_SYNC_REQUEST_SPACING_MS=250
LUMA_WRITEBACK_BATCH_SIZE=20
LUMA_WRITEBACK_WORKER_STRATEGY=supabase
```

Current API assumptions:

- Lu.ma production API base URL is `https://public-api.luma.com`.
- Authenticate server-side requests with the `x-luma-api-key` header.
- List calendar events with `GET /v1/calendar/list-events`.
- List event guests/applications with `GET /v1/event/get-guests`.
- Write approval/rejection outcomes with `POST /v1/event/update-guest-status`.
- Send `event_id` in the update guest status body.
- Use Lu.ma status `declined` for YC OS rejected applications.
- Run scheduled/manual sync through `POST /api/luma/sync`.
- Receive Lu.ma webhooks at `POST /api/luma/webhook` and verify the raw-body
  signature with `LUMA_WEBHOOK_SECRET`.
- Process approval/rejection writebacks through the Supabase
  `luma-writebacks` Edge Function and the retryable `luma_writeback_jobs`
  table. Keep `POST /api/luma/writebacks` as the signed retry/watchdog route.
- Keep immediate writeback batches small. Edge Functions have finite memory,
  CPU, request idle, and wall-clock limits, so they should process only the
  scoped approve/reject operation and leave old or failed jobs for watchdog
  retries.

## 4. Voyage

Create a dev Voyage key with spending limits.

Use:

```text
VOYAGE_API_KEY
VOYAGE_EMBEDDING_MODEL=voyage-code-3
```

Voyage keys are server-only.

## 5. Resend

Add and verify a dedicated Resend sending subdomain, for example:

```text
events.matchbookhq.com
```

Server-only values:

```text
RESEND_API_KEY
RESEND_SENDING_DOMAIN
RESEND_FROM_EMAIL
RESEND_FROM_NAME
RESEND_REPLY_TO_EMAIL
RESEND_WEBHOOK_SECRET
```

`RESEND_API_KEY`, `RESEND_SENDING_DOMAIN`, and `RESEND_FROM_EMAIL` are
required. `RESEND_FROM_EMAIL` must be on `RESEND_SENDING_DOMAIN`. For Matchbook,
send from `yc@events.matchbookhq.com` and use `yc@matchbookhq.com` as the
default reply-to mailbox. See `docs/email.md` for the DNS and Vercel setup
checklist.

For event approvals, Resend is used for user-triggered clarification emails and
inbound reply analysis. Do not use Resend Automations as the primary approval
state machine. Use Resend Receiving plus Webhooks and store all replies in
Supabase before AI analysis.

## 6. PostHog

PostHog is used for product analytics and optional session recordings.

Browser-safe values:

```text
NEXT_PUBLIC_POSTHOG_ENABLED=true
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=
NEXT_PUBLIC_POSTHOG_HOST=/matchbook-relay
NEXT_PUBLIC_POSTHOG_UI_HOST=https://us.posthog.com
NEXT_PUBLIC_POSTHOG_RECORDINGS_ENABLED=true
```

For Preview deployments, set these `NEXT_PUBLIC_` variables in Vercel. The
browser cannot read server-only names such as `POSTHOG_API_KEY`. The app
initializes PostHog from `instrumentation-client.ts` with explicit analytics
events and interaction autocapture disabled. Browser requests go through the
first-party `/matchbook-relay` path, which `next.config.mjs` rewrites to
PostHog's US ingestion and asset hosts. This avoids `net::ERR_BLOCKED_BY_CLIENT`
from common browser blockers that block direct requests to `us.i.posthog.com`.
If you use a PostHog managed proxy instead, set `NEXT_PUBLIC_POSTHOG_HOST` to
that proxy origin and keep `NEXT_PUBLIC_POSTHOG_UI_HOST` pointed at PostHog's UI.
The local placeholder token `ph_test` is treated as disabled so dev browsers do
not make noisy failed PostHog network requests.

Do not send founder names, applicant names, emails, phones, note bodies, asks,
intro openers, evidence text, Lu.ma raw payloads, or registration answers as
analytics properties. Use the typed helper in `lib/analytics.ts`; it strips
private-looking property names before calling PostHog.

Session recordings should show workflow shape, not private founder/applicant
content. UI regions with notes, asks, dossiers, evidence, email previews, reply
parser output, and directory row text use `ph-no-capture`. Disable
`NEXT_PUBLIC_POSTHOG_RECORDINGS_ENABLED` if a recording review shows private
content leaking.

## 7. AI Providers

Use an LLM provider only from server-side workers/routes.

Server-only values to plan:

```text
OPENAI_API_KEY
OPENAI_ORG_ID
OPENAI_PROJECT_ID
OPENROUTER_API_KEY
```

Approval reply analysis should return structured JSON and should not perform
irreversible Lu.ma writebacks directly.

## 8. gbrain

Use the Supabase Session Pooler URL, not the direct DB URL.

Fill this outside the repo:

```text
$YC_OS_SECRETS_DIR/.env.development
```

gbrain is initialized on this VPS with Supabase storage and Voyage embeddings.
To re-check it:

```text
gbrain doctor
```

## 9. Paperclip

Paperclip is installed and onboarded locally.

Target local Paperclip posture:

```text
Project root: local checkout
Shared memory: gbrain
Data rule: public data only
```

The Codex Engineer local API exports are stored outside the repo at:

```text
$YC_OS_SECRETS_DIR/paperclip-codex-engineer.env
```

Do not commit this file or print its values. Paperclip should not receive production Vercel, Supabase, Voyage, OpenAI, or OpenRouter secrets.

## 10. Supabase MCP

Supabase MCP is configured for Codex with the project ref stored outside this
repo:

```text
<supabase-project-ref>
```

Verify from Codex:

```bash
codex mcp list
codex mcp get supabase
```

New Codex sessions should expose Supabase MCP tools after restart.
