import { randomUUID } from "node:crypto";

import { AgentActionError } from "./agent-actions";
import { agentDryRunsDisabledMessage, areAgentDryRunsAllowed } from "./agent-runtime-policy";
import { createSupabaseServiceClient } from "./supabase/service-client";

type AgentEventRequestStatus = "dry_run" | "created" | "applied";
type AgentEventRequestStorage = "database" | "not_configured";
type EventAttendanceStatus = "expected" | "registered" | "checked_in" | "waitlist" | "cancelled";
type EventNoteType = "office_hours" | "other_founder" | "room" | "user";

export type AgentCreateEventInput = {
  actorName?: string;
  capacity?: number;
  description?: string;
  endsAt?: string;
  execute: boolean;
  location?: string;
  reason?: string;
  startsAt?: string;
  timezone?: string;
  title: string;
  url?: string;
};

export type AgentAddEventAttendeesInput = {
  actorName?: string;
  attendees: Array<{
    companyId?: string;
    founderId: string;
    status: EventAttendanceStatus;
  }>;
  eventId: string;
  execute: boolean;
  reason?: string;
};

export type AgentEnrichEventContextInput = {
  actorName?: string;
  eventId: string;
  execute: boolean;
  needs: Array<{
    companyId?: string;
    founderId: string;
    needCategory?: string;
    needText: string;
  }>;
  notes: Array<{
    body: string;
    companyId?: string;
    founderId?: string;
    noteType: EventNoteType;
  }>;
  reason?: string;
};

export type AgentCreateEventResult = {
  action: "events.create";
  checks: BaseEventChecks;
  dryRun: boolean;
  event: {
    capacity?: number;
    endsAt?: string;
    id: string;
    location?: string;
    providerSync: "yc_os_runtime";
    source: "yc_os";
    startsAt?: string;
    timezone?: string;
    title: string;
    url?: string;
  };
  execute: boolean;
  mode: "dry_run" | "created";
  request: AgentEventRequest;
};

export type AgentAddEventAttendeesResult = {
  action: "event_attendees.add";
  attendees: Array<{
    companyId?: string;
    founderId: string;
    index: number;
    status: EventAttendanceStatus;
  }>;
  checks: BaseEventChecks & {
    maxAttendees: number;
    ycSourcesOnly: boolean;
  };
  dryRun: boolean;
  eventId: string;
  execute: boolean;
  mode: "dry_run" | "applied";
  request: AgentEventRequest;
  requestedCount: number;
};

export type AgentEnrichEventContextResult = {
  action: "event_context.enrich";
  checks: BaseEventChecks & {
    maxNeeds: number;
    maxNotes: number;
    ycSourcesOnly: boolean;
  };
  dryRun: boolean;
  eventId: string;
  execute: boolean;
  mode: "dry_run" | "applied";
  needs: Array<{
    companyId?: string;
    founderId: string;
    hasNeedCategory: boolean;
    index: number;
    needTextLength: number;
  }>;
  notes: Array<{
    bodyLength: number;
    companyId?: string;
    founderId?: string;
    index: number;
    noteType: EventNoteType;
  }>;
  request: AgentEventRequest;
};

export type AgentCreateEventRecord = {
  actorName?: string;
  event: AgentCreateEventResult["event"] & {
    description?: string;
    reason?: string;
  };
  execute: boolean;
  reason?: string;
  status: AgentEventRequestStatus;
};

export type AgentAddEventAttendeesRecord = {
  actorName?: string;
  attendees: AgentAddEventAttendeesInput["attendees"];
  eventId: string;
  execute: boolean;
  reason?: string;
  status: AgentEventRequestStatus;
};

export type AgentEnrichEventContextRecord = {
  actorName?: string;
  eventId: string;
  execute: boolean;
  needs: AgentEnrichEventContextInput["needs"];
  notes: AgentEnrichEventContextInput["notes"];
  reason?: string;
  status: AgentEventRequestStatus;
};

