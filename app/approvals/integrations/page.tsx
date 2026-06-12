import type { Metadata } from "next";
import { AI_AGENT_COMPACT_DOCS } from "@/app/lib/how-built-docs";
import { CopyPlainTextButton } from "@/components/CopyPlainTextButton";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Agent Handoff and Approval Ops Docs | YC OS Events",
  description: "Private YC OS documentation for agent handoff, human event approval operations, guarded actions, Supabase syncs, Resend replies, and PostHog safety."
};

const syncTriggers = [
  {
    label: "Scheduled",
    title: "Full sync",
    body: "A cron or manual server action calls POST /api/luma/sync with LUMA_SYNC_SECRET, then paginates Lu.ma events and guests sequentially."
  },
  {
    label: "Webhook",
    title: "Fast refresh signal",
    body: "POST /api/luma/webhook verifies Lu.ma's signature on the raw body, stores the provider event idempotently, and marks the event as needing a focused sync."
  },
  {
    label: "Action",
    title: "Approval RPC",
    body: "The approvals UI calls the bulk endpoint, which runs queue_luma_approval_action to record decisions and create writeback or email jobs."
  },
  {
    label: "Worker",
    title: "External writes",
    body: "The Supabase luma-writebacks Edge Function claims scoped jobs with SKIP LOCKED, calls Lu.ma by guest API id or email, and schedules retry on 429 or 5xx failures."
  }
];

const asyncPath = [
  {
    label: "Needs info",
    title: "Clarification email drafted",
    body: "The operator can turn internal notes into an editable AI draft, then queue a Resend email from the events sending domain."
  },
  {
    label: "Applicant reply",
    title: "Inbound response stored",
    body: "Replies land through Resend Receiving/Webhooks, get linked to the Lu.ma application, and are stored before any AI review."
  },
  {
    label: "AI review",
    title: "Structured recommendation",
    body: "AI extracts company, role, YC relationship, investor/network signal, and confidence. It can mark an application ready or keep it manual."
  },
  {
    label: "Human gate",
    title: "Approve, reject, or hold",
    body: "AI never writes to Lu.ma directly. A user approves selected ready rows or reviews unresolved cases manually."
  }
];

const analyticsPath = [
  {
    label: "User action",
    title: "Prep, approvals, or Aleix page",
    body: "The UI records explicit workflow events such as founder selection, queue changes, dossier opens, note adds, and outbound link clicks."
  },
  {
    label: "Typed wrapper",
    title: "Privacy-safe event schema",
    body: "Client code calls lib/analytics.ts, which only accepts known event names and strips private-looking property keys before capture."
  },
  {
    label: "PostHog SDK",
    title: "Browser analytics",
    body: "instrumentation-client.ts initializes posthog-js with interaction autocapture off, history pageviews on, and identified profiles disabled until login exists."
  },
  {
    label: "Recording mask",
    title: "Workflow replay without content",
    body: "Inputs are masked and sensitive UI regions use ph-no-capture so recordings show navigation and layout, not founder notes or applicant identity."
  },
  {
    label: "Dashboards",
    title: "Funnels and recordings",
    body: "PostHog can answer which event-prep and approval flows are used, where users stall, and which recordings need product review."
  }
];

const integrationTabs = [
  {
    href: "#ai-agent-docs",
    eyebrow: "AI docs",
    label: "Copy compact plaintext",
    meta: "Scoped endpoints, live writes, safety boundary",
    cta: "Open AI docs"
  },
  {
    href: "#human-docs",
    eyebrow: "Human docs",
    label: "Read the system diagram",
    meta: "Lu.ma, Supabase, UI, email, AI, analytics",
    cta: "Open diagram"
  }
];

const technicalDiagrams = [
  {
    title: "System map",
    file: "/technical-diagrams/01-system-map.png",
    alt: "YC OS system map showing Lu.ma, Resend, app routes, Supabase tables, and job queues.",
    recommendation: "Use this first in the docs. It explains what the app is without implementation detail."
  },
  {
    title: "Approval flow with enrichment",
    file: "/technical-diagrams/02-approval-flow-enrichment.png",
    alt: "Approval flow from guest application through normalization, enrichment, evidence, review, audit, and writeback.",
    recommendation: "Use this to replace the old one-picture approval flow."
  },
  {
    title: "Sources to evidence rules",
    file: "/technical-diagrams/03-sources-evidence-rules.png",
    alt: "Data sources and YC enrichment sources flowing into evidence rules, then prep, approvals, and agent context.",
    recommendation: "Use this for the data-source section. It makes enrichment and evidence rules explicit."
  },
  {
    title: "Agent boundary",
    file: "/technical-diagrams/04-agent-boundary.png",
    alt: "Scoped AI agent boundary showing bearer token, allowlisted tools, filtered rows, guarded jobs, and blocked private data.",
    recommendation: "Use this in the AI agent docs. It explains trust boundaries."
  },
  {
    title: "Lu.ma signup, import, and agent endpoint",
    file: "/technical-diagrams/05-luma-import-agent-endpoint.png",
    alt: "Lu.ma signup and import entry paths plus scoped AI-native agent endpoint, suggest mode, policy mode, draft jobs, and auto jobs.",
    recommendation: "Use this as the final diagram. It clarifies signups, imports, and scoped agent decisions."
  }
];

