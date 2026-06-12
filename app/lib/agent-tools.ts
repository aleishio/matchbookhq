import {
  boundedInteger,
  createBulkApprovalOperation,
  EventApprovalsRepositoryError,
  getApprovalDossier,
  getApprovalGuestContext,
  listApprovalEvents,
  listEventApprovals,
  normalizeAiDecision,
  normalizeApprovalQueue,
  normalizeApprovalSegment,
  type EventApprovalsListResponse,
  type ApprovalDossierResponse
} from "./event-approvals-repository";
import {
  boundedEventPrepInteger,
  EventPrepRepositoryError,
  listEventPrepEvents,
  listEventPrepFounders,
  normalizeEventPrepLens,
  type EventPrepListResponse
} from "./event-prep-repository";
import type { EventPrepFounder } from "./event-prep-data";
import type { LoadedLumaEvent } from "./event-approvals-types";
import {
  ClarificationEmailWorkerConfigurationError,
  processImmediateClarificationEmailsForOperationFromEnv
} from "./resend/clarification-email-worker";
import { AgentActionError, createLumaGuestsForAgent } from "./agent-actions";
import {
  addEventAttendeesForAgent,
  createEventForAgent,
  enrichEventContextForAgent
} from "./agent-event-actions";
import { agentDryRunsDisabledMessage, areAgentDryRunsAllowed } from "./agent-runtime-policy";
import { runImmediateApprovalWritebackSync } from "./approval-writeback-sync";
import { AGENT_GUIDE } from "@/lib/agent-guide";
import { SupabaseRestError } from "./supabase/service-client";

export type AgentToolName =
  | "get_agent_guide"
  | "get_event_prep_context"
  | "list_event_prep_events"
  | "search_founders"
  | "list_approval_events"
  | "list_approval_queue"
  | "get_approval_summary"
  | "get_guest_context"
  | "create_event"
  | "add_event_attendees"
  | "enrich_event_context"
  | "add_event_guests"
  | "approve_applications"
  | "reject_applications"
  | "request_application_info";

export type AgentToolDefinition = {
  description: string;
  inputSchema: {
    additionalProperties: boolean;
    properties: Record<string, unknown>;
    required?: string[];
    type: "object";
  };
  name: AgentToolName;
};

export class AgentToolError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const MAX_AGENT_PAGE_SIZE = 25;