export type AgentEventStore = {
  addEventAttendees?(record: AgentAddEventAttendeesRecord): Promise<{
    id: string;
    storage: "database";
  }>;
  createEvent(record: AgentCreateEventRecord): Promise<{
    id: string;
    storage: "database";
  }>;
  enrichEventContext?(record: AgentEnrichEventContextRecord): Promise<{
    id: string;
    storage: "database";
  }>;
};

export type AgentEventActionDeps = {
  eventStore?: AgentEventStore;
};

type AgentEventRequest = {
  id: string;
  status: AgentEventRequestStatus;
  storage: AgentEventRequestStorage;
};

type BaseEventChecks = {
  dryRunDefault: boolean;
  providerApisHidden: boolean;
  reasonRequiredForExecute: boolean;
};

const MAX_EVENT_ATTENDEES = 50;
const MAX_EVENT_NOTES = 20;
const MAX_EVENT_NEEDS = 20;
const EVENT_ATTENDANCE_STATUSES = new Set<EventAttendanceStatus>([
  "expected",
  "registered",
  "checked_in",
  "waitlist",
  "cancelled"
]);
const EVENT_NOTE_TYPES = new Set<EventNoteType>([
  "office_hours",
  "other_founder",
  "room",
  "user"
]);

export async function createEventForAgent(
  rawInput: unknown,
  deps: AgentEventActionDeps = {}
): Promise<AgentCreateEventResult> {
  const input = normalizeCreateEventInput(rawInput);
  const event = eventForInput(input);

  if (!input.execute) {
    return createEventResultFor(input, event, dryRunRequest("event"));
  }

  const eventStore = deps.eventStore ?? createSupabaseAgentEventStoreFromEnv();
  if (!eventStore) throw missingStoreError("YC OS event creation");

  const request = await eventStore.createEvent({
    actorName: input.actorName,
    event: {
      ...event,
      ...(input.description ? { description: input.description } : {}),
      ...(input.reason ? { reason: input.reason } : {})
    },
    execute: input.execute,
    reason: input.reason,
    status: "created"
  });

  return createEventResultFor(input, {
    ...event,
    id: request.id
  }, {
    id: `agent_event_request_${request.id}`,
    status: "created",
    storage: request.storage
  });
}

export async function addEventAttendeesForAgent(
  rawInput: unknown,
  deps: AgentEventActionDeps = {}
): Promise<AgentAddEventAttendeesResult> {
  const input = normalizeAddEventAttendeesInput(rawInput);

  if (!input.execute) {
    return addEventAttendeesResultFor(input, dryRunRequest("attendees"));
  }

  const eventStore = deps.eventStore ?? createSupabaseAgentEventStoreFromEnv();
  if (!eventStore?.addEventAttendees) throw missingStoreError("YC OS event attendee adds");

  const request = await eventStore.addEventAttendees({
    actorName: input.actorName,
    attendees: input.attendees,
    eventId: input.eventId,
    execute: input.execute,
    reason: input.reason,
    status: "applied"
  });

  return addEventAttendeesResultFor(input, {
    id: `agent_event_request_${request.id}`,
    status: "applied",
    storage: request.storage
  });
}

export async function enrichEventContextForAgent(
  rawInput: unknown,
  deps: AgentEventActionDeps = {}
): Promise<AgentEnrichEventContextResult> {
  const input = normalizeEnrichEventContextInput(rawInput);

  if (!input.execute) {
    return enrichEventContextResultFor(input, dryRunRequest("enrichment"));
  }

  const eventStore = deps.eventStore ?? createSupabaseAgentEventStoreFromEnv();
  if (!eventStore?.enrichEventContext) throw missingStoreError("YC OS event context enrichment");

  const request = await eventStore.enrichEventContext({
    actorName: input.actorName,
    eventId: input.eventId,
    execute: input.execute,
    needs: input.needs,
    notes: input.notes,
    reason: input.reason,
    status: "applied"
  });

  return enrichEventContextResultFor(input, {
    id: `agent_event_request_${request.id}`,
    status: "applied",
    storage: request.storage
  });
}