const agentDocs = [
  {
    title: "Start from the locked site URL",
    body: "An external AI starts with the YC OS site URL, but the app is private. If the page is locked, the agent asks the operator to unlock YC OS or paste the agent handoff."
  },
  {
    title: "Use the agent handoff",
    body: "The AI Agent button creates the handoff on dialog open. It includes the MCP config, tools endpoint, capabilities endpoint, and bearer header."
  },
  {
    title: "Read through scoped tools",
    body: "Claude Cowork, Codex, OpenClaw, Cursor, Paperclip, or another MCP-capable agent can read event prep and approval data without raw provider payloads. Standard queue and summary reads omit direct contact fields; get_guest_context exposes private guest context only through the scoped agent handoff."
  },
  {
    title: "Write through MCP tools",
    body: "Agents call YC OS MCP write tools such as create_event, add_event_attendees, enrich_event_context, add_event_guests, approve_applications, reject_applications, and request_application_info. These tools are the agent-native operating surface; secure server code executes YC OS records, provider effects, retries, and audit."
  }
];

const agentHandoffSteps = [
  {
    label: "1. Unlock",
    title: "Operator opens YC OS",
    body: "The operator unlocks the private site with /unlock. The 14-day httpOnly cookie proves the browser is authorized."
  },
  {
    label: "2. Handoff",
    title: "AI Agent loads session",
    body: "Opening AI Agent calls POST /api/agent/sessions and returns the scoped config for the current host."
  },
  {
    label: "3. Inspect",
    title: "Agent calls read tools",
    body: "The agent calls capabilities first, then reads events, queues, dossiers, and event prep context through sanitized tools."
  },
  {
    label: "4. Live action",
    title: "Agent writes through YC OS",
    body: "YC OS production write tools are live when a reason is supplied. Agents omit execute or set execute=true."
  },
  {
    label: "5. Execute",
    title: "Confirmed YC OS action",
    body: "After explicit operator instruction, or when the current handoff grants the exact write, the agent supplies a short reason. YC OS records the request and its runtime owns provider execution/retries."
  },
  {
    label: "6. Sync back",
    title: "Provider state returns",
    body: "The next Lu.ma sync or webhook brings provider status back into Supabase so approvals and prep stay current."
  }
];

const agentToolContracts = [
  {
    name: "get_agent_guide",
    scope: "read:guide",
    use: "Read the YC OS agent overview, first task, smoke test, and safety guidance."
  },
  {
    name: "get_event_prep_context",
    scope: "read:event_prep",
    use: "Read the selected event, founders, lenses, pagination, search, and related founders."
  },
  {
    name: "list_event_prep_events",
    scope: "read:event_prep",
    use: "List event-prep events, aligned with approval events when possible."
  },
  {
    name: "search_founders",
    scope: "read:event_prep",
    use: "Search founder/event-prep records by founder, company, category, ask, or need."
  },
  {
    name: "list_approval_events",
    scope: "read:approvals",
    use: "List synced Lu.ma approval events with counts, source URL, seats, timestamps, and location."
  },
  {
    name: "list_approval_queue",
    scope: "read:approvals",
    use: "Read a sanitized approval queue page. Page size is capped at 25."
  },
  {
    name: "get_approval_summary",
    scope: "read:approvals",
    use: "Read a sanitized dossier summary, source comparisons, clarification preview, and AI recommendation."
  },
  {
    name: "get_guest_context",
    scope: "read:approvals",
    use: "Read authenticated guest/application context with contact fields, source evidence, reply logs, and provider writeback status."
  },
  {
    name: "create_event",
    scope: "write:events",
    use: "Create YC OS event records through the MCP operating surface."
  },
  {
    name: "add_event_attendees",
    scope: "write:events",
    use: "Attach YC founder/company records to an event in YC OS event-prep tables."
  },
  {
    name: "enrich_event_context",
    scope: "write:events",
    use: "Add YC OS notes and founder needs to enrich event context."
  },
  {
    name: "add_event_guests",
    scope: "write:event_guests",
    use: "Execute YC OS guest-add requests through the secure runtime."
  },
  {
    name: "approve_applications",
    scope: "write:approvals",
    use: "Queue YC OS approval decisions for selected applications or filtered queues."
  },
  {
    name: "reject_applications",
    scope: "write:approvals",
    use: "Queue YC OS rejection decisions for selected applications or filtered queues."
  },
  {
    name: "request_application_info",
    scope: "write:approvals",
    use: "Queue YC OS clarification requests for applications that need more information."
  }
];

const agentSafetyRules = [
  {
    title: "Access boundary",
    rules: [
      "The site URL is not public documentation; use it only after the operator grants access.",
      "The bearer token is the same site access token, not a server credential.",
      "The handoff does not grant shell, database console, GitHub write, deployment, Supabase service-role, or provider dashboard access."
    ]
  },
  {
    title: "Read boundary",
    rules: [
      "Call /api/agent/capabilities before assuming a tool or action exists.",
      "Use /api/mcp or /api/agent/tools/call for app reads and writes.",
      "Do not ask the operator for raw provider payloads, private customer data, .env files, tokens, or service-role keys."
    ]
  },
  {
    title: "Write boundary",
    rules: [
      "YC OS writes are live by default and require a reason.",
      "Production writes omit execute or set execute=true.",
      "Keep sendEmail=false unless the operator specifically asks YC OS to notify guests.",
      "Guest adds also require a real event whose guestAdds field is available; demo events are read-only."
    ]
  },
  {
    title: "Reporting boundary",
    rules: [
      "Return concrete findings with page URLs, event ids, queue filters, and tool names.",
      "Summarize live results without exposing provider payloads.",
      "Never paste access tokens, names, emails, phones, reasons, or raw provider payloads into logs or public PR text."
    ]
  }
];

