import { randomUUID } from "node:crypto";

import {
  EventApprovalsRepositoryError,
  listApprovalEvents
} from "./event-approvals-repository";
import type { LoadedLumaEvent } from "./event-approvals-types";
import {
  type LumaCreateGuestApprovalStatus
} from "./luma/client";
import {
  createSupabaseServiceClientFromEnv,
  SupabaseRestError
} from "./supabase/service-client";
import {
  AgentGuestRequestWorkerConfigurationError,
  processImmediateAgentGuestRequestFromEnv
} from "./agent-guest-request-worker";
import { agentDryRunsDisabledMessage, areAgentDryRunsAllowed } from "./agent-runtime-policy";

type AgentEventKind = "real" | "demo";
type AgentGuestAddsAvailability = "available" | "dry_run_only";
type AgentGuestRequestStatus = "dry_run" | "pending" | "running" | "sent_to_luma" | "failed" | "blocked";
type AgentGuestRequestStorage = "database" | "not_configured";

export type AgentLumaGuestActionInput = {
  actorName?: string;
  approvalStatus: LumaCreateGuestApprovalStatus;
  eventId: string;
  execute: boolean;
  guests: Array<{
    email: string;
    name?: string;
    phoneNumber?: string;
  }>;
  reason?: string;
  sendEmail: boolean;
};

export type AgentLumaGuestActionResult = {
  action: "event_guests.add";
  approvalStatus: LumaCreateGuestApprovalStatus;
  checks: {
    dryRunDefault: boolean;
    maxGuests: number;
    reasonRequiredForExecute: boolean;
    sendEmailDefault: boolean;
  };
  dryRun: boolean;
  event: {
    guestAdds: AgentGuestAddsAvailability;
    id: string;
    kind: AgentEventKind;
    reason?: string;
    title: string;
  };
  execute: boolean;
  guests: Array<{
    emailDomain: string;
    hasName: boolean;
    hasPhone: boolean;
    index: number;
  }>;
  mode: "dry_run" | "queued";
  request: {
    id: string;
    status: AgentGuestRequestStatus;
    storage: AgentGuestRequestStorage;
  };
  requestedCount: number;
  runtime?: {
    owner: "yc_os";
    providerEffects: "dry_run" | "not_configured" | "queued_or_retrying" | "sent_to_luma";
    guestSync?: {
      status: "sent" | "queued" | "retrying" | "not_configured";
      claimed: number;
      succeeded: number;
      failed: number;
    };
  };
  sendEmail: boolean;
};

export type AgentLumaGuestActionDeps = {
  events?: LoadedLumaEvent[];
  guestRequestStore?: AgentGuestRequestStore;
};

export type AgentGuestRequestRecord = {
  action: "event_guests.add";
  actorName?: string;
  approvalStatus: LumaCreateGuestApprovalStatus;
  event: ResolvedAgentLumaEvent;
  execute: boolean;
  guests: AgentLumaGuestActionInput["guests"];
  reason?: string;
  requestedCount: number;
  sendEmail: boolean;
  status: AgentGuestRequestStatus;
};

export type AgentGuestRequestStore = {
  createGuestRequest(record: AgentGuestRequestRecord): Promise<{
    id: string;
    storage: "database";
  }>;
  updateGuestRequestStatus?(
    requestId: string,
    status: AgentGuestRequestStatus,
    details?: { errorMessage?: string; responseKeys?: string[] }
  ): Promise<void>;
};

type ResolvedAgentLumaEvent = AgentLumaGuestActionResult["event"] & {
  lumaEventId: string | null;
};

export class AgentActionError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AgentActionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const MAX_AGENT_LUMA_GUESTS = 10;
const DEFAULT_CREATE_APPROVAL_STATUS: LumaCreateGuestApprovalStatus = "approved";
const ALLOWED_CREATE_APPROVAL_STATUSES = new Set<LumaCreateGuestApprovalStatus>([
  "approved",
  "pending_approval",
  "waitlist"
]);