function normalizeCreateEventInput(rawInput: unknown): AgentCreateEventInput {
  if (!isRecord(rawInput)) {
    throw new AgentActionError("invalid_event_request", "Agent event body must be an object.");
  }

  const title = requiredString(rawInput.title, "title", 160);
  const execute = booleanValue(rawInput.execute, true);
  requireDryRunAllowed(execute);
  const reason = optionalString(rawInput.reason, 500);
  requireReasonForExecute(execute, reason, "Creating a YC OS event requires a short reason.");

  return {
    actorName: optionalString(rawInput.actorName ?? rawInput.actor_name, 120),
    capacity: optionalCapacity(rawInput.capacity),
    description: optionalString(rawInput.description, 4000),
    endsAt: optionalDateTime(rawInput.endsAt ?? rawInput.ends_at, "endsAt"),
    execute,
    location: optionalString(rawInput.location, 500),
    reason,
    startsAt: optionalDateTime(rawInput.startsAt ?? rawInput.starts_at, "startsAt"),
    timezone: optionalString(rawInput.timezone, 80),
    title,
    url: optionalUrl(rawInput.url ?? rawInput.sourceUrl ?? rawInput.source_url)
  };
}

function normalizeAddEventAttendeesInput(rawInput: unknown): AgentAddEventAttendeesInput {
  if (!isRecord(rawInput)) {
    throw new AgentActionError("invalid_event_attendees_request", "Agent event attendee body must be an object.");
  }

  const execute = booleanValue(rawInput.execute, true);
  requireDryRunAllowed(execute);
  const reason = optionalString(rawInput.reason, 500);
  requireReasonForExecute(execute, reason, "Adding YC OS event attendees requires a short reason.");

  return {
    actorName: optionalString(rawInput.actorName ?? rawInput.actor_name, 120),
    attendees: normalizeAttendees(rawInput.attendees),
    eventId: requiredString(rawInput.eventId ?? rawInput.event_id, "eventId", 160),
    execute,
    reason
  };
}

function normalizeEnrichEventContextInput(rawInput: unknown): AgentEnrichEventContextInput {
  if (!isRecord(rawInput)) {
    throw new AgentActionError("invalid_event_enrichment_request", "Agent event enrichment body must be an object.");
  }

  const execute = booleanValue(rawInput.execute, true);
  requireDryRunAllowed(execute);
  const reason = optionalString(rawInput.reason, 500);
  requireReasonForExecute(execute, reason, "Enriching YC OS event context requires a short reason.");
  const notes = normalizeNotes(rawInput.notes);
  const needs = normalizeNeeds(rawInput.needs);

  if (notes.length === 0 && needs.length === 0) {
    throw new AgentActionError("invalid_event_enrichment", "At least one note or need is required.", 400);
  }

  return {
    actorName: optionalString(rawInput.actorName ?? rawInput.actor_name, 120),
    eventId: requiredString(rawInput.eventId ?? rawInput.event_id, "eventId", 160),
    execute,
    needs,
    notes,
    reason
  };
}

function normalizeAttendees(rawAttendees: unknown): AgentAddEventAttendeesInput["attendees"] {
  if (!Array.isArray(rawAttendees)) {
    throw new AgentActionError("invalid_event_attendees", "attendees must be an array.", 400);
  }
  if (rawAttendees.length === 0) {
    throw new AgentActionError("invalid_event_attendees", "At least one attendee is required.", 400);
  }
  if (rawAttendees.length > MAX_EVENT_ATTENDEES) {
    throw new AgentActionError(
      "too_many_event_attendees",
      `YC OS event attendee requests are limited to ${MAX_EVENT_ATTENDEES} attendees.`,
      400
    );
  }

  return rawAttendees.map((rawAttendee, index) => {
    if (!isRecord(rawAttendee)) {
      throw new AgentActionError("invalid_event_attendee", `Attendee ${index + 1} must be an object.`, 400);
    }

    return {
      companyId: optionalString(rawAttendee.companyId ?? rawAttendee.company_id, 160),
      founderId: requiredString(rawAttendee.founderId ?? rawAttendee.founder_id, `attendees[${index}].founderId`, 160),
      status: normalizeAttendanceStatus(rawAttendee.status)
    };
  });
}