const agentActionFields = [
  {
    name: "eventId",
    body: "Internal YC OS event id from list_approval_events. Pick an event with kind=real and guestAdds=available for execution."
  },
  {
    name: "applicationIds / query",
    body: "Approval tools accept selected application ids or a queue query to mirror select-page/select-all UI flows."
  },
  {
    name: "guests",
    body: "Guest tool accepts 1-10 guests with email, optional name, and optional phoneNumber. Responses avoid returning raw email/name/phone data."
  },
  {
    name: "approvalStatus",
    body: "Guest tool accepts approved, pending_approval, or waitlist. Defaults to approved."
  },
  {
    name: "sendEmail",
    body: "Defaults to false for agent safety. Set true only when YC OS should ask the provider to email added guests."
  },
  {
    name: "execute",
    body: "Defaults to true for write tools. Production rejects execute=false."
  },
  {
    name: "reason",
    body: "Required when execute is true. It is used for the action request but is not sent to PostHog."
  }
];

const agentApprovalActionExample = `MCP tools/call approve_applications
{
  "eventId": "yc-founder-mixer",
  "query": {
    "queue": "ready",
    "segment": "yc_founders",
    "search": ""
  },
  "execute": true,
  "reason": "YC partner asked the agent to approve verified founders"
}`;

const agentActionExample = `MCP tools/call add_event_guests
{
  "eventId": "dogpatch-founder-breakfast",
  "guests": [
    {
      "email": "founder@example.com",
      "name": "Example Founder"
    }
  ],
  "approvalStatus": "approved",
  "sendEmail": false,
  "execute": true,
  "reason": "YC partner asked the agent to add this founder"
}`;

const agentExecutionExample = `{
  "eventId": "dogpatch-founder-breakfast",
  "guests": [
    { "email": "founder@example.com", "name": "Example Founder" }
  ],
  "approvalStatus": "approved",
  "sendEmail": false,
  "execute": true,
  "reason": "YC partner confirmed this founder should be added"
}`;

const processAutomations = [
  {
    title: "Private unlock",
    body: "YC_OS_ACCESS_TOKEN unlocks the app and agent handoff. /unlock sets the cookie; bearer auth can also authorize scoped agent endpoints."
  },
  {
    title: "Signed machine routes",
    body: "Provider and cron endpoints bypass the site lock only for signed work: Lu.ma sync/webhooks/writeback triggers, agent guest-request triggers, and Resend routes still validate route-level secrets or signatures."
  },
  {
    title: "Supabase data source",
    body: "Set EVENT_PREP_DATA_SOURCE=supabase and EVENT_APPROVALS_DATA_SOURCE=supabase after the seed/migration work is in place. Local JSON remains a development fallback."
  },
  {
    title: "Lu.ma sync",
    body: "Scheduled syncs use LUMA_API_KEY server-side. Webhooks store provider events idempotently and mark focused events for refresh."
  },
  {
    title: "Writeback worker",
    body: "Agent and UI actions create YC OS operations. Supabase Edge Functions claim scoped jobs with locking, update providers, record external responses, and retry transient failures."
  },
  {
    title: "Clarification replies",
    body: "Needs-info emails use AI-drafted editable copy and Resend delivery. Replies and webhook events are stored before AI parsing sends evidence back to human review."
  },
  {
    title: "Analytics safety",
    body: "PostHog receives categorical product events only: queue names, counts, modes, status codes, and action names. Private applicant text stays masked."
  }
];

const edgeFunctions = [
  {
    title: "luma-writebacks",
    body: "Claims luma_writeback_jobs through claim_luma_writeback_jobs, updates Lu.ma guest status, records provider responses, and retries transient 429/5xx failures."
  },
  {
    title: "agent-guest-requests",
    body: "Claims agent_guest_requests through claim_agent_guest_requests, calls Lu.ma add-guests, stores sent_to_luma or retry state, and keeps agent-created guest adds out of browser code."
  },
  {
    title: "clarification-emails",
    body: "Claims clarification_email_jobs, sends Resend clarification emails with idempotency, writes resend_email_id, and supports operation-scoped immediate sends."
  }
];

type HumanDiagramNode = {
  label: string;
  title: string;
  body: string;
  tone?: "source" | "sync" | "data" | "ui" | "action" | "email" | "ai" | "analytics";
};

type HumanDiagramBranch = {
  label: string;
  title: string;
  nodes: HumanDiagramNode[];
};