export async function createLumaGuestsForAgent(
  rawInput: unknown,
  deps: AgentLumaGuestActionDeps = {}
): Promise<AgentLumaGuestActionResult> {
  const input = normalizeLumaGuestActionInput(rawInput);
  const event = await resolveLumaEvent(input.eventId, deps.events, {
    allowDirectDryRun: !input.execute
  });
  const guestRequestStore = deps.guestRequestStore ?? createSupabaseAgentGuestRequestStoreFromEnv();
  const requestStatus = input.execute && !event.lumaEventId ? "blocked" : input.execute ? "pending" : "dry_run";
  const request = await createGuestRequestForAgent(
    input,
    event,
    requestStatus,
    guestRequestStore
  );
  const baseResult = resultFor(input, event, request);

  if (!input.execute) {
    return baseResult;
  }

  if (!event.lumaEventId) {
    throw new AgentActionError(
      "event_dry_run_only",
      "This event is dry-run-only. Choose a real event with guestAdds=available before executing.",
      409
    );
  }

  const runtime = request.storage === "database"
    ? await runImmediateGuestRequestSync(request.id)
    : guestRequestNotConfiguredRuntime();

  return {
    ...baseResult,
    dryRun: false,
    execute: true,
    mode: "queued",
    runtime
  };
}

export function agentActionErrorResponse(error: unknown) {
  if (error instanceof AgentActionError) {
    return {
      body: { error: error.code, message: error.message },
      status: error.statusCode
    };
  }

  if (error instanceof EventApprovalsRepositoryError) {
    return {
      body: { error: error.code, message: error.message },
      status: error.statusCode
    };
  }

  if (error instanceof SupabaseRestError) {
    return {
      body: {
        error: "agent_guest_request_store_error",
        message: "YC OS could not store the internal guest request."
      },
      status: 503
    };
  }

  return {
    body: { error: "agent_action_error", message: "Unable to complete agent action request." },
    status: 500
  };
}

function normalizeLumaGuestActionInput(rawInput: unknown): AgentLumaGuestActionInput {
  if (!isRecord(rawInput)) {
    throw new AgentActionError("invalid_action_request", "Agent action body must be an object.");
  }

  const eventId = requiredString(rawInput.eventId, "eventId");
  const guests = normalizeGuests(rawInput.guests);
  const approvalStatus = normalizeApprovalStatus(rawInput.approvalStatus ?? rawInput.approval_status);
  const sendEmail = booleanValue(rawInput.sendEmail ?? rawInput.send_email, false);
  const execute = booleanValue(rawInput.execute, true);
  requireDryRunAllowed(execute);
  const reason = optionalString(rawInput.reason, 500);
  const actorName = optionalString(rawInput.actorName ?? rawInput.actor_name, 120);

  if (execute && !reason) {
    throw new AgentActionError(
      "agent_action_reason_required",
      "Executing a YC OS event guest request requires a short reason.",
      400
    );
  }

  return {
    actorName,
    approvalStatus,
    eventId,
    execute,
    guests,
    reason,
    sendEmail
  };
}

function normalizeGuests(rawGuests: unknown) {
  if (!Array.isArray(rawGuests)) {
    throw new AgentActionError("invalid_guests", "guests must be an array.");
  }

  if (rawGuests.length === 0) {
    throw new AgentActionError("invalid_guests", "At least one guest is required.");
  }

  if (rawGuests.length > MAX_AGENT_LUMA_GUESTS) {
    throw new AgentActionError(
      "too_many_guests",
      `Agent event guest requests are limited to ${MAX_AGENT_LUMA_GUESTS} guests per request.`,
      400
    );
  }

  return rawGuests.map((rawGuest, index) => {
    if (!isRecord(rawGuest)) {
      throw new AgentActionError("invalid_guest", `Guest ${index + 1} must be an object.`);
    }

    const email = normalizeEmail(requiredString(rawGuest.email, `guests[${index}].email`), index);
    const name = optionalString(rawGuest.name, 120);
    const phoneNumber = optionalString(rawGuest.phoneNumber ?? rawGuest.phone_number, 40);

    return {
      email,
      ...(name ? { name } : {}),
      ...(phoneNumber ? { phoneNumber } : {})
    };
  });
}