function normalizeNotes(rawNotes: unknown): AgentEnrichEventContextInput["notes"] {
  if (rawNotes === undefined) return [];
  if (!Array.isArray(rawNotes)) {
    throw new AgentActionError("invalid_event_notes", "notes must be an array.", 400);
  }
  if (rawNotes.length > MAX_EVENT_NOTES) {
    throw new AgentActionError(
      "too_many_event_notes",
      `YC OS event enrichment is limited to ${MAX_EVENT_NOTES} notes per request.`,
      400
    );
  }

  return rawNotes.map((rawNote, index) => {
    if (!isRecord(rawNote)) {
      throw new AgentActionError("invalid_event_note", `Note ${index + 1} must be an object.`, 400);
    }

    return {
      body: requiredString(rawNote.body, `notes[${index}].body`, 4000),
      companyId: optionalString(rawNote.companyId ?? rawNote.company_id, 160),
      founderId: optionalString(rawNote.founderId ?? rawNote.founder_id, 160),
      noteType: normalizeNoteType(rawNote.noteType ?? rawNote.note_type)
    };
  });
}

function normalizeNeeds(rawNeeds: unknown): AgentEnrichEventContextInput["needs"] {
  if (rawNeeds === undefined) return [];
  if (!Array.isArray(rawNeeds)) {
    throw new AgentActionError("invalid_event_needs", "needs must be an array.", 400);
  }
  if (rawNeeds.length > MAX_EVENT_NEEDS) {
    throw new AgentActionError(
      "too_many_event_needs",
      `YC OS event enrichment is limited to ${MAX_EVENT_NEEDS} needs per request.`,
      400
    );
  }

  return rawNeeds.map((rawNeed, index) => {
    if (!isRecord(rawNeed)) {
      throw new AgentActionError("invalid_event_need", `Need ${index + 1} must be an object.`, 400);
    }

    return {
      companyId: optionalString(rawNeed.companyId ?? rawNeed.company_id, 160),
      founderId: requiredString(rawNeed.founderId ?? rawNeed.founder_id, `needs[${index}].founderId`, 160),
      needCategory: optionalString(rawNeed.needCategory ?? rawNeed.need_category, 120),
      needText: requiredString(rawNeed.needText ?? rawNeed.need_text, `needs[${index}].needText`, 4000)
    };
  });
}

function eventForInput(input: AgentCreateEventInput): AgentCreateEventResult["event"] {
  return {
    id: `yc-agent-event-${randomUUID()}`,
    providerSync: "yc_os_runtime",
    source: "yc_os",
    title: input.title,
    ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
    ...(input.endsAt ? { endsAt: input.endsAt } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.startsAt ? { startsAt: input.startsAt } : {}),
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.url ? { url: input.url } : {})
  };
}

function createEventResultFor(
  input: AgentCreateEventInput,
  event: AgentCreateEventResult["event"],
  request: AgentEventRequest
): AgentCreateEventResult {
  return {
    action: "events.create",
    checks: baseChecks(),
    dryRun: !input.execute,
    event,
    execute: input.execute,
    mode: input.execute ? "created" : "dry_run",
    request
  };
}

function addEventAttendeesResultFor(
  input: AgentAddEventAttendeesInput,
  request: AgentEventRequest
): AgentAddEventAttendeesResult {
  return {
    action: "event_attendees.add",
    attendees: input.attendees.map((attendee, index) => ({
      companyId: attendee.companyId,
      founderId: attendee.founderId,
      index,
      status: attendee.status
    })),
    checks: {
      ...baseChecks(),
      maxAttendees: MAX_EVENT_ATTENDEES,
      ycSourcesOnly: true
    },
    dryRun: !input.execute,
    eventId: input.eventId,
    execute: input.execute,
    mode: input.execute ? "applied" : "dry_run",
    request,
    requestedCount: input.attendees.length
  };
}