const humanSystemSpine: HumanDiagramNode[] = [
  {
    label: "Source",
    title: "Lu.ma",
    body: "Events, applications, guest status, answers, webhooks.",
    tone: "source"
  },
  {
    label: "Refresh",
    title: "Sync + webhook",
    body: "Cron imports all. Webhook flags focused refresh.",
    tone: "sync"
  },
  {
    label: "Store",
    title: "Supabase",
    body: "Rows, evidence, decisions, jobs, replies, audit.",
    tone: "data"
  },
  {
    label: "Review",
    title: "Approvals UI",
    body: "Queues, dossier, email draft, final action.",
    tone: "ui"
  }
];

const humanEnrichmentSources: HumanDiagramNode[] = [
  {
    label: "Lu.ma",
    title: "Applications",
    body: "Answers, contact fields, guest status, event metadata.",
    tone: "source"
  },
  {
    label: "YC graph",
    title: "Founder + company records",
    body: "Batch, role, verified contacts, company, network context.",
    tone: "data"
  },
  {
    label: "Replies",
    title: "Email + prep notes",
    body: "Clarifications, needs, notes, intro context.",
    tone: "email"
  },
  {
    label: "Add source",
    title: "Adapter slot",
    body: "Map new source fields into the same evidence contract.",
    tone: "sync"
  }
];

const humanSystemBranches: HumanDiagramBranch[] = [
  {
    label: "Approve / reject",
    title: "Final decision writeback",
    nodes: [
      {
        label: "Action",
        title: "Bulk API",
        body: "Selected rows + actor + filter context.",
        tone: "action"
      },
      {
        label: "Record",
        title: "Decision rows",
        body: "Operation items + Lu.ma writeback jobs.",
        tone: "data"
      },
      {
        label: "Worker",
        title: "Lu.ma update",
        body: "Claim job, update provider, sync returns state.",
        tone: "source"
      }
    ]
  },
  {
    label: "Needs info",
    title: "Incoming email path",
    nodes: [
      {
        label: "Draft",
        title: "Custom clarification email",
        body: "Editable subject/body for selected applicants.",
        tone: "email"
      },
      {
        label: "Resend",
        title: "Send + reply",
        body: "Outbound and inbound events return by webhook.",
        tone: "email"
      },
      {
        label: "AI review",
        title: "Evidence back",
        body: "Extract company, batch, role, confidence.",
        tone: "ai"
      }
    ]
  },
  {
    label: "Authorized AI helper",
    title: "MCP app-tool path",
    nodes: [
      {
        label: "Handoff",
        title: "Same-token handoff",
        body: "An authorized user copies the agent handoff: scoped YC OS MCP reads and writes on the same backend.",
        tone: "ai"
      },
      {
        label: "MCP write tool",
        title: "Live guarded request",
        body: "The agent executes small YC OS actions with a reason. The YC OS runtime owns provider sync.",
        tone: "action"
      },
      {
        label: "Return",
        title: "State syncs back",
        body: "Provider changes return through sync/webhook.",
        tone: "sync"
      }
    ]
  },
  {
    label: "Safety",
    title: "Analytics boundary",
    nodes: [
      {
        label: "Capture",
        title: "PostHog metadata",
        body: "Queue, action, count, mode, status only.",
        tone: "analytics"
      },
      {
        label: "Mask",
        title: "Content is masked",
        body: "No names, emails, notes, evidence, tokens.",
        tone: "analytics"
      },
      {
        label: "Learn",
        title: "Funnel review",
        body: "Find stalls without applicant content.",
        tone: "analytics"
      }
    ]
  }
];

const tableGroups = [
  {
    title: "Lu.ma sync",
    tables: [
      "luma_events",
      "luma_event_applications",
      "provider_webhook_events"
    ]
  },
  {
    title: "Review evidence",
    tables: [
      "applicant_identity_matches",
      "applicant_source_comparisons",
      "applicant_ai_reviews"
    ]
  },
  {
    title: "Decisions",
    tables: [
      "approval_decisions",
      "approval_bulk_operations",
      "approval_bulk_operation_items"
    ]
  },
  {
    title: "External actions",
    tables: [
      "agent_guest_requests",
      "luma_writeback_jobs",
      "luma_sync_runs",
      "clarification_email_jobs",
      "applicant_replies"
    ]
  }
];

const analyticsGroups = [
  {
    title: "Event prep",
    tone: "neutral",
    body: "Views, lens changes, search submissions, pagination, founder selection, intro context expansion, and note creation."
  },
  {
    title: "Approvals",
    tone: "neutral",
    body: "Event changes, queue/segment changes, searches, row selection, bulk actions, single decisions, and dossier open/close."
  },
  {
    title: "Aleix page",
    tone: "neutral",
    body: "Page view, social links, resume anchor, side projects, references, and demo link clicks."
  },
  {
    title: "Never captured",
    tone: "warn",
    body: "Names, emails, phones, note bodies, asks, intro openers, evidence text, Lu.ma raw payloads, and registration answers."
  }
];

const queueStates = [
  {
    title: "Ready",
    tone: "ok",
    body: "High-confidence YC founder, investor, network, or guest evidence. Eligible for select-all approval."
  },
  {
    title: "Needs info",
    tone: "warn",
    body: "Promising but unmapped identity. Eligible for user-triggered clarification email."
  },
  {
    title: "Awaiting reply",
    tone: "neutral",
    body: "Email sent and waiting for inbound response or webhook/reply analysis."
  },
  {
    title: "Manual",
    tone: "warn",
    body: "Conflicting identity, weak source match, capacity edge case, or low-confidence AI output."
  },
  {
    title: "Waitlist",
    tone: "neutral",
    body: "Verified applicant blocked by event capacity or owner policy."
  },
  {
    title: "Approved / rejected",
    tone: "final",
    body: "Final state after a human decision and scoped Lu.ma writeback."
  }
];

