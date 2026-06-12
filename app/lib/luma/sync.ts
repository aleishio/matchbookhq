import type {
  LumaClientConfig,
  LumaEventEntry,
  LumaGuestEntry,
  LumaPaginatedResponse
} from "./client";
import { createLumaClientFromEnv } from "./client";
import { createSupabaseServiceClientFromEnv } from "../supabase/service-client";

export type LumaSyncEventRow = {
  id: string;
  lumaEventId: string;
};

export type ExistingLumaApplicationRow = {
  id: string;
  lumaGuestId: string;
  approvalStatus: string;
  relation?: string | null;
  recommendation?: string | null;
  ruleCode?: string | null;
  primaryAction?: string | null;
  selectedDefault?: boolean | null;
  matchConfidence?: number | null;
  aiRecommendation?: Record<string, unknown> | null;
};

export type UpsertLumaEventInput = {
  externalAccountId: string;
  lumaEventId: string;
  calendarId?: string;
  title: string;
  url?: string;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  locationText?: string;
  capacity?: number;
  approvalMode?: string;
  rawPayload: Record<string, unknown>;
  syncedAt: string;
};

export type UpsertLumaApplicationInput = {
  lumaEventId: string;
  lumaGuestId: string;
  applicantName: string;
  applicantEmail?: string;
  applicantPhone?: string;
  lumaStatus: string;
  approvalStatus: string;
  matchConfidence: number;
  relation: string;
  recommendation: string;
  ruleCode: string;
  primaryAction: string;
  selectedDefault: boolean;
  lumaFields: Record<string, unknown>;
  lumaPayload: Record<string, unknown>;
  aiRecommendation: Record<string, unknown>;
  submittedAt?: string;
  syncedAt: string;
  lastSeenAt: string;
};