export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "get_agent_guide",
    description: "Read the YC OS agent overview, recommended first task, safe operator-email smoke test, and safeguards.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "get_event_prep_context",
    description: "Read the unlocked event-prep context and a page of founders.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        eventId: { type: "string" },
        lens: { enum: ["all", "intro", "caution", "ai"], type: "string" },
        page: { minimum: 1, type: "integer" },
        pageSize: { maximum: MAX_AGENT_PAGE_SIZE, minimum: 1, type: "integer" },
        search: { type: "string" }
      }
    }
  },
  {
    name: "list_event_prep_events",
    description: "List unlocked event-prep events available to YC OS, aligned with approval events when possible.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "search_founders",
    description: "Search unlocked founder/event-prep records by founder, company, category, ask, or need.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        eventId: { type: "string" },
        query: { type: "string" },
        pageSize: { maximum: MAX_AGENT_PAGE_SIZE, minimum: 1, type: "integer" }
      }
    }
  },
  {
    name: "list_approval_events",
    description: "List unlocked approval events with kind and guest-add availability.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "list_approval_queue",
    description: "Read a sanitized page of an approval queue. Does not include emails, phones, raw provider payloads, or writeback secrets.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        aiDecision: { enum: ["all", "approve", "send_info", "manual", "waitlist", "reject"], type: "string" },
        eventId: { type: "string" },
        page: { minimum: 1, type: "integer" },
        pageSize: { maximum: MAX_AGENT_PAGE_SIZE, minimum: 1, type: "integer" },
        queue: { enum: ["all", "ready", "needs_info", "awaiting_reply", "manual", "waitlist", "approved", "rejected"], type: "string" },
        search: { type: "string" },
        segment: { enum: ["all", "yc_founders", "possible_yc", "investors", "network", "unmapped", "capacity"], type: "string" }
      },
      required: ["eventId"]
    }
  },
  {
    name: "get_approval_summary",
    description: "Read a sanitized approval dossier summary by application id. Raw provider payloads and direct contact fields are omitted.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        applicationId: { type: "string" }
      },
      required: ["applicationId"]
    }
  },
  {
    name: "get_guest_context",
    description: "Read an authenticated agent-native guest/application context with contact fields, source evidence, email/reply logs, and provider writeback status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        applicationId: { type: "string" }
      },
      required: ["applicationId"]
    }
  },
  {
    name: "create_event",
    description: "Create a YC OS event record. Live by default with a reason; production rejects execute=false.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        actorName: { type: "string" },
        capacity: { maximum: 100000, minimum: 0, type: "integer" },
        description: { type: "string" },
        endsAt: { type: "string" },
        execute: { type: "boolean" },
        location: { type: "string" },
        reason: { type: "string" },
        startsAt: { type: "string" },
        timezone: { type: "string" },
        title: { type: "string" },
        url: { type: "string" }
      },
      required: ["title"]
    }
  },
  {
    name: "add_event_attendees",
    description: "Attach YC founder/company records to a YC OS event. Live by default with a reason; production rejects execute=false.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        actorName: { type: "string" },
        attendees: {
          items: {
            additionalProperties: false,
            properties: {
              companyId: { type: "string" },
              founderId: { type: "string" },
              status: { enum: ["expected", "registered", "checked_in", "waitlist", "cancelled"], type: "string" }
            },
            required: ["founderId"],
            type: "object"
          },
          maxItems: 50,
          minItems: 1,
          type: "array"
        },
        eventId: { type: "string" },
        execute: { type: "boolean" },
        reason: { type: "string" }
      },
      required: ["eventId", "attendees"]
    }
  },
  {
    name: "enrich_event_context",
    description: "Add YC OS notes and founder needs to an event from YC source context. Live by default with a reason; production rejects execute=false.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        actorName: { type: "string" },
        eventId: { type: "string" },
        execute: { type: "boolean" },
        needs: {
          items: {
            additionalProperties: false,
            properties: {
              companyId: { type: "string" },
              founderId: { type: "string" },
              needCategory: { type: "string" },
              needText: { type: "string" }
            },
            required: ["founderId", "needText"],
            type: "object"
          },
          maxItems: 20,
          type: "array"
        },
        notes: {
          items: {
            additionalProperties: false,
            properties: {
              body: { type: "string" },
              companyId: { type: "string" },
              founderId: { type: "string" },
              noteType: { enum: ["office_hours", "other_founder", "room", "user"], type: "string" }
            },
            required: ["body"],
            type: "object"
          },
          maxItems: 20,
          type: "array"
        },
        reason: { type: "string" }
      },
      required: ["eventId"]
    }
  },
  {
    name: "add_event_guests",
    description: "Create a YC OS event guest request. Live by default with a reason; production rejects execute=false.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        actorName: { type: "string" },
        approvalStatus: { enum: ["approved", "pending_approval", "waitlist"], type: "string" },
        eventId: { type: "string" },
        execute: { type: "boolean" },
        guests: {
          items: {
            additionalProperties: false,
            properties: {
              email: { type: "string" },
              name: { type: "string" },
              phoneNumber: { type: "string" }
            },
            required: ["email"],
            type: "object"
          },
          maxItems: 10,
          minItems: 1,
          type: "array"
        },
        reason: { type: "string" },
        sendEmail: { type: "boolean" }
      },
      required: ["eventId", "guests"]
    }
  },
  {
    name: "approve_applications",
    description: "Approve event applications through YC OS. Live by default with a reason; production rejects execute=false.",
    inputSchema: approvalActionInputSchema()
  },
  {
    name: "reject_applications",
    description: "Reject event applications through YC OS. Live by default with a reason; production rejects execute=false.",
    inputSchema: approvalActionInputSchema()
  },
  {
    name: "request_application_info",
    description: "Queue YC OS clarification requests for applications that need more information. Live by default with a reason; production rejects execute=false.",
    inputSchema: {
      ...approvalActionInputSchema(),
      properties: {
        ...approvalActionInputSchema().properties,
        clarificationEmail: {
          additionalProperties: false,
          properties: {
            body: { type: "string" },
            subject: { type: "string" }
          },
          type: "object"
        }
      }
    }
  }
];