const secrets = [
  {
    name: "YC_OS_ACCESS_TOKEN",
    location: "Server-only environment variable",
    owner: "Unlock page, site lock, and scoped agent bearer handoff"
  },
  {
    name: "YC_OS_UNLOCK_COOKIE_NAME",
    location: "Optional server-only environment variable",
    owner: "Overrides the default unlock cookie name"
  },
  {
    name: "SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL",
    location: "Server-only environment variable",
    owner: "Supabase service client and provider-effect workers"
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    location: "Server-only environment variable",
    owner: "Repository and job code that writes protected rows"
  },
  {
    name: "LUMA_API_KEY",
    location: ".env.local locally, Vercel Environment Variables in Preview/Production",
    owner: "Server routes and workers only"
  },
  {
    name: "LUMA_CALENDAR_ID / LUMA_ACCOUNT_ID",
    location: "Server-only environment variables",
    owner: "Lu.ma sync account and calendar selection"
  },
  {
    name: "LUMA_API_BASE_URL",
    location: "Optional server-only environment variable",
    owner: "Overrides the default https://public-api.luma.com base URL"
  },
  {
    name: "LUMA_SYNC_SECRET",
    location: "Server-only route secret; CRON_SECRET or WEBHOOK_SECRET can be used as fallbacks",
    owner: "Signed sync/watchdog routes and Supabase provider-effect functions"
  },
  {
    name: "LUMA_WEBHOOK_SECRET",
    location: "Secret generated by the Lu.ma webhook configuration",
    owner: "POST /api/luma/webhook signature verification"
  },
  {
    name: "RESEND_API_KEY",
    location: "Server-only environment variable",
    owner: "Supabase clarification email worker, signed watchdog route, and reply ingestion"
  },
  {
    name: "RESEND_FROM_EMAIL",
    location: "Server-only environment variable",
    owner: "Verified sender address for clarification emails"
  },
  {
    name: "RESEND_FROM_NAME",
    location: "Optional server-only environment variable",
    owner: "Display name for clarification emails"
  },
  {
    name: "RESEND_SENDING_DOMAIN",
    location: "Server-only environment variable",
    owner: "Verified Resend domain required by the sender address"
  },
  {
    name: "RESEND_REPLY_TO_EMAIL",
    location: "Optional server-only environment variable",
    owner: "Reply-to address for clarification emails"
  },
  {
    name: "RESEND_WEBHOOK_SECRET",
    location: "Secret generated by the Resend webhook configuration",
    owner: "POST /api/resend/webhook signature verification"
  },
  {
    name: "LUMA_WRITEBACK_WORKER_URL / LUMA_WRITEBACK_WORKER_STRATEGY",
    location: "Optional server-only environment variables",
    owner: "Override or force the Supabase luma-writebacks Edge Function path"
  },
  {
    name: "AGENT_GUEST_REQUEST_WORKER_URL / AGENT_GUEST_REQUEST_WORKER_STRATEGY",
    location: "Optional server-only environment variables",
    owner: "Override or force the Supabase agent-guest-requests Edge Function path"
  },
  {
    name: "CLARIFICATION_EMAIL_WORKER_URL / CLARIFICATION_EMAIL_WORKER_STRATEGY",
    location: "Optional server-only environment variables",
    owner: "Override or force the Supabase clarification-emails Edge Function path"
  },
  {
    name: "EVENT_APPROVALS_DATA_SOURCE",
    location: "Use local for seed data, supabase after migrations and secrets are configured",
    owner: "Approval repository switch"
  },
  {
    name: "EVENT_PREP_DATA_SOURCE",
    location: "Use local for seed data, supabase after migrations and secrets are configured",
    owner: "Event-prep repository switch"
  },
  {
    name: "OPENAI_API_KEY",
    location: "Server-only environment variable",
    owner: "Reply parser, recommendation worker, and clarification email draft generator"
  },
  {
    name: "OPENAI_EMAIL_DRAFT_MODEL",
    location: "Optional server-only environment variable",
    owner: "Overrides the model used for notes-to-email clarification drafts"
  },
  {
    name: "OPENAI_MODEL / OPENAI_ORG_ID / OPENAI_PROJECT_ID",
    location: "Optional server-only environment variables",
    owner: "Fallback model and optional OpenAI organization/project headers"
  }
];

const publicConfig = [
  {
    name: "NEXT_PUBLIC_POSTHOG_ENABLED",
    location: "Browser-safe environment variable",
    owner: "Turns analytics capture on only when explicitly set to true"
  },
  {
    name: "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
    location: "Browser-safe environment variable",
    owner: "PostHog project token used by posthog-js"
  },
  {
    name: "NEXT_PUBLIC_POSTHOG_HOST",
    location: "Browser-safe environment variable",
    owner: "PostHog ingestion path, usually /matchbook-relay"
  },
  {
    name: "NEXT_PUBLIC_POSTHOG_UI_HOST",
    location: "Browser-safe environment variable",
    owner: "PostHog UI origin for links and recordings, usually https://us.posthog.com"
  },
  {
    name: "NEXT_PUBLIC_POSTHOG_RECORDINGS_ENABLED",
    location: "Browser-safe environment variable",
    owner: "Enables session replay for preview review; turn off if masking leaks content"
  }
];