function normalizeApprovalStatus(rawStatus: unknown): LumaCreateGuestApprovalStatus {
  const status = typeof rawStatus === "string" && rawStatus.trim()
    ? rawStatus.trim()
    : DEFAULT_CREATE_APPROVAL_STATUS;

  if (ALLOWED_CREATE_APPROVAL_STATUSES.has(status as LumaCreateGuestApprovalStatus)) {
    return status as LumaCreateGuestApprovalStatus;
  }

  throw new AgentActionError(
    "invalid_approval_status",
    "approvalStatus must be approved, pending_approval, or waitlist.",
    400
  );
}

async function resolveLumaEvent(
  eventId: string,
  providedEvents: LoadedLumaEvent[] | undefined,
  options: { allowDirectDryRun: boolean }
): Promise<ResolvedAgentLumaEvent> {
  if (looksLikeLumaEventId(eventId) && options.allowDirectDryRun) {
    return {
      guestAdds: "dry_run_only",
      id: eventId,
      kind: "real",
      lumaEventId: eventId,
      reason: "Direct Lu.ma ids are accepted for preview only. Use a listed real YC OS event before executing.",
      title: "Direct Lu.ma event preview"
    };
  }

  const events = providedEvents ?? await listApprovalEvents();
  const event = events.find((candidate) => candidate.id === eventId || candidate.lumaApiId === eventId);

  if (!event) {
    throw new AgentActionError("event_not_found", `No approval event found for ${eventId}.`, 404);
  }

  const lumaEventId = event.lumaApiId ?? (looksLikeLumaEventId(event.id) ? event.id : "");
  if (!lumaEventId) {
    return {
      guestAdds: "dry_run_only",
      id: event.id,
      kind: "demo",
      lumaEventId: null,
      reason: "No live Lu.ma destination is connected for this YC OS event. Use it for reads and previews only.",
      title: event.title
    };
  }

  return {
    guestAdds: "available",
    id: event.id,
    kind: "real",
    lumaEventId,
    reason: "Real event connected through YC OS. Execution can still be blocked by provider limits.",
    title: event.title
  };
}

function resultFor(
  input: AgentLumaGuestActionInput,
  event: Awaited<ReturnType<typeof resolveLumaEvent>>,
  request: AgentLumaGuestActionResult["request"]
): AgentLumaGuestActionResult {
  return {
    action: "event_guests.add",
    approvalStatus: input.approvalStatus,
    checks: {
      dryRunDefault: false,
      maxGuests: MAX_AGENT_LUMA_GUESTS,
      reasonRequiredForExecute: true,
      sendEmailDefault: false
    },
    dryRun: true,
    event: publicEventFor(event),
    execute: input.execute,
    guests: input.guests.map((guest, index) => ({
      emailDomain: emailDomainFor(guest.email),
      hasName: Boolean(guest.name),
      hasPhone: Boolean(guest.phoneNumber),
      index
    })),
    mode: "dry_run",
    request,
    requestedCount: input.guests.length,
    runtime: input.execute ? undefined : {
      owner: "yc_os",
      providerEffects: "dry_run"
    },
    sendEmail: input.sendEmail
  };
}

async function runImmediateGuestRequestSync(
  requestId: string
): Promise<NonNullable<AgentLumaGuestActionResult["runtime"]>> {
  try {
    const summary = await processImmediateAgentGuestRequestFromEnv(requestId);
    return {
      owner: "yc_os",
      providerEffects: summary.succeeded > 0 ? "sent_to_luma" : summary.failed > 0 ? "queued_or_retrying" : "queued_or_retrying",
      guestSync: {
        status: summary.succeeded > 0 ? "sent" : summary.failed > 0 ? "retrying" : "queued",
        claimed: summary.claimed,
        succeeded: summary.succeeded,
        failed: summary.failed
      }
    };
  } catch (error) {
    if (error instanceof AgentGuestRequestWorkerConfigurationError) {
      return guestRequestNotConfiguredRuntime();
    }

    return {
      owner: "yc_os",
      providerEffects: "queued_or_retrying",
      guestSync: {
        status: "retrying",
        claimed: 0,
        succeeded: 0,
        failed: 1
      }
    };
  }
}