export async function callAgentTool(name: string, input: unknown = {}) {
  const args = isRecord(input) ? input : {};

  try {
    if (name === "get_agent_guide") return AGENT_GUIDE;
    if (name === "get_event_prep_context") return await getEventPrepContext(args);
    if (name === "list_event_prep_events") return await getEventPrepEvents();
    if (name === "search_founders") return await searchFounders(args);
    if (name === "list_approval_events") return await getApprovalEvents();
    if (name === "list_approval_queue") return await getApprovalQueue(args);
    if (name === "get_approval_summary") return await getApprovalSummary(args);
    if (name === "get_guest_context") return await getGuestContext(args);
    if (name === "create_event") return await createEvent(args);
    if (name === "add_event_attendees") return await addEventAttendees(args);
    if (name === "enrich_event_context") return await enrichEventContext(args);
    if (name === "add_event_guests") return await addEventGuests(args);
    if (name === "approve_applications") return await createApprovalDecision(args, "approve");
    if (name === "reject_applications") return await createApprovalDecision(args, "reject");
    if (name === "request_application_info") return await createApprovalDecision(args, "send_info");
  } catch (error) {
    if (error instanceof AgentActionError) {
      throw new AgentToolError(error.code, error.message, error.statusCode);
    }

    if (error instanceof EventPrepRepositoryError || error instanceof EventApprovalsRepositoryError) {
      throw new AgentToolError(error.code, error.message, error.statusCode);
    }

    if (error instanceof SupabaseRestError) {
      throw new AgentToolError(
        "agent_backend_store_error",
        "YC OS could not write to the configured backend store.",
        503
      );
    }

    throw error;
  }

  throw new AgentToolError("unknown_agent_tool", `Unknown agent tool: ${name}.`, 404);
}

async function getEventPrepEvents() {
  const events = await listEventPrepEvents();

  return {
    events
  };
}

export function agentToolErrorResponse(error: unknown) {
  if (error instanceof AgentToolError) {
    return {
      body: { error: error.code, message: error.message },
      status: error.statusCode
    };
  }

  return {
    body: { error: "agent_tool_error", message: "Unable to run agent tool." },
    status: 500
  };
}

function approvalActionInputSchema(): AgentToolDefinition["inputSchema"] {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      actorName: { type: "string" },
      applicationIds: {
        items: { type: "string" },
        type: "array"
      },
      eventId: { type: "string" },
      execute: { type: "boolean" },
      query: {
        additionalProperties: false,
        properties: {
          aiDecision: { enum: ["all", "approve", "send_info", "manual", "waitlist", "reject"], type: "string" },
          page: { minimum: 1, type: "integer" },
          pageSize: { maximum: MAX_AGENT_PAGE_SIZE, minimum: 1, type: "integer" },
          queue: { enum: ["all", "ready", "needs_info", "awaiting_reply", "manual", "waitlist", "approved", "rejected"], type: "string" },
          search: { type: "string" },
          segment: { enum: ["all", "yc_founders", "possible_yc", "investors", "network", "unmapped", "capacity"], type: "string" }
        },
        type: "object"
      },
      reason: { type: "string" }
    },
    required: ["eventId"]
  };
}