export default function IntegrationsPage() {
  return (
    <main className="app-shell integration-map">
      <SiteHeader active="technical" />

      <section className="integration-content">
        <header className="integration-intro">
          <div className="integration-copy">
            <div className="label">How YC OS is built</div>
            <h1>AI agent and human documentation for YC OS event approvals</h1>
            <p>
              Choose the reader first. AI docs are compact plaintext for agent
              context. Human docs start with one technical system map that shows
              how data-source enrichment, Lu.ma, Supabase, the UI, email, AI
              review, writebacks, and analytics connect.
            </p>
          </div>

          <div className="integration-status" aria-label="Integration status">
            <div>
              <span>Schema</span>
              <strong>Foundation + sync migrations</strong>
            </div>
            <div>
              <span>Secrets</span>
              <strong>Server-only</strong>
            </div>
            <div>
              <span>Automation</span>
              <strong>Human gated</strong>
            </div>
            <div>
              <span>Analytics</span>
              <strong>Explicit events</strong>
            </div>
          </div>
        </header>

        <nav className="integration-tabs" aria-label="Integration documentation">
          {integrationTabs.map((tab) => (
            <a className="integration-tab-button" href={tab.href} key={tab.href}>
              <span className="integration-tab-kicker">{tab.eyebrow}</span>
              <strong>{tab.label}</strong>
              <em>{tab.meta}</em>
              <b>{tab.cta}<span aria-hidden="true"> -&gt;</span></b>
            </a>
          ))}
        </nav>

        <section className="integration-section ai-doc-copy-section" id="ai-agent-docs" aria-labelledby="ai-agent-docs-title">
          <div className="integration-section-head">
            <div>
              <div className="label">AI agent documentation</div>
              <h2 id="ai-agent-docs-title">Compact plaintext for AI context</h2>
            </div>
            <p>
              Paste this into Claude, Codex, OpenClaw, Cursor, Paperclip, or any
              MCP-capable agent. It avoids narrative docs and keeps the action
              contract token-light.
            </p>
          </div>

          <div className="ai-doc-copy-card">
            <div className="ai-doc-copy-meta">
              <span>Pure text</span>
              <strong>Scoped reads, guarded writes, no secrets</strong>
              <p>No screenshots, markdown tables, or long explanations. The agent gets only endpoints, tools, boundaries, and reporting rules.</p>
            </div>
            <CopyPlainTextButton label="Copy AI docs" text={AI_AGENT_COMPACT_DOCS} />
            <pre className="ai-doc-text-block ph-no-capture"><code>{AI_AGENT_COMPACT_DOCS}</code></pre>
          </div>
        </section>

        <section className="integration-section agent-doc-section" aria-labelledby="ai-agent-reference-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Detailed agent reference</div>
              <h2 id="ai-agent-reference-title">How an AI agent can use YC OS after authorized handoff</h2>
            </div>
            <p>
              This is the longer reference for humans maintaining the agent
              contract and checking how scoped reads and guarded actions work.
            </p>
          </div>

          <div className="agent-doc-grid">
            {agentDocs.map((doc) => (
              <article className="agent-doc-card" key={doc.title}>
                <h3>{doc.title}</h3>
                <p>{doc.body}</p>
              </article>
            ))}
          </div>

          <div className="agent-doc-subsection">
            <div className="integration-section-head slim">
              <div>
                <div className="label">Agent runbook</div>
                <h3>Decision tree for Codex, Claude Cowork, and external agents</h3>
              </div>
              <p>Use this as the pasted operating contract before reading or changing anything.</p>
            </div>
            <PathFlow items={agentHandoffSteps} />
          </div>

          <div className="agent-doc-subsection">
            <div className="integration-section-head slim">
              <div>
                <div className="label">Tool contract</div>
                <h3>What the agent can call</h3>
              </div>
              <p>Capabilities are bearer-authenticated and no-store. Tools return app data shaped for agents, not raw provider dumps.</p>
            </div>
            <div className="agent-tool-table-wrap">
              <table className="agent-tool-table">
                <thead>
                  <tr>
                    <th>Tool or action</th>
                    <th>Scope</th>
                    <th>Use</th>
                  </tr>
                </thead>
                <tbody>
                  {agentToolContracts.map((tool) => (
                    <tr key={tool.name}>
                      <td data-label="Tool or action"><code>{tool.name}</code></td>
                      <td data-label="Scope"><code>{tool.scope}</code></td>
                      <td data-label="Use">{tool.use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="agent-doc-subsection">
            <div className="integration-section-head slim">
              <div>
                <div className="label">Agent rules</div>
                <h3>Rules the agent must follow</h3>
              </div>
              <p>These rules are written for agents to read directly before using the handoff.</p>
            </div>
            <div className="agent-rule-grid">
              {agentSafetyRules.map((group) => (
                <article className="agent-rule-card" key={group.title}>
                  <h4>{group.title}</h4>
                  <ul>
                    {group.rules.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>

          <div className="agent-endpoint-card">
            <div>
              <div className="label">MCP write tools</div>
              <h3>Guarded YC OS writes</h3>
              <p>
                Agents call MCP tools on the same domain as the site. Approval actions use the same bulk operation as the UI. Guest actions prepare YC OS guest-add requests; the correct write path records the request inside YC OS before secure runtime code touches a provider. Production write tools are live by default with a reason.
              </p>
            </div>
            <pre className="integration-code-block"><code>{agentApprovalActionExample}</code></pre>
            <pre className="integration-code-block"><code>{agentActionExample}</code></pre>
          </div>

          <div className="agent-contract-grid">
            {agentActionFields.map((field) => (
              <article className="agent-contract-item" key={field.name}>
                <code>{field.name}</code>
                <p>{field.body}</p>
              </article>
            ))}
          </div>

          <div className="agent-endpoint-card compact">
            <div>
              <div className="label">Execution payload</div>
              <h3>After the live request is scoped</h3>
              <p>
                Include a reason for each confirmed YC OS-owned request. YC OS records safe PostHog metadata such as mode, status code, approval status, event id, send-email flag, and guest-count bucket. It does not capture tokens, emails, names, phones, reasons, or raw provider payloads.
              </p>
            </div>
            <pre className="integration-code-block"><code>{agentExecutionExample}</code></pre>
          </div>
        </section>

        <section className="integration-section" aria-labelledby="automation-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Process automation</div>
              <h2 id="automation-title">Current backend and automation rules</h2>
            </div>
            <p>This is the operational tree that changed with the Supabase, Lu.ma, unlock, and agent handoff work.</p>
          </div>

          <div className="automation-grid">
            {processAutomations.map((automation) => (
              <article className="automation-card" key={automation.title}>
                <h3>{automation.title}</h3>
                <p>{automation.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="integration-section" aria-labelledby="edge-functions-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Supabase Edge Functions</div>
              <h2 id="edge-functions-title">Provider effects run outside the browser</h2>
            </div>
            <p>
              UI and MCP tools record durable YC OS jobs first. These Edge
              Functions claim the jobs, call Lu.ma or Resend with server
              secrets, and write success or retry state back to Supabase.
            </p>
          </div>

          <div className="automation-grid">
            {edgeFunctions.map((edgeFunction) => (
              <article className="automation-card" key={edgeFunction.title}>
                <h3>{edgeFunction.title}</h3>
                <p>{edgeFunction.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="integration-section" id="human-docs" aria-labelledby="runtime-path-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Human documentation</div>
              <h2 id="runtime-path-title">Technical diagrams to add to the docs</h2>
            </div>
            <p>Use these five in the human docs. They replace the old dense card diagram with simpler, pixel-aligned diagrams.</p>
          </div>

          <TechnicalDiagramGallery />
        </section>

        <section className="integration-section" aria-labelledby="sync-triggers-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Sync architecture</div>
              <h2 id="sync-triggers-title">How Lu.ma and Supabase stay current</h2>
            </div>
            <p>Use scheduled sync as the source of completeness and Lu.ma webhooks as a low-latency signal for changed events.</p>
          </div>

          <PathFlow compact items={syncTriggers} />
        </section>

        <section className="integration-section" aria-labelledby="clarification-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Async branch</div>
              <h2 id="clarification-title">Ask-for-more-info path</h2>
            </div>
            <p>Useful when the applicant used a personal email, alternate phone, or unmapped network identity.</p>
          </div>

          <PathFlow compact items={asyncPath} />
        </section>

        <section className="integration-section" aria-labelledby="analytics-title">
          <div className="integration-section-head">
            <div>
              <div className="label">PostHog</div>
              <h2 id="analytics-title">Analytics and recording path</h2>
            </div>
            <p>PostHog tracks product behavior. The app sends event metadata, not private founder/applicant text.</p>
          </div>

          <PathFlow items={analyticsPath} />
        </section>

        <section className="integration-section" aria-labelledby="analytics-taxonomy-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Telemetry</div>
              <h2 id="analytics-taxonomy-title">Event taxonomy and privacy boundary</h2>
            </div>
            <p>Use counts, buckets, queue names, stages, categories, booleans, and action names.</p>
          </div>

          <div className="queue-map">
            {analyticsGroups.map((group) => (
              <article className={`queue-state ${group.tone}`} key={group.title}>
                <h3>{group.title}</h3>
                <p>{group.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="integration-section split" aria-labelledby="data-model-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Supabase</div>
              <h2 id="data-model-title">Tables created by the approvals migration</h2>
            </div>
            <p>The migration enables RLS, ops membership, evidence storage, audit trails, and retryable external jobs.</p>
          </div>

          <div className="schema-grid">
            {tableGroups.map((group) => (
              <article className="schema-group" key={group.title}>
                <h3>{group.title}</h3>
                <ul>
                  {group.tables.map((table) => (
                    <li key={table}><code>{table}</code></li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="integration-section" aria-labelledby="queues-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Operations</div>
              <h2 id="queues-title">Review queues and actions</h2>
            </div>
            <p>The UI should let an owner act on a row, page, or filtered segment without leaving the approvals view.</p>
          </div>

          <div className="queue-map">
            {queueStates.map((state) => (
              <article className={`queue-state ${state.tone}`} key={state.title}>
                <h3>{state.title}</h3>
                <p>{state.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="integration-section" aria-labelledby="secrets-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Configuration</div>
              <h2 id="secrets-title">Server configuration</h2>
            </div>
            <p>Add provider keys only to server environments. Never prefix them with <code>NEXT_PUBLIC_</code>.</p>
          </div>

          <div className="env-table-wrap">
            <table className="env-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Where to add it</th>
                  <th>Reads it</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((secret) => (
                  <tr key={secret.name}>
                    <td data-label="Key"><code>{secret.name}</code></td>
                    <td data-label="Where to add it">{secret.location}</td>
                    <td data-label="Reads it">{secret.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="integration-section" aria-labelledby="public-config-title">
          <div className="integration-section-head">
            <div>
              <div className="label">Browser config</div>
              <h2 id="public-config-title">PostHog public environment variables</h2>
            </div>
            <p>These values are intentionally browser-visible. Use the NEXT_PUBLIC names for preview deployments.</p>
          </div>

          <div className="env-table-wrap">
            <table className="env-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Where to add it</th>
                  <th>Reads it</th>
                </tr>
              </thead>
              <tbody>
                {publicConfig.map((item) => (
                  <tr key={item.name}>
                    <td data-label="Key"><code>{item.name}</code></td>
                    <td data-label="Where to add it">{item.location}</td>
                    <td data-label="Reads it">{item.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function TechnicalDiagramGallery() {
  return (
    <div className="technical-diagram-gallery" aria-label="Recommended technical diagrams for YC OS documentation">
      {technicalDiagrams.map((diagram, index) => (
        <article className="technical-diagram-card" key={diagram.file}>
          <div className="technical-diagram-card-head">
            <div>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{diagram.title}</h3>
            </div>
            <p>{diagram.recommendation}</p>
          </div>
          <img src={diagram.file} alt={diagram.alt} loading={index === 0 ? "eager" : "lazy"} />
        </article>
      ))}
    </div>
  );
}

function HumanSystemDiagram() {
  return (
    <div className="human-system-map" aria-label="Interconnected human approval workflow and source enrichment diagram">
      <div className="human-system-map-head">
        <div>
          <div className="label">Interconnected diagram</div>
          <h3>Sources -&gt; enrichment -&gt; prep / AI / decide -&gt; writeback</h3>
        </div>
        <p>
          Enriched evidence powers event prep, AI recommendations, and the human
          decision dossier. New sources plug in through the same adapter contract.
        </p>
      </div>

      <section className="human-system-enrichment" aria-label="Data source enrichment path">
        <div className="human-system-branch-head">
          <span>Enrichment</span>
          <h4>Data sources feed prep, AI, and decisions</h4>
        </div>
        <div className="human-system-source-grid">
          {humanEnrichmentSources.map((node) => (
            <DiagramNode key={`enrichment-${node.title}`} node={node} />
          ))}
        </div>
        <div className="human-system-enrichment-bar">
          <span>Normalize</span>
          <strong>source comparisons + identity matches + AI evidence</strong>
          <p>One evidence contract feeds event prep, AI review, and the final human gate.</p>
        </div>
      </section>

      <div className="human-system-lane" aria-label="Core system spine">
        {humanSystemSpine.map((node, index) => [
          <DiagramNode key={`${node.title}-node`} node={node} />,
          index < humanSystemSpine.length - 1 ? (
            <DiagramArrow key={`${node.title}-arrow`} label={index === 0 ? "imports" : index === 1 ? "stores" : "renders"} />
          ) : null
        ])}
      </div>

      <div className="human-system-branches">
        {humanSystemBranches.map((branch) => (
          <section className="human-system-branch" key={branch.title}>
            <div className="human-system-branch-head">
              <span>{branch.label}</span>
              <h4>{branch.title}</h4>
            </div>
            <div className="human-system-branch-row">
              {branch.nodes.map((node, index) => [
                <DiagramNode key={`${branch.title}-${node.title}-node`} node={node} />,
                index < branch.nodes.length - 1 ? (
                  <DiagramArrow key={`${branch.title}-${node.title}-arrow`} label={index === 0 ? "then" : "back"} />
                ) : null
              ])}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function DiagramNode({ node }: { node: HumanDiagramNode }) {
  return (
    <article className={`human-system-node ${node.tone ?? "data"}`}>
      <span>{node.label}</span>
      <h4>{node.title}</h4>
      <p>{node.body}</p>
    </article>
  );
}

function DiagramArrow({ label }: { label: string }) {
  return (
    <div className="human-system-arrow" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

function PathFlow({
  compact = false,
  items
}: {
  compact?: boolean;
  items: Array<{ label: string; title: string; body: string }>;
}) {
  return (
    <div className={`path-flow${compact ? " compact" : ""}`}>
      {items.map((item, index) => (
        <div className="path-flow-part" key={item.title}>
          <article className="path-node">
            <span>{item.label}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
          {index < items.length - 1 ? <div className="path-connector" aria-hidden="true">then</div> : null}
        </div>
      ))}
    </div>
  );
}