function guestRequestNotConfiguredRuntime(): NonNullable<AgentLumaGuestActionResult["runtime"]> {
  return {
    owner: "yc_os",
    providerEffects: "not_configured",
    guestSync: {
      status: "not_configured",
      claimed: 0,
      succeeded: 0,
      failed: 0
    }
  };
}

async function createGuestRequestForAgent(
  input: AgentLumaGuestActionInput,
  event: ResolvedAgentLumaEvent,
  status: AgentGuestRequestStatus,
  store: AgentGuestRequestStore | undefined
): Promise<AgentLumaGuestActionResult["request"]> {
  const record: AgentGuestRequestRecord = {
    action: "event_guests.add",
    actorName: input.actorName,
    approvalStatus: input.approvalStatus,
    event,
    execute: input.execute,
    guests: input.guests,
    reason: input.reason,
    requestedCount: input.guests.length,
    sendEmail: input.sendEmail,
    status
  };

  if (!store) {
    return {
      id: `agent_guest_request_${randomUUID()}`,
      status,
      storage: "not_configured"
    };
  }

  return {
    ...(await store.createGuestRequest(record)),
    status
  };
}

function publicEventFor(event: ResolvedAgentLumaEvent): AgentLumaGuestActionResult["event"] {
  return {
    guestAdds: event.guestAdds,
    id: event.id,
    kind: event.kind,
    ...(event.reason ? { reason: event.reason } : {}),
    title: event.title
  };
}

function createSupabaseAgentGuestRequestStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env
): AgentGuestRequestStore | undefined {
  if (!hasSupabaseRequestStoreEnv(env)) return undefined;

  const client = createSupabaseServiceClientFromEnv(env);

  return {
    async createGuestRequest(record) {
      const rows = await client.insert<{ id: string }>("agent_guest_requests", [agentGuestRequestRow(record)], {
        returning: "representation",
        select: "id"
      });
      const id = rows[0]?.id;

      return {
        id: id ? `agent_guest_request_${id}` : `agent_guest_request_${randomUUID()}`,
        storage: "database"
      };
    },

    async updateGuestRequestStatus(requestId, status, details = {}) {
      const id = requestId.replace(/^agent_guest_request_/, "");
      await client.update("agent_guest_requests", {
        status,
        updated_at: new Date().toISOString(),
        ...(details.errorMessage ? { error_message: details.errorMessage } : {}),
        ...(details.responseKeys ? { result_payload: { response_keys: details.responseKeys } } : {})
      }, {
        filters: [{ column: "id", value: id }],
        returning: "minimal"
      });
    }
  };
}

function agentGuestRequestRow(record: AgentGuestRequestRecord) {
  return {
    action: record.action,
    actor_name: record.actorName,
    approval_status: record.approvalStatus,
    event_id: record.event.id,
    event_kind: record.event.kind,
    event_title: record.event.title,
    execute_requested: record.execute,
    guest_adds: record.event.guestAdds,
    guests: record.guests,
    luma_event_id: record.event.lumaEventId,
    reason: record.reason,
    requested_count: record.requestedCount,
    send_email: record.sendEmail,
    status: record.status
  };
}

function hasSupabaseRequestStoreEnv(env: NodeJS.ProcessEnv) {
  return Boolean(
    env.EVENT_APPROVALS_DATA_SOURCE === "supabase" &&
    (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) &&
    env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function requiredString(value: unknown, fieldName: string) {
  const normalized = optionalString(value, 254);
  if (!normalized) {
    throw new AgentActionError("missing_required_field", `${fieldName} is required.`, 400);
  }
  return normalized;
}

function optionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function requireDryRunAllowed(execute: boolean) {
  if (execute || areAgentDryRunsAllowed()) return;
  throw new AgentActionError("agent_dry_runs_disabled", agentDryRunsDisabledMessage(), 400);
}

function normalizeEmail(email: string, index: number) {
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AgentActionError("invalid_guest_email", `Guest ${index + 1} must include a valid email.`, 400);
  }
  return normalized;
}

function emailDomainFor(email: string) {
  return email.split("@")[1] ?? "unknown";
}

function looksLikeLumaEventId(eventId: string) {
  return /^evt[-_A-Za-z0-9]+$/.test(eventId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