export type LumaSyncStore = {
  upsertExternalAccount(input: {
    providerAccountId: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
  upsertLumaEvent(input: UpsertLumaEventInput): Promise<LumaSyncEventRow>;
  listApplicationsForEvent(lumaEventId: string): Promise<ExistingLumaApplicationRow[]>;
  upsertLumaApplications(rows: UpsertLumaApplicationInput[]): Promise<void>;
  recordSyncRun?(run: LumaSyncRunRecord): Promise<void>;
};

export type LumaSyncRunRecord = {
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  eventsSynced: number;
  applicationsSynced: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export type LumaSyncClient = {
  listCalendarEvents(params?: Parameters<ReturnType<typeof createLumaClientFromEnv>["listCalendarEvents"]>[0]): Promise<LumaPaginatedResponse<LumaEventEntry>>;
  listEventGuests(params: Parameters<ReturnType<typeof createLumaClientFromEnv>["listEventGuests"]>[0]): Promise<LumaPaginatedResponse<LumaGuestEntry>>;
};

export type LumaSyncOptions = {
  externalAccountId?: string;
  calendarId?: string;
  eventApiIds?: string[];
  eventPageLimit?: number;
  guestPageLimit?: number;
  maxEvents?: number;
  maxGuestsPerEvent?: number;
  requestSpacingMs?: number;
  sleepFn?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
};

export type LumaSyncSummary = {
  status: "completed" | "failed";
  externalAccountId: string;
  startedAt: string;
  completedAt: string;
  eventsSeen: number;
  eventsSynced: number;
  eventsSkipped: number;
  applicationsSynced: number;
  pagesFetched: number;
  guestPagesFetched: number;
  errors: string[];
};

const DEFAULT_EVENT_PAGE_LIMIT = 50;
const DEFAULT_GUEST_PAGE_LIMIT = 100;
const DEFAULT_REQUEST_SPACING_MS = 250;

export async function syncLumaApprovalsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return syncLumaApprovals({
    lumaClient: createLumaClientFromEnv(env),
    store: createSupabaseLumaSyncStoreFromEnv(env),
    options: {
      externalAccountId: env.LUMA_ACCOUNT_ID || env.LUMA_CALENDAR_ID,
      calendarId: env.LUMA_CALENDAR_ID,
      eventPageLimit: numberFromEnv(env.LUMA_SYNC_EVENT_PAGE_LIMIT, DEFAULT_EVENT_PAGE_LIMIT),
      guestPageLimit: numberFromEnv(env.LUMA_SYNC_GUEST_PAGE_LIMIT, DEFAULT_GUEST_PAGE_LIMIT),
      requestSpacingMs: numberFromEnv(env.LUMA_SYNC_REQUEST_SPACING_MS, DEFAULT_REQUEST_SPACING_MS)
    }
  });
}

export async function syncLumaApprovals({
  lumaClient,
  store,
  options = {}
}: {
  lumaClient: LumaSyncClient;
  store: LumaSyncStore;
  options?: LumaSyncOptions;
}): Promise<LumaSyncSummary> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const fallbackExternalAccountKey = options.externalAccountId || options.calendarId || "single-calendar";
  const accountsByKey = new Map<string, { id: string }>();
  const eventFilter = new Set(options.eventApiIds ?? []);
  const errors: string[] = [];
  let eventsSeen = 0;
  let eventsSynced = 0;
  let eventsSkipped = 0;
  let applicationsSynced = 0;
  let pagesFetched = 0;
  let guestPagesFetched = 0;
  const paced = createPacedCaller(options.requestSpacingMs ?? DEFAULT_REQUEST_SPACING_MS, options.sleepFn);

  try {
    let cursor: string | undefined;
    while (true) {
      const eventPage = await paced(() => lumaClient.listCalendarEvents({
        paginationCursor: cursor,
        paginationLimit: options.eventPageLimit ?? DEFAULT_EVENT_PAGE_LIMIT,
        status: "approved",
        sortColumn: "start_at",
        sortDirection: "asc"
      }));
      pagesFetched += 1;

      for (const event of eventPage.entries ?? []) {
        eventsSeen += 1;
        const lumaEventId = lumaEventIdFor(event);
        if (!lumaEventId) {
          eventsSkipped += 1;
          errors.push("Skipped Lu.ma event without stable id.");
          continue;
        }
        if (eventFilter.size > 0 && !eventFilter.has(lumaEventId)) {
          eventsSkipped += 1;
          continue;
        }
        if (options.maxEvents !== undefined && eventsSynced >= options.maxEvents) {
          eventsSkipped += 1;
          continue;
        }

        const syncedAt = now().toISOString();
        const account = await accountForLumaEvent({
          accountsByKey,
          event,
          fallbackExternalAccountKey,
          options,
          store
        });
        const dbEvent = await store.upsertLumaEvent(mapLumaEvent(event, {
          externalAccountId: account.id,
          lumaEventId,
          syncedAt,
          calendarId: options.calendarId
        }));
        eventsSynced += 1;

        const guestSummary = await syncGuestsForEvent({
          lumaClient,
          store,
          dbEvent,
          lumaEventId,
          now,
          paced,
          guestPageLimit: options.guestPageLimit ?? DEFAULT_GUEST_PAGE_LIMIT,
          maxGuestsPerEvent: options.maxGuestsPerEvent
        });
        applicationsSynced += guestSummary.applicationsSynced;
        guestPagesFetched += guestSummary.pagesFetched;
      }

      cursor = eventPage.next_cursor ?? undefined;
      if (!cursor) break;
    }

    const completedAt = now().toISOString();
    const summary: LumaSyncSummary = {
      status: "completed",
      externalAccountId: syncSummaryExternalAccountId(accountsByKey, fallbackExternalAccountKey),
      startedAt,
      completedAt,
      eventsSeen,
      eventsSynced,
      eventsSkipped,
      applicationsSynced,
      pagesFetched,
      guestPagesFetched,
      errors
    };
    await store.recordSyncRun?.({
      status: "completed",
      startedAt,
      completedAt,
      eventsSynced,
      applicationsSynced,
      metadata: { eventsSeen, eventsSkipped, pagesFetched, guestPagesFetched, errors }
    });
    return summary;
  } catch (error) {
    const completedAt = now().toISOString();
    const message = error instanceof Error ? error.message : "Unknown Lu.ma sync failure.";
    await store.recordSyncRun?.({
      status: "failed",
      startedAt,
      completedAt,
      eventsSynced,
      applicationsSynced,
      errorMessage: message,
      metadata: { eventsSeen, eventsSkipped, pagesFetched, guestPagesFetched }
    });
    return {
      status: "failed",
      externalAccountId: syncSummaryExternalAccountId(accountsByKey, fallbackExternalAccountKey),
      startedAt,
      completedAt,
      eventsSeen,
      eventsSynced,
      eventsSkipped,
      applicationsSynced,
      pagesFetched,
      guestPagesFetched,
      errors: [message]
    };
  }
}

function createPacedCaller(spacingMs: number, sleepFn: ((milliseconds: number) => Promise<void>) | undefined) {
  let callCount = 0;
  const sleep = sleepFn ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  return async function paced<T>(fn: () => Promise<T>) {
    if (callCount > 0 && spacingMs > 0) await sleep(spacingMs);
    callCount += 1;
    return fn();
  };
}

async function accountForLumaEvent({
  accountsByKey,
  event,
  fallbackExternalAccountKey,
  options,
  store
}: {
  accountsByKey: Map<string, { id: string }>;
  event: LumaEventEntry;
  fallbackExternalAccountKey: string;
  options: LumaSyncOptions;
  store: LumaSyncStore;
}) {
  const calendarId = options.calendarId ?? calendarIdForEvent(event);
  const providerAccountId = options.externalAccountId || calendarId || fallbackExternalAccountKey;
  const existing = accountsByKey.get(providerAccountId);
  if (existing) return existing;

  const account = await store.upsertExternalAccount({
    providerAccountId,
    displayName: calendarId ? `Lu.ma calendar ${calendarId}` : "Lu.ma approvals",
    metadata: {
      calendar_id: calendarId ?? null
    }
  });
  accountsByKey.set(providerAccountId, account);
  return account;
}

function syncSummaryExternalAccountId(accountsByKey: Map<string, { id: string }>, fallback: string) {
  const accountIds = Array.from(accountsByKey.values()).map((account) => account.id);
  if (accountIds.length === 0) return fallback;
  if (accountIds.length === 1) return accountIds[0];
  return "multiple";
}

async function syncGuestsForEvent({
  lumaClient,
  store,
  dbEvent,
  lumaEventId,
  now,
  paced,
  guestPageLimit,
  maxGuestsPerEvent
}: {
  lumaClient: LumaSyncClient;
  store: LumaSyncStore;
  dbEvent: LumaSyncEventRow;
  lumaEventId: string;
  now: () => Date;
  paced: <T>(fn: () => Promise<T>) => Promise<T>;
  guestPageLimit: number;
  maxGuestsPerEvent?: number;
}) {
  const existingRows = await store.listApplicationsForEvent(dbEvent.id);
  const existingByGuestId = new Map(existingRows.map((row) => [row.lumaGuestId, row]));
  let cursor: string | undefined;
  let pagesFetched = 0;
  let applicationsSynced = 0;

  while (true) {
    const guestPage = await paced(() => lumaClient.listEventGuests({
      eventId: lumaEventId,
      paginationCursor: cursor,
      paginationLimit: guestPageLimit,
      sortColumn: "created_at",
      sortDirection: "asc"
    }));
    pagesFetched += 1;

    const rows = [];
    for (const guest of guestPage.entries ?? []) {
      if (maxGuestsPerEvent !== undefined && applicationsSynced >= maxGuestsPerEvent) break;
      const lumaGuestId = lumaGuestIdFor(guest);
      if (!lumaGuestId) continue;
      const existing = existingByGuestId.get(lumaGuestId);
      rows.push(mapLumaGuest(guest, {
        dbEventId: dbEvent.id,
        lumaEventId,
        lumaGuestId,
        existing,
        syncedAt: now().toISOString()
      }));
      applicationsSynced += 1;
    }

    if (rows.length > 0) await store.upsertLumaApplications(rows);
    cursor = guestPage.next_cursor ?? undefined;
    if (!cursor || (maxGuestsPerEvent !== undefined && applicationsSynced >= maxGuestsPerEvent)) break;
  }

  return { pagesFetched, applicationsSynced };
}

function mapLumaEvent(
  event: LumaEventEntry,
  context: {
    externalAccountId: string;
    lumaEventId: string;
    syncedAt: string;
    calendarId?: string;
  }
): UpsertLumaEventInput {
  return {
    externalAccountId: context.externalAccountId,
    lumaEventId: context.lumaEventId,
    calendarId: stringField(event.calendar_id) ?? context.calendarId,
    title: event.name,
    url: event.url,
    startsAt: event.start_at,
    endsAt: event.end_at,
    timezone: event.timezone,
    locationText: locationTextFor(event),
    capacity: numberField(event.capacity) ?? numberField(event.max_capacity),
    approvalMode: stringField(event.approval_mode),
    rawPayload: event,
    syncedAt: context.syncedAt
  };
}

function mapLumaGuest(
  guest: LumaGuestEntry,
  context: {
    dbEventId: string;
    lumaEventId: string;
    lumaGuestId: string;
    existing?: ExistingLumaApplicationRow;
    syncedAt: string;
  }
): UpsertLumaApplicationInput {
  const applicantName = nameForGuest(guest);
  const lumaStatus = guest.approval_status ?? "pending_approval";
  const approvalStatus = approvalStatusFor(lumaStatus, context.existing?.approvalStatus);
  const registrationAnswers = normalizeRegistrationAnswers(guest.registration_answers);
  const existing = context.existing;
  const photoUrl = photoUrlForGuest(guest);

  return {
    lumaEventId: context.dbEventId,
    lumaGuestId: context.lumaGuestId,
    applicantName,
    applicantEmail: guest.user_email,
    applicantPhone: guest.phone_number ?? undefined,
    lumaStatus,
    approvalStatus,
    matchConfidence: existing?.matchConfidence ?? 0,
    relation: existing?.relation ?? "Unmapped Lu.ma applicant",
    recommendation: existing?.recommendation ?? "Manual review required after Lu.ma sync.",
    ruleCode: existing?.ruleCode ?? "LUMA_SYNC_UNMAPPED",
    primaryAction: existing?.primaryAction ?? primaryActionFor(approvalStatus),
    selectedDefault: existing?.selectedDefault ?? false,
    lumaFields: {
      event_api_id: context.lumaEventId,
      guest_api_id: stringField(guest.api_id) ?? null,
      guest_provider_id: stringField(guest.id) ?? null,
      guest_user_id: stringField(guest.user_id) ?? null,
      guest_unique_id: context.lumaGuestId,
      email: guest.user_email,
      phone: guest.phone_number ?? null,
      photo_url: photoUrl ?? null,
      registration_answers: registrationAnswers
    },
    lumaPayload: guest,
    aiRecommendation: existing?.aiRecommendation ?? {},
    submittedAt: guest.registered_at ?? undefined,
    syncedAt: context.syncedAt,
    lastSeenAt: context.syncedAt
  };
}

export function lumaEventIdFor(event: LumaEventEntry) {
  return stringField(event.api_id) ?? stringField(event.id);
}

export function firstCalendarId(events: LumaEventEntry[]) {
  for (const event of events) {
    const calendarId = calendarIdForEvent(event);
    if (calendarId) return calendarId;
  }
  return undefined;
}

function calendarIdForEvent(event: LumaEventEntry) {
  return stringField(event.calendar_api_id) ?? stringField(event.calendar_id);
}

export function lumaGuestIdFor(guest: LumaGuestEntry) {
  return stringField(guest.api_id) ?? stringField(guest.id) ?? stringField(guest.user_id) ?? stringField(guest.user_email);
}

export function approvalStatusFor(lumaStatus: string, existingStatus?: string) {
  if (lumaStatus === "approved") return "approved";
  if (lumaStatus === "declined") return "rejected";
  if (lumaStatus === "waitlist") return "waitlist";
  if (existingStatus === "approved" || existingStatus === "rejected" || existingStatus === "awaiting_reply") {
    return existingStatus;
  }
  return existingStatus ?? "manual";
}

function photoUrlForGuest(guest: LumaGuestEntry) {
  const user = recordField(guest.user);
  const guestProfile = recordField(guest.guest);
  const candidates = [
    guest.photo_url,
    guest.avatar_url,
    guest.profile_image_url,
    guest.image_url,
    guest.user_photo_url,
    guest.user_avatar_url,
    guest.user_image_url,
    user.photo_url,
    user.avatar_url,
    user.profile_image_url,
    user.image_url,
    guestProfile.photo_url,
    guestProfile.avatar_url,
    guestProfile.profile_image_url,
    guestProfile.image_url
  ];

  return candidates.map(stringField).find(Boolean);
}

function recordField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function primaryActionFor(approvalStatus: string) {
  if (approvalStatus === "ready") return "approve";
  if (approvalStatus === "needs_info") return "send_info";
  if (approvalStatus === "waitlist" || approvalStatus === "approved" || approvalStatus === "rejected") return "none";
  return "manual_review";
}

function nameForGuest(guest: LumaGuestEntry) {
  const fullName = [guest.user_first_name, guest.user_last_name].filter(Boolean).join(" ").trim();
  return guest.user_name?.trim() || fullName || guest.user_email || "Unknown applicant";
}

function normalizeRegistrationAnswers(answers: unknown) {
  const normalized: Record<string, unknown> = {};
  if (!Array.isArray(answers)) return normalized;

  for (const [index, answer] of answers.entries()) {
    if (!answer || typeof answer !== "object") {
      normalized[`answer_${index + 1}`] = answer;
      continue;
    }
    const item = answer as Record<string, unknown>;
    const key = stringField(item.label) ?? stringField(item.question) ?? stringField(item.id) ?? `answer_${index + 1}`;
    normalized[key] = item.answer ?? item.value ?? item.text ?? item.response ?? item;
  }

  return normalized;
}

function locationTextFor(event: Record<string, unknown>) {
  const location = event.geo_address_json;
  if (location && typeof location === "object") {
    const record = location as Record<string, unknown>;
    return stringField(record.full_address) ?? stringField(record.address) ?? stringField(record.city_state);
  }
  return stringField(event.location) ?? stringField(event.location_text);
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createSupabaseLumaSyncStoreFromEnv(env: NodeJS.ProcessEnv = process.env): LumaSyncStore {
  const client = createSupabaseServiceClientFromEnv(env);

  return {
    async upsertExternalAccount(input) {
      const rows = await client.upsert<Array<{ id: string }>[number]>("external_accounts", [{
        provider: "luma",
        provider_account_id: input.providerAccountId,
        display_name: input.displayName ?? "Lu.ma approvals",
        metadata: input.metadata ?? {}
      }], {
        onConflict: "provider,provider_account_id",
        returning: "representation",
        select: "id"
      });
      return rows[0];
    },

    async upsertLumaEvent(input) {
      const rows = await client.upsert<Array<{ id: string; luma_event_id: string }>[number]>("luma_events", [{
        external_account_id: input.externalAccountId,
        luma_event_id: input.lumaEventId,
        calendar_id: input.calendarId ?? null,
        title: input.title,
        url: input.url ?? null,
        starts_at: input.startsAt ?? null,
        ends_at: input.endsAt ?? null,
        timezone: input.timezone ?? null,
        location_text: input.locationText ?? null,
        capacity: input.capacity ?? null,
        approval_mode: input.approvalMode ?? null,
        raw_payload: input.rawPayload,
        synced_at: input.syncedAt,
        updated_at: input.syncedAt
      }], {
        onConflict: "external_account_id,luma_event_id",
        returning: "representation",
        select: "id,luma_event_id"
      });
      return {
        id: rows[0].id,
        lumaEventId: rows[0].luma_event_id
      };
    },

    async listApplicationsForEvent(lumaEventId) {
      const rows = await client.select<Array<Record<string, unknown>>[number]>("luma_event_applications", {
        select: "id,luma_guest_id,approval_status,relation,recommendation,rule_code,primary_action,selected_default,match_confidence,ai_recommendation",
        filters: [{ column: "luma_event_id", value: lumaEventId }]
      });

      return rows.map((row) => ({
        id: String(row.id),
        lumaGuestId: String(row.luma_guest_id),
        approvalStatus: String(row.approval_status),
        relation: row.relation as string | null,
        recommendation: row.recommendation as string | null,
        ruleCode: row.rule_code as string | null,
        primaryAction: row.primary_action as string | null,
        selectedDefault: row.selected_default as boolean | null,
        matchConfidence: typeof row.match_confidence === "number" ? row.match_confidence : null,
        aiRecommendation: row.ai_recommendation as Record<string, unknown> | null
      }));
    },

    async upsertLumaApplications(rows) {
      if (rows.length === 0) return;
      await client.upsert("luma_event_applications", rows.map((row) => ({
        luma_event_id: row.lumaEventId,
        luma_guest_id: row.lumaGuestId,
        applicant_name: row.applicantName,
        applicant_email: row.applicantEmail ?? null,
        applicant_phone: row.applicantPhone ?? null,
        luma_status: row.lumaStatus,
        approval_status: row.approvalStatus,
        match_confidence: row.matchConfidence,
        relation: row.relation,
        recommendation: row.recommendation,
        rule_code: row.ruleCode,
        primary_action: row.primaryAction,
        selected_default: row.selectedDefault,
        luma_fields: row.lumaFields,
        luma_payload: row.lumaPayload,
        ai_recommendation: row.aiRecommendation,
        submitted_at: row.submittedAt ?? null,
        synced_at: row.syncedAt,
        last_seen_at: row.lastSeenAt,
        updated_at: row.syncedAt
      })), {
        onConflict: "luma_event_id,luma_guest_id",
        returning: "minimal"
      });
    },

    async recordSyncRun(run) {
      await client.insert("luma_sync_runs", [{
        status: run.status,
        started_at: run.startedAt,
        completed_at: run.completedAt,
        events_synced: run.eventsSynced,
        applications_synced: run.applicationsSynced,
        error_message: run.errorMessage ?? null,
        metadata: run.metadata ?? {}
      }], { returning: "minimal" });
    }
  };
}