function enrichEventContextResultFor(
  input: AgentEnrichEventContextInput,
  request: AgentEventRequest
): AgentEnrichEventContextResult {
  return {
    action: "event_context.enrich",
    checks: {
      ...baseChecks(),
      maxNeeds: MAX_EVENT_NEEDS,
      maxNotes: MAX_EVENT_NOTES,
      ycSourcesOnly: true
    },
    dryRun: !input.execute,
    eventId: input.eventId,
    execute: input.execute,
    mode: input.execute ? "applied" : "dry_run",
    needs: input.needs.map((need, index) => ({
      companyId: need.companyId,
      founderId: need.founderId,
      hasNeedCategory: Boolean(need.needCategory),
      index,
      needTextLength: need.needText.length
    })),
    notes: input.notes.map((note, index) => ({
      bodyLength: note.body.length,
      companyId: note.companyId,
      founderId: note.founderId,
      index,
      noteType: note.noteType
    })),
    request
  };
}

function baseChecks(): BaseEventChecks {
  return {
    dryRunDefault: false,
    providerApisHidden: true,
    reasonRequiredForExecute: true
  };
}

function dryRunRequest(kind: "event" | "attendees" | "enrichment"): AgentEventRequest {
  return {
    id: `agent_${kind}_request_${randomUUID()}`,
    status: "dry_run",
    storage: "not_configured"
  };
}

export function createSupabaseAgentEventStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch
): AgentEventStore | undefined {
  if (!hasSupabaseEventStoreEnv(env)) return undefined;

  const client = createSupabaseServiceClient({
    fetchFn,
    serviceRoleKey: readRequiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
    url: readRequiredEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"])
  });

  return {
    async addEventAttendees(record) {
      await ensureApprovalEventAnchor(client, record.eventId);
      await client.upsert("yc_event_attendance", record.attendees.map((attendee) => ({
        company_id: attendee.companyId,
        event_id: record.eventId,
        founder_id: attendee.founderId,
        metadata: {
          actor_name: record.actorName,
          agent_added: true,
          reason: record.reason
        },
        source: "yc_os_agent",
        status: attendee.status
      })), {
        onConflict: "event_id,founder_id",
        returning: "minimal"
      });

      return {
        id: `${record.eventId}_attendees_${randomUUID()}`,
        storage: "database"
      };
    },

    async createEvent(record) {
      const rows = await client.insert<{ id: string }>("yc_events", [agentEventRow(record)], {
        returning: "representation",
        select: "id"
      });
      const id = rows[0]?.id ?? record.event.id;

      return {
        id,
        storage: "database"
      };
    },

    async enrichEventContext(record) {
      await ensureApprovalEventAnchor(client, record.eventId);
      const noteRows = record.notes.map((note) => agentNoteRow(record, note));
      const needRows = record.needs.map((need) => agentNeedRow(record, need));

      await Promise.all([
        noteRows.length > 0
          ? client.insert("yc_notes", noteRows, { returning: "minimal" })
          : Promise.resolve([]),
        needRows.length > 0
          ? client.insert("yc_founder_needs", needRows, { returning: "minimal" })
          : Promise.resolve([])
      ]);

      return {
        id: `${record.eventId}_enrichment_${randomUUID()}`,
        storage: "database"
      };
    }
  };
}

async function ensureApprovalEventAnchor(
  client: ReturnType<typeof createSupabaseServiceClient>,
  eventId: string
) {
  if (!isUuid(eventId)) return;

  const existing = await client.select<{ id: string }>("yc_events", {
    filters: [{ column: "id", value: eventId }],
    limit: 1,
    select: "id"
  });
  if (existing.length > 0) return;

  const events = await client.select<Record<string, unknown>>("luma_events", {
    filters: [{ column: "id", value: eventId }],
    limit: 1,
    select: "id,title,url,starts_at,location_text,synced_at,luma_event_id,calendar_id"
  });
  const event = events[0];
  if (!event) return;

  await client.upsert("yc_events", [approvalEventAnchorRow(event)], {
    onConflict: "id",
    returning: "minimal"
  });
}