async function getEventPrepContext(args: Record<string, unknown>) {
  const response = await listEventPrepFounders({
    eventId: readString(args.eventId),
    lens: normalizeEventPrepLens(readString(args.lens), "all"),
    search: readString(args.search) ?? "",
    page: boundedEventPrepInteger(readStringOrNumber(args.page), 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: boundedEventPrepInteger(readStringOrNumber(args.pageSize), 10, 1, MAX_AGENT_PAGE_SIZE)
  });

  return sanitizeEventPrepResponse(response);
}

async function searchFounders(args: Record<string, unknown>) {
  const query = readString(args.query) ?? "";
  const response = await listEventPrepFounders({
    eventId: readString(args.eventId),
    lens: "all",
    search: query,
    page: 1,
    pageSize: boundedEventPrepInteger(readStringOrNumber(args.pageSize), 10, 1, MAX_AGENT_PAGE_SIZE)
  });

  return sanitizeEventPrepResponse(response);
}

async function getApprovalEvents() {
  const events = await listApprovalEvents();

  return {
    events: events.map((event) => ({
      ...agentEventReadiness(event),
      applicationCount: event.applicationCount,
      id: event.id,
      location: event.location,
      seats: event.seats,
      source: event.source,
      startsAt: event.startsAt,
      syncedAt: event.syncedAt,
      title: event.title,
      url: event.url
    }))
  };
}

function agentEventReadiness(event: LoadedLumaEvent) {
  const hasLiveGuestDestination = looksLikeLumaEventId(event.lumaApiId) || looksLikeLumaEventId(event.id);

  if (hasLiveGuestDestination) {
    return {
      guestAdds: "available" as const,
      kind: "real" as const,
      reason: "Real event connected through YC OS. Execution can still be blocked by provider limits."
    };
  }

  return {
    guestAdds: "dry_run_only" as const,
    kind: "demo" as const,
    reason: "No live Lu.ma destination is connected for this YC OS event. Use it for reads and previews only."
  };
}

async function getApprovalQueue(args: Record<string, unknown>) {
  const eventId = requiredString(args.eventId, "eventId");
  const response = await listEventApprovals({
    aiDecision: normalizeAiDecision(readString(args.aiDecision), "all"),
    eventId,
    page: boundedInteger(readStringOrNumber(args.page), 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: boundedInteger(readStringOrNumber(args.pageSize), 10, 1, MAX_AGENT_PAGE_SIZE),
    queue: normalizeApprovalQueue(readString(args.queue), "all"),
    search: readString(args.search) ?? "",
    segment: normalizeApprovalSegment(readString(args.segment), "all")
  });

  return sanitizeApprovalListResponse(response);
}

async function getApprovalSummary(args: Record<string, unknown>) {
  const applicationId = requiredString(args.applicationId, "applicationId");
  const response = await getApprovalDossier(applicationId);

  return sanitizeApprovalDossier(response);
}

async function getGuestContext(args: Record<string, unknown>) {
  const applicationId = requiredString(args.applicationId, "applicationId");
  const response = await getApprovalGuestContext(applicationId);

  return {
    ...sanitizeApprovalDossier(response),
    contact: response.contact,
    guest: response.guest,
    runtime: response.runtime
  };
}

async function addEventGuests(args: Record<string, unknown>) {
  return createLumaGuestsForAgent(args);
}

async function createEvent(args: Record<string, unknown>) {
  return createEventForAgent(args);
}

async function addEventAttendees(args: Record<string, unknown>) {
  return addEventAttendeesForAgent(args);
}

async function enrichEventContext(args: Record<string, unknown>) {
  return enrichEventContextForAgent(args);
}

async function createApprovalDecision(
  args: Record<string, unknown>,
  action: "approve" | "reject" | "send_info"
) {
  const execute = readBoolean(args.execute, true);
  if (!execute && !areAgentDryRunsAllowed()) {
    throw new AgentToolError("agent_dry_runs_disabled", agentDryRunsDisabledMessage(), 400);
  }
  const reason = readString(args.reason);
  if (execute && !reason) {
    throw new AgentToolError(
      "agent_action_reason_required",
      "Executing a YC OS approval action requires a short reason.",
      400
    );
  }

  const result = await createBulkApprovalOperation({
    action,
    actorName: readString(args.actorName),
    applicationIds: readStringArray(args.applicationIds),
    clarificationEmail: action === "send_info" ? readClarificationEmail(args.clarificationEmail) : undefined,
    dryRun: !execute,
    eventId: requiredString(args.eventId, "eventId"),
    query: readApprovalQuery(args.query),
    reason
  });
  if (execute && (action === "approve" || action === "reject") && result.jobs.some((job) => job.type === "luma_writeback")) {
    result.writebackSync = await runImmediateApprovalWritebackSync(result);
  }
  const emailSync = execute && action === "send_info"
    ? await runImmediateClarificationEmailSync(result)
    : undefined;

  return sanitizeApprovalOperationResult(result, execute, emailSync);
}

function sanitizeEventPrepResponse(response: EventPrepListResponse) {
  return {
    counts: response.counts,
    event: response.event,
    founders: response.founders.map(sanitizeFounder),
    page: response.page,
    pageSize: response.pageSize,
    query: response.query,
    relatedFounders: response.relatedFounders.map(sanitizeFounder),
    total: response.total
  };
}

function sanitizeFounder(founder: EventPrepFounder) {
  return {
    ask: founder.ask,
    cautionCount: founder.cautionCount,
    company: founder.company,
    id: founder.id,
    intro: founder.intro,
    introCount: founder.introCount,
    location: founder.location,
    name: founder.name,
    need: founder.need,
    notes: founder.notes,
    photoUrl: founder.photoUrl,
    role: founder.role
  };
}

function sanitizeApprovalListResponse(response: EventApprovalsListResponse) {
  return {
    applications: response.applications.map((application) => ({
      aiRecommendation: application.aiRecommendation,
      companyLine: application.companyLine,
      companyName: application.companyName,
      eventId: application.eventId,
      founderId: application.founderId,
      id: application.id,
      lumaStatus: application.lumaStatus,
      matchConfidence: application.matchConfidence,
      name: application.name,
      photoUrl: application.photoUrl,
      primaryAction: application.primaryAction,
      recommendation: application.recommendation,
      relation: application.relation,
      rule: application.rule,
      status: application.status,
      submittedAt: application.submittedAt
    })),
    counts: response.counts,
    event: response.event,
    page: response.page,
    pageSize: response.pageSize,
    query: response.query,
    segmentCounts: response.segmentCounts,
    total: response.total
  };
}

function sanitizeApprovalDossier(response: ApprovalDossierResponse) {
  const application = response.application;

  return {
    aiRecommendation: response.aiRecommendation,
    application: {
      audit: application.audit,
      clarificationRequest: application.clarificationRequest
        ? {
            preview: application.clarificationRequest.preview,
            subject: application.clarificationRequest.subject
          }
        : undefined,
      companyLine: application.companyLine,
      companyName: application.companyName,
      eventId: application.eventId,
      founderId: application.founderId,
      id: application.id,
      lumaStatus: application.lumaStatus,
      matchConfidence: application.matchConfidence,
      name: application.name,
      parsedReply: application.parsedReply,
      primaryAction: application.primaryAction,
      recommendation: application.recommendation,
      relation: application.relation,
      rule: application.rule,
      status: application.status,
      submittedAt: application.submittedAt
    },
    event: response.event,
    sourceComparisons: response.sourceComparisons.map((comparison) => ({
      field: comparison.field,
      notes: comparison.notes,
      result: comparison.result,
      source: comparison.source,
      weight: comparison.weight
    }))
  };
}

function sanitizeApprovalOperationResult(
  result: Awaited<ReturnType<typeof createBulkApprovalOperation>>,
  execute: boolean,
  emailSync?: Awaited<ReturnType<typeof runImmediateClarificationEmailSync>>
) {
  return {
    action: result.action,
    applications: result.applications.map((application) => ({
      companyLine: application.companyLine,
      companyName: application.companyName,
      eventId: application.eventId,
      id: application.id,
      name: application.name,
      primaryAction: application.primaryAction,
      status: application.status
    })),
    backendJobs: runtimeJobCounts(result.jobs),
    dryRun: result.dryRun,
    eventId: result.eventId,
    mode: execute ? "queued" : "dry_run",
    operationId: result.operationId,
    runtime: {
      owner: "yc_os",
      providerEffects: providerEffectsFor(result, execute, emailSync),
      emailSync,
      writebackSync: result.writebackSync
    },
    runtimeJobs: runtimeJobCounts(result.jobs),
    requestedCount: result.requestedCount,
    appliedCount: result.appliedCount,
    skipped: result.skipped,
    skippedCount: result.skippedCount
  };
}

async function runImmediateClarificationEmailSync(
  result: Awaited<ReturnType<typeof createBulkApprovalOperation>>
) {
  if (result.dryRun || !result.operationId) {
    return {
      status: "queued" as const,
      claimed: 0,
      succeeded: 0,
      failed: 0
    };
  }

  try {
    const summary = await processImmediateClarificationEmailsForOperationFromEnv(result.operationId);
    return {
      status: summary.failed > 0 ? "retrying" as const : "sent" as const,
      claimed: summary.claimed,
      succeeded: summary.succeeded,
      failed: summary.failed
    };
  } catch (error) {
    if (error instanceof ClarificationEmailWorkerConfigurationError) {
      return {
        status: "queued" as const,
        claimed: 0,
        succeeded: 0,
        failed: 0
      };
    }

    return {
      status: "retrying" as const,
      claimed: 0,
      succeeded: 0,
      failed: 0
    };
  }
}

function runtimeJobCounts(jobs: Awaited<ReturnType<typeof createBulkApprovalOperation>>["jobs"]) {
  return jobs.reduce<Record<"clarification_email" | "event_writeback", number>>((counts, job) => {
    const key = job.type === "clarification_email" ? "clarification_email" : "event_writeback";
    counts[key] += 1;
    return counts;
  }, {
    clarification_email: 0,
    event_writeback: 0
  });
}

function providerEffectsFor(
  result: Awaited<ReturnType<typeof createBulkApprovalOperation>>,
  execute: boolean,
  emailSync?: Awaited<ReturnType<typeof runImmediateClarificationEmailSync>>
) {
  if (!execute || result.dryRun) return "dry_run";
  if (result.action === "send_info") return emailSync?.status === "sent" ? "sent_email" : "queued_email";
  if (!result.jobs.some((job) => job.type === "luma_writeback")) return "supabase_only";
  return result.writebackSync?.status === "synced" ? "synced" : "queued_or_retrying";
}

function requiredString(value: unknown, field: string) {
  const stringValue = readString(value)?.trim();
  if (!stringValue) {
    throw new AgentToolError("missing_tool_argument", `${field} is required.`);
  }

  return stringValue;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readStringOrNumber(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

function readApprovalQuery(value: unknown) {
  if (!isRecord(value)) return undefined;

  return {
    aiDecision: normalizeAiDecision(readString(value.aiDecision), "all"),
    page: boundedInteger(readStringOrNumber(value.page), 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: boundedInteger(readStringOrNumber(value.pageSize), 25, 1, MAX_AGENT_PAGE_SIZE),
    queue: normalizeApprovalQueue(readString(value.queue), "all"),
    search: readString(value.search) ?? "",
    segment: normalizeApprovalSegment(readString(value.segment), "all")
  };
}

function readClarificationEmail(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    body: readString(value.body),
    subject: readString(value.subject)
  };
}

function looksLikeLumaEventId(eventId?: string) {
  return /^evt[-_][A-Za-z0-9]+$/.test(eventId ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