function approvalEventAnchorRow(event: Record<string, unknown>) {
  const id = optionalString(event.id, 160);
  const title = optionalString(event.title, 160);

  return {
    attendee_count: 0,
    id,
    location: optionalString(event.location_text, 500),
    metadata: {
      agent_write_anchor: true,
      calendar_id: optionalString(event.calendar_id, 160),
      luma_event_id: optionalString(event.luma_event_id, 160)
    },
    retrieved_at: optionalString(event.synced_at, 80),
    source_kind: "luma_approval",
    source_url: optionalString(event.url, 500),
    starts_at: optionalString(event.starts_at, 80),
    title: title ?? id ?? "Lu.ma approval event"
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function agentEventRow(record: AgentCreateEventRecord) {
  return {
    attendee_count: 0,
    id: record.event.id,
    location: record.event.location,
    metadata: {
      agent_created: true,
      actor_name: record.actorName,
      capacity: record.event.capacity,
      description: record.event.description,
      provider_sync: record.event.providerSync,
      reason: record.reason,
      request_status: record.status,
      timezone: record.event.timezone
    },
    source_kind: "yc_os_agent",
    source_url: record.event.url,
    starts_at: record.event.startsAt,
    title: record.event.title
  };
}

function agentNoteRow(
  record: AgentEnrichEventContextRecord,
  note: AgentEnrichEventContextInput["notes"][number]
) {
  return {
    author_name: record.actorName,
    body: note.body,
    company_id: note.companyId,
    event_id: record.eventId,
    founder_id: note.founderId,
    id: `agent-note-${randomUUID()}`,
    metadata: {
      agent_enriched: true,
      reason: record.reason
    },
    note_type: note.noteType,
    source_kind: "yc_os_agent",
    visibility: "team"
  };
}

function agentNeedRow(
  record: AgentEnrichEventContextRecord,
  need: AgentEnrichEventContextInput["needs"][number]
) {
  return {
    company_id: need.companyId,
    event_id: record.eventId,
    founder_id: need.founderId,
    id: `agent-need-${randomUUID()}`,
    is_current: true,
    metadata: {
      actor_name: record.actorName,
      agent_enriched: true,
      reason: record.reason
    },
    need_category: need.needCategory,
    need_text: need.needText,
    source: "yc_os_agent"
  };
}

function hasSupabaseEventStoreEnv(env: NodeJS.ProcessEnv) {
  return Boolean(
    env.EVENT_PREP_DATA_SOURCE === "supabase" &&
    (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) &&
    env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function readRequiredEnv(env: NodeJS.ProcessEnv, keyOrKeys: string | string[]) {
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function requireReasonForExecute(execute: boolean, reason: string | undefined, message: string) {
  if (!execute || reason) return;
  throw new AgentActionError("agent_action_reason_required", message, 400);
}

function requireDryRunAllowed(execute: boolean) {
  if (execute || areAgentDryRunsAllowed()) return;
  throw new AgentActionError("agent_dry_runs_disabled", agentDryRunsDisabledMessage(), 400);
}

function missingStoreError(action: string) {
  return new AgentActionError(
    "agent_event_store_not_configured",
    `${action} requires backend YC OS event storage in this environment.`,
    503
  );
}

function requiredString(value: unknown, fieldName: string, maxLength: number) {
  const normalized = optionalString(value, maxLength);
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

function optionalDateTime(value: unknown, fieldName: string) {
  const normalized = optionalString(value, 80);
  if (!normalized) return undefined;

  if (!Number.isFinite(Date.parse(normalized))) {
    throw new AgentActionError("invalid_event_time", `${fieldName} must be an ISO-like date/time string.`, 400);
  }

  return normalized;
}

function optionalCapacity(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 100000) {
    throw new AgentActionError("invalid_event_capacity", "capacity must be an integer between 0 and 100000.", 400);
  }
  return numberValue;
}

function optionalUrl(value: unknown) {
  const normalized = optionalString(value, 500);
  if (!normalized) return undefined;

  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // Fall through to the validation error below.
  }

  throw new AgentActionError("invalid_event_url", "url must be an http or https URL.", 400);
}

function normalizeAttendanceStatus(value: unknown): EventAttendanceStatus {
  if (typeof value === "string" && EVENT_ATTENDANCE_STATUSES.has(value as EventAttendanceStatus)) {
    return value as EventAttendanceStatus;
  }
  return "expected";
}

function normalizeNoteType(value: unknown): EventNoteType {
  if (typeof value === "string" && EVENT_NOTE_TYPES.has(value as EventNoteType)) {
    return value as EventNoteType;
  }
  return "user";
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
