import type {
  EventPrepData,
  EventPrepFounder,
  EventPrepIntro,
  EventPrepNote,
  FitLabel,
  NoteType
} from "./event-prep-data";
import {
  introRouteFor,
  publicContactRoutesFor
} from "./event-prep-data";
import {
  aliasedPrepEventIdForApprovalEvent,
  approvalEventLookupKeys,
  eventPrepSummaryFromApprovalEvent,
  mergeEventPrepSummaries,
  sortEventPrepSummariesForDisplay
} from "./event-directory";
import {
  buildEventPrepListResponse,
  EventPrepRepositoryError,
  normalizeEventPrepQuery,
  relatedFoundersFor,
  type EventPrepEventSummary,
  type EventPrepQuery,
  type EventPrepListResponse
} from "./event-prep-repository";
import {
  listApprovalEventsFromSupabase,
  listYcFounderProfileFallbacksForApplications
} from "./event-approvals-supabase-repository";
import type { LoadedLumaEvent } from "./event-approvals-types";
import { mapApplicationRow } from "./event-approvals-supabase-repository";
import { createSupabaseServiceClientFromEnv } from "./supabase/service-client";
import {
  suggestIntrosForFounder,
  type FounderForMatching,
  type IntroSuggestion
} from "@/lib/matching";

type SupabaseClient = ReturnType<typeof createSupabaseServiceClientFromEnv>;
type Row = Record<string, unknown>;
type PrepEventContext = {
  attendanceCounts: Map<string, number>;
  prepEvents: EventPrepEventSummary[];
  rowById: Map<string, Row>;
  rows: Row[];
};
type EventSnapshot = {
  founders: EventPrepFounder[];
  relatedFounderPool?: EventPrepFounder[];
};

export async function listEventPrepFoundersFromSupabase(
  query: EventPrepQuery = {}
): Promise<EventPrepListResponse> {
  const client = createSupabaseServiceClientFromEnv();
  const selection = await resolveEventSelection(client, query.eventId);
  const snapshot = await loadEventSnapshot(client, selection.dataEventId, {
    approvalEventId: selection.approvalEventId,
    applicationBacked: selection.applicationBacked
  });
  const event = {
    ...selection.displayEvent,
    attendeeCount: snapshot.founders.length
  };
  const normalized = normalizeEventPrepQuery(query, event.id);
  const response = buildEventPrepListResponse(event, snapshot.founders, normalized);
  const relatedFromBackingData = snapshot.relatedFounderPool
    ? relatedFoundersFor(response.founders, snapshot.relatedFounderPool)
    : [];

  return {
    ...response,
    relatedFounders: mergeEventPrepFounders(response.relatedFounders, relatedFromBackingData)
  };
}

export async function listEventPrepEventsFromSupabase(): Promise<EventPrepEventSummary[]> {
  const client = createSupabaseServiceClientFromEnv();
  const context = await loadPrepEventContext(client);
  const approvalEvents = await listApprovalEventsFromSupabase().catch(() => []);

  return prepDisplayEventsFor(client, approvalEvents, context);
}

async function resolveEventSelection(client: SupabaseClient, eventId?: string) {
  const context = await loadPrepEventContext(client);
  const approvalEvents = await listApprovalEventsFromSupabase().catch(() => []);
  const displayEvents = await prepDisplayEventsFor(client, approvalEvents, context);
  const displayEvent = eventId
    ? displayEvents.find((event) => event.id === eventId)
      ?? displayEventForBackingPrepEvent(eventId, displayEvents, approvalEvents, context)
    : displayEvents[0];

  if (!displayEvent) {
    throw new EventPrepRepositoryError(
      "event_not_found",
      `No event prep event found for ${eventId ?? "default event"}.`,
      404
    );
  }

  const approvalEvent = approvalEvents.find((event) => event.id === displayEvent.id);
  const dataEventId = approvalEvent
    ? dataEventIdForApprovalEvent(approvalEvent, context)
    : context.rowById.has(displayEvent.id)
      ? displayEvent.id
      : fallbackPrepEventId(context);

  if (!dataEventId) {
    throw new EventPrepRepositoryError(
      "event_not_found",
      `No event prep data found for ${displayEvent.title}.`,
      404
    );
  }

  return {
    approvalEventId: approvalEvent?.id,
    applicationBacked: approvalEvent
      ? shouldUseApprovalApplicationsForPrep(approvalEvent, dataEventId, context)
      : false,
    dataEventId,
    displayEvent
  };
}

async function loadPrepEventContext(client: SupabaseClient): Promise<PrepEventContext> {
  const { eventRows, attendanceCounts } = await loadEventRowsWithAttendanceCounts(client);
  const rows = eventRows.filter((row) => !isHiddenEvent(row));
  const prepEvents = rows
    .map((row) => mapEventRow(row, attendanceCounts.get(String(row.id)) ?? 0))
    .sort(compareEventSummaries);

  return {
    attendanceCounts,
    prepEvents,
    rowById: new Map(rows.map((row) => [String(row.id), row])),
    rows
  };
}

function displayEventForBackingPrepEvent(
  eventId: string,
  displayEvents: EventPrepEventSummary[],
  approvalEvents: LoadedLumaEvent[],
  context: PrepEventContext
) {
  for (const approvalEvent of approvalEvents.filter(isVisibleApprovalEventForPrep)) {
    if (dataEventIdForApprovalEvent(approvalEvent, context) !== eventId) continue;
    return displayEvents.find((event) => event.id === approvalEvent.id);
  }

  return context.prepEvents.find((event) => event.id === eventId);
}

async function prepDisplayEventsFor(
  client: SupabaseClient,
  approvalEvents: LoadedLumaEvent[],
  context: PrepEventContext
) {
  const visibleApprovalEvents = approvalEvents.filter(isVisibleApprovalEventForPrep);
  const approvedApplicationCounts = await approvedApplicationCountsFor(
    client,
    visibleApprovalEvents.map((event) => event.id)
  );
  const approvalPrepEvents = visibleApprovalEvents.map((event) =>
    prepSummaryForApprovalEvent(event, context, approvedApplicationCounts.get(event.id))
  );
  const backingPrepEventIds = new Set(
    visibleApprovalEvents
      .map((event) => dataEventIdForApprovalEvent(event, context))
      .filter((eventId): eventId is string => Boolean(eventId))
  );
  const standalonePrepEvents = context.prepEvents.filter(
    (event) => !backingPrepEventIds.has(event.id)
  );

  return sortEventPrepSummariesForDisplay(
    mergeEventPrepSummaries(approvalPrepEvents, standalonePrepEvents)
  );
}

async function approvedApplicationCountsFor(client: SupabaseClient, approvalEventIds: string[]) {
  const counts = new Map<string, number>();
  if (approvalEventIds.length === 0) return counts;

  const rows = await client.select<Row>("luma_event_applications", {
    select: "luma_event_id,approval_status",
    filters: [
      { column: "luma_event_id", operator: "in", value: approvalEventIds },
      { column: "approval_status", value: "approved" }
    ]
  });
  const approvalEventIdSet = new Set(approvalEventIds);

  for (const row of rows) {
    const eventId = stringValue(row.luma_event_id);
    if (!eventId || !approvalEventIdSet.has(eventId)) continue;
    if (!isApprovedApplicationRow(row)) continue;
    counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
  }

  return counts;
}

function isVisibleApprovalEventForPrep(event: LoadedLumaEvent) {
  if (hasApprovalLookupKey(event, "yc-founder-mixer")) return false;
  if (hasApprovalLookupKey(event, "founder-dinner")) return false;
  if (hasApprovalLookupKey(event, "ai-infra-office-hours")) return true;

  return event.lumaApiId?.startsWith("evt") || Boolean(event.url);
}

function hasApprovalLookupKey(event: LoadedLumaEvent, expectedKey: string) {
  return approvalEventLookupKeys(event).includes(expectedKey);
}

function prepSummaryForApprovalEvent(
  event: LoadedLumaEvent,
  context: PrepEventContext,
  applicationBackedCount?: number
): EventPrepEventSummary {
  const dataEventId = dataEventIdForApprovalEvent(event, context);
  const dataEvent = dataEventId
    ? context.prepEvents.find((candidate) => candidate.id === dataEventId)
    : undefined;
  const attendeeCount = applicationBackedCount
    ?? (shouldUseApprovalApplicationsForPrep(event, dataEventId, context) ? 0 : dataEvent?.attendeeCount);

  return eventPrepSummaryFromApprovalEvent(event, {
    attendeeCount,
    sourceUrl: event.url ?? dataEvent?.sourceUrl
  });
}

function shouldUseApprovalApplicationsForPrep(
  event: LoadedLumaEvent,
  dataEventId: string | undefined,
  context: PrepEventContext
) {
  if (!dataEventId || event.applicationCount < 1) return false;
  const dataEvent = context.prepEvents.find((candidate) => candidate.id === dataEventId);

  return dataEvent?.mode === "example" && dataEvent.id !== event.id;
}

function dataEventIdForApprovalEvent(
  event: LoadedLumaEvent,
  context: PrepEventContext
) {
  for (const key of approvalEventLookupKeys(event)) {
    const byId = eventIdFromLookupKey(key, context);
    if (byId) return byId;
  }

  const alias = aliasedPrepEventIdForApprovalEvent(event);
  if (alias && context.rowById.has(alias)) return alias;

  return fallbackPrepEventId(context);
}

function eventIdFromLookupKey(key: string, context: PrepEventContext) {
  if (context.rowById.has(key)) return key;

  for (const row of context.rows) {
    const metadata = objectValue(row.metadata);
    const sourceUrl = stringValue(row.source_url) ?? stringValue(metadata.luma_url);
    const metadataLumaId = stringValue(metadata.luma_event_id);
    const approvalIds = stringArray(metadata.approval_event_ids);

    if (metadataLumaId === key) return String(row.id);
    if (sourceUrl === key) return String(row.id);
    if (approvalIds.includes(key)) return String(row.id);
  }

  return undefined;
}

function fallbackPrepEventId(context: PrepEventContext) {
  const sortedEvents = sortEventPrepSummariesForDisplay(context.prepEvents);
  return sortedEvents.find((event) => event.mode === "live")?.id
    ?? sortedEvents.find((event) => event.mode === "example")?.id
    ?? context.prepEvents[0]?.id;
}

async function getEventRow(client: SupabaseClient, eventId?: string) {
  if (!eventId) {
    const { eventRows, attendanceCounts } = await loadEventRowsWithAttendanceCounts(client);
    const visibleRows = eventRows.filter((candidate) => !isHiddenEvent(candidate));
    const row = visibleRows.slice().sort((left, right) =>
      compareEventRowsByPrepCoverage(left, right, attendanceCounts)
    )[0];

    if (!row) {
      throw new EventPrepRepositoryError(
        "event_not_found",
        "No event prep event found for default event.",
        404
      );
    }

    return row;
  }

  const rows = await client.select<Row>("yc_events", {
    select: "*",
    filters: [{ column: "id", value: eventId }],
    limit: 1
  });
  const row = rows[0];

  if (!row) {
    throw new EventPrepRepositoryError(
      "event_not_found",
      `No event prep event found for ${eventId ?? "default event"}.`,
      404
    );
  }

  return row;
}

async function loadEventRowsWithAttendanceCounts(client: SupabaseClient) {
  const [eventRows, attendanceRows] = await Promise.all([
    client.select<Row>("yc_events", {
      select: "*",
      order: "starts_at.desc.nullslast,imported_at.desc"
    }),
    client.select<Row>("yc_event_attendance", {
      select: "event_id"
    })
  ]);
  const attendanceCounts = new Map<string, number>();

  for (const row of attendanceRows) {
    const eventId = stringValue(row.event_id);
    if (!eventId) continue;
    attendanceCounts.set(eventId, (attendanceCounts.get(eventId) ?? 0) + 1);
  }

  return { eventRows, attendanceCounts };
}

async function loadEventSnapshot(
  client: SupabaseClient,
  eventId: string,
  options: { approvalEventId?: string; applicationBacked?: boolean } = {}
) {
  const [
    attendanceRows,
    founderRows,
    companyRows,
    needRows,
    noteRows,
    introRows,
    applicationRows
  ] = await Promise.all([
    client.select<Row>("yc_event_attendance", {
      select: "*",
      filters: [{ column: "event_id", value: eventId }]
    }),
    client.select<Row>("yc_founders", { select: "*" }),
    client.select<Row>("yc_companies", { select: "*" }),
    client.select<Row>("yc_founder_needs", {
      select: "*",
      filters: [{ column: "event_id", value: eventId }]
    }),
    client.select<Row>("yc_notes", {
      select: "*",
      filters: [{ column: "event_id", value: eventId }],
      order: "created_at.desc"
    }),
    client.select<Row>("yc_intro_suggestions", {
      select: "*",
      filters: [{ column: "event_id", value: eventId }]
    }),
    options.approvalEventId
      ? client.select<Row>("luma_event_applications", {
        select: "*",
        filters: approvalApplicationFilters(options.approvalEventId),
        order: "submitted_at.desc.nullslast,created_at.desc"
      })
      : Promise.resolve([])
  ]);
  const approvedApplicationRows = applicationRows.filter(isApprovedApplicationRow);

  const applicationSidecars = approvedApplicationRows.length > 0
    ? { ycFounderProfiles: await listYcFounderProfileFallbacksForApplications(client, approvedApplicationRows) }
    : {};
  const founders = mapAttendanceFounders({
    attendanceRows,
    companyRows,
    founderRows,
    introRows,
    needRows,
    noteRows
  });

  if (options.applicationBacked) {
    const backingFoundersByName = uniqueFounderByNormalizedName(founders);
    const applicationFounders = approvedApplicationRows.map((row) =>
      applicationPrepFounder(
        row,
        applicationSidecars,
        backingFoundersByName.get(normalizedFounderName(String(row.applicant_name)))
      )
    );

    return {
      founders: withGeneratedIntros(applicationFounders, [...applicationFounders, ...founders]),
      relatedFounderPool: founders
    };
  }

  return {
    founders: withGeneratedIntros(mergeApprovedApplicationFounders(founders, approvedApplicationRows, applicationSidecars))
  };
}

function approvalApplicationFilters(approvalEventId: string) {
  return [
    { column: "luma_event_id", value: approvalEventId },
    { column: "approval_status", value: "approved" }
  ];
}

function isApprovedApplicationRow(row: Row) {
  return stringValue(row.approval_status) === "approved";
}

function mapAttendanceFounders({
  attendanceRows,
  companyRows,
  founderRows,
  introRows,
  needRows,
  noteRows
}: {
  attendanceRows: Row[];
  companyRows: Row[];
  founderRows: Row[];
  introRows: Row[];
  needRows: Row[];
  noteRows: Row[];
}) {
  const foundersById = new Map(founderRows.map((row) => [String(row.id), row]));
  const companiesById = new Map(companyRows.map((row) => [String(row.id), row]));
  const needsByFounderId = new Map(needRows.map((row) => [String(row.founder_id), row]));
  const notesByFounderId = groupRowsBy(noteRows, "founder_id");
  const introsByFounderId = new Map(introRows.map((row) => [String(row.from_founder_id), row]));

  const founders = attendanceRows.slice().sort(compareAttendanceRows)
    .map((attendance): EventPrepFounder | null => {
      const founder = foundersById.get(String(attendance.founder_id));
      if (!founder) return null;
      const company = companiesById.get(String(founder.company_id));
      const need = needsByFounderId.get(String(founder.id));
      const intro = introsByFounderId.get(String(founder.id));

      return mapFounderRow({
        founder,
        company,
        need,
        intro,
        notes: notesByFounderId.get(String(founder.id)) ?? []
      });
    })
    .filter((founder): founder is EventPrepFounder => Boolean(founder));

  return withIntroRoutes(founders);
}

function uniqueFounderByNormalizedName(founders: EventPrepFounder[]) {
  const foundersByName = new Map<string, EventPrepFounder | null>();

  for (const founder of founders) {
    const name = normalizedFounderName(founder.name);
    if (foundersByName.has(name)) {
      foundersByName.set(name, null);
      continue;
    }

    foundersByName.set(name, founder);
  }

  return new Map(
    [...foundersByName].filter((entry): entry is [string, EventPrepFounder] =>
      Boolean(entry[1])
    )
  );
}

function mergeApprovedApplicationFounders(
  founders: EventPrepFounder[],
  approvedApplicationRows: Row[],
  sidecars: Parameters<typeof mapApplicationRow>[1] = {}
) {
  const seen = new Set(founders.map(prepFounderDedupeKey));
  const seenNames = new Set(founders.map((founder) => normalizedFounderName(founder.name)));
  const merged = [...founders];

  for (const row of approvedApplicationRows) {
    const founder = approvedApplicationFounder(row, sidecars);
    const key = prepFounderDedupeKey(founder);
    const name = normalizedFounderName(founder.name);
    if (seenNames.has(name)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    seenNames.add(name);
    merged.push(founder);
  }

  return merged;
}

function approvedApplicationFounder(
  row: Row,
  sidecars: Parameters<typeof mapApplicationRow>[1] = {}
): EventPrepFounder {
  const application = mapApplicationRow(row, sidecars);
  const companyName = application.companyName === "Unknown company"
    ? "Approved Lu.ma guest"
    : application.companyName;

  return {
    id: `approved-application-${application.id}`,
    name: application.name,
    role: "Approved guest",
    photoUrl: application.photoUrl,
    company: {
      id: `approved-application-company-${application.id}`,
      name: companyName,
      batch: "Lu.ma",
      stage: "Approved",
      category: "Approved guest",
      oneLiner: application.companyLine || "Approved through the event approval queue."
    },
    contactRoutes: [],
    location: "Approved Lu.ma applicant",
    ask: application.recommendation || "Approved in YC OS.",
    need: "Need: event-prep enrichment is limited until this guest is mapped to a YC founder record.",
    introCount: 0,
    cautionCount: 1,
    notes: [{
      id: `${application.id}-approval-note`,
      type: "Room note",
      body: "Approved in the event approval queue. This lightweight prep card comes from Lu.ma because no YC founder record is mapped yet.",
      source: "event approval"
    }]
  };
}

function applicationPrepFounder(
  row: Row,
  sidecars: Parameters<typeof mapApplicationRow>[1] = {},
  backingFounder?: EventPrepFounder
): EventPrepFounder {
  const application = mapApplicationRow(row, sidecars);
  if (backingFounder) {
    return {
      ...backingFounder,
      name: application.name,
      photoUrl: application.photoUrl ?? backingFounder.photoUrl,
      notes: [
        applicationPrepNote(application.id, application.recommendation),
        ...backingFounder.notes
      ]
    };
  }

  const companyName = application.companyName === "Unknown company"
    ? "Lu.ma applicant"
    : application.companyName;
  const statusLabel = approvalStatusLabel(application.status);

  return {
    id: `application-${application.id}`,
    name: application.name,
    role: "Lu.ma applicant",
    photoUrl: application.photoUrl,
    company: {
      id: `application-company-${application.id}`,
      name: companyName,
      batch: "Lu.ma",
      stage: statusLabel,
      category: application.relation || "Event applicant",
      oneLiner: application.companyLine || application.recommendation || "Applied through the event approval queue."
    },
    contactRoutes: [],
    location: "Lu.ma application",
    ask: application.recommendation || "Review the application evidence before event prep.",
    need: `Status: ${statusLabel}; Lu.ma: ${application.lumaStatus || "unknown"}.`,
    introCount: 0,
    cautionCount: application.status === "ready" || application.status === "approved" ? 0 : 1,
    notes: [applicationPrepNote(application.id, application.recommendation)]
  };
}

function applicationPrepNote(applicationId: string, recommendation: string): EventPrepNote {
  return {
    id: `${applicationId}-application-note`,
    type: "Room note",
    body: recommendation || "Approved application from the approval queue.",
    source: "event approval"
  };
}

function mergeEventPrepFounders(
  primary: EventPrepFounder[],
  fallback: EventPrepFounder[]
) {
  const founders = new Map<string, EventPrepFounder>();
  for (const founder of [...primary, ...fallback]) {
    if (!founders.has(founder.id)) founders.set(founder.id, founder);
  }
  return [...founders.values()];
}

function approvalStatusLabel(status: string) {
  if (status === "needsInfo") return "Needs info";
  if (status === "awaitingReply") return "Awaiting reply";
  if (status === "manual") return "Manual review";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function prepFounderDedupeKey(founder: EventPrepFounder) {
  return `${normalizedFounderName(founder.name)}::${founder.company.name.trim().toLowerCase()}`;
}

function normalizedFounderName(name: string) {
  return name.trim().toLowerCase();
}

function mapEventRow(row: Row, founderCount: number): EventPrepData["event"] {
  const sourceUrl = stringValue(row.source_url) ?? stringValue(objectValue(row.metadata).luma_url);

  return {
    id: String(row.id),
    title: String(row.title),
    location: stringValue(row.location) ?? "San Francisco",
    startsAt: formatEventTime(stringValue(row.starts_at)),
    attendeeCount: founderCount > 0 ? founderCount : numberValue(row.attendee_count) ?? 0,
    source: sourceLabel(stringValue(row.source_kind)),
    sourceUrl,
    mode: eventModeFor(row)
  };
}

function compareEventSummaries(left: EventPrepEventSummary, right: EventPrepEventSummary) {
  const leftModeRank = eventModeRank(left.mode);
  const rightModeRank = eventModeRank(right.mode);
  if (leftModeRank !== rightModeRank) return leftModeRank - rightModeRank;
  if (left.attendeeCount !== right.attendeeCount) return right.attendeeCount - left.attendeeCount;
  return left.title.localeCompare(right.title);
}

function compareEventRowsByPrepCoverage(
  left: Row,
  right: Row,
  attendanceCounts: Map<string, number>
) {
  const leftCount = eventPrepCoverageFor(left, attendanceCounts);
  const rightCount = eventPrepCoverageFor(right, attendanceCounts);
  if (leftCount !== rightCount) return rightCount - leftCount;

  const leftStartsAt = dateMs(stringValue(left.starts_at));
  const rightStartsAt = dateMs(stringValue(right.starts_at));
  if (leftStartsAt !== rightStartsAt) return rightStartsAt - leftStartsAt;

  const leftImportedAt = dateMs(stringValue(left.imported_at));
  const rightImportedAt = dateMs(stringValue(right.imported_at));
  return rightImportedAt - leftImportedAt;
}

function eventPrepCoverageFor(row: Row, attendanceCounts: Map<string, number>) {
  return attendanceCounts.get(String(row.id)) ?? numberValue(row.attendee_count) ?? 0;
}

function eventModeFor(row: Row) {
  const metadata = objectValue(row.metadata);
  const displayKind = stringValue(metadata.display_kind);
  if (displayKind === "example" || displayKind === "live") return displayKind;

  const source = `${stringValue(row.source_kind) ?? ""} ${stringValue(row.source_url) ?? ""}`.toLowerCase();
  return source.includes("luma") ? "live" : "example";
}

function eventModeRank(mode?: EventPrepEventSummary["mode"]) {
  if (mode === "live") return 0;
  if (mode === "example") return 1;
  return 2;
}

function isHiddenEvent(row: Row) {
  return stringValue(objectValue(row.metadata).display_kind) === "hidden";
}

function mapFounderRow({
  founder,
  company,
  need,
  intro,
  notes
}: {
  founder: Row;
  company?: Row;
  need?: Row;
  intro?: Row;
  notes: Row[];
}): EventPrepFounder {
  const imagePaths = objectValue(founder.image_paths);
  const socialLinks = objectValue(founder.social_links);
  const companySocialLinks = objectValue(company?.social_links);
  const companyId = stringValue(company?.id) ?? stringValue(founder.company_id) ?? "unknown-company";
  const mappedIntro = intro ? mapIntroRow(intro) : undefined;

  return {
    id: String(founder.id),
    name: String(founder.name),
    role: stringValue(founder.role) ?? "Founder",
    photoUrl: stringValue(imagePaths.photo),
    company: {
      id: companyId,
      name: stringValue(company?.name) ?? "Unknown company",
      batch: stringValue(company?.batch) ?? "W26",
      stage: displayStage(stringValue(company?.stage)),
      category: displayCategory(company),
      oneLiner: stringValue(company?.one_liner) ?? "Building a YC company.",
      website: stringValue(company?.website),
      ycUrl: stringValue(company?.yc_url)
    },
    contactRoutes: contactRoutesForRows({
      companySocialLinks,
      founderSocialLinks: socialLinks,
      website: stringValue(company?.website),
      ycUrl: stringValue(company?.yc_url)
    }),
    location: stringValue(founder.location) ?? "Event attendee",
    ask: askFor(company, need),
    need: listNeedFor(need, company),
    introCount: mappedIntro && !mappedIntro.sameCompany ? 1 : 0,
    cautionCount: mappedIntro?.caution ? 1 : 0,
    intro: mappedIntro,
    notes: notes.map(mapNoteRow)
  };
}

function mapIntroRow(row: Row): EventPrepIntro {
  return {
    targetFounderId: String(row.to_founder_id),
    fitLabel: fitLabelValue(row.fit_label),
    reason: String(row.reason),
    opener: stringValue(row.opener) ?? "",
    caution: stringValue(row.caution),
    evidence: evidenceLabels(row.evidence),
    sameCompany: row.same_company === true
  };
}

function withIntroRoutes(founders: EventPrepFounder[], pool: EventPrepFounder[] = founders) {
  const foundersById = new Map(pool.map((founder) => [founder.id, founder]));

  return founders.map((founder) => {
    if (!founder.intro) return founder;
    const target = foundersById.get(founder.intro.targetFounderId);
    if (!target) return founder;

    return {
      ...founder,
      intro: {
        ...founder.intro,
        route: introRouteFor({
          fromName: founder.name,
          targetCompanyName: target.company.name,
          targetContactRoutes: target.contactRoutes ?? [],
          targetName: target.name
        }, Boolean(founder.intro.sameCompany))
      }
    };
  });
}

function withGeneratedIntros(founders: EventPrepFounder[], pool: EventPrepFounder[] = founders) {
  const poolById = new Map(pool.map((founder) => [founder.id, founder]));
  const matchingPool = pool.map(toMatchingFounder);

  return withIntroRoutes(founders.map((founder) => {
    if (founder.intro) return founder;
    const suggestion = suggestIntrosForFounder(founder.id, matchingPool, {
      max_suggestions_per_founder: 1,
      include_same_company_context: true
    }).find((item) => item.fit_label !== "check" || item.caution?.toLowerCase().includes("same company"));
    const target = suggestion ? poolById.get(suggestion.to_founder_id) : undefined;
    if (!suggestion || !target) return founder;
    const sameCompany = target.company.id === founder.company.id;

    return {
      ...founder,
      intro: introFromSuggestion(suggestion, sameCompany),
      introCount: sameCompany ? founder.introCount : Math.max(founder.introCount, 1),
      cautionCount: suggestion.caution ? Math.max(founder.cautionCount, 1) : founder.cautionCount
    };
  }), pool);
}

function introFromSuggestion(suggestion: IntroSuggestion, sameCompany: boolean): EventPrepIntro {
  return {
    targetFounderId: suggestion.to_founder_id,
    fitLabel: suggestion.fit_label,
    reason: suggestion.reason,
    opener: suggestion.opener,
    caution: stringValue(suggestion.caution),
    evidence: evidenceLabels(suggestion.evidence),
    sameCompany
  };
}

function toMatchingFounder(founder: EventPrepFounder): FounderForMatching {
  return {
    id: founder.id,
    name: founder.name,
    company_id: founder.company.id,
    company_name: founder.company.name,
    role: founder.role,
    location: founder.location,
    batch: founder.company.batch,
    stage: founder.company.stage,
    category: founder.company.category,
    one_liner: founder.company.oneLiner,
    website: founder.company.website,
    yc_url: founder.company.ycUrl,
    need_text: founder.ask,
    ask: founder.need,
    tags: [founder.company.category, founder.company.stage].filter(Boolean)
  };
}

function contactRoutesForRows(input: {
  companySocialLinks: Row;
  founderSocialLinks: Row;
  website?: string;
  ycUrl?: string;
}) {
  return publicContactRoutesFor({
    companyLinkedin: stringValue(input.companySocialLinks.linkedin),
    github: stringValue(input.companySocialLinks.github),
    linkedin: stringValue(input.founderSocialLinks.linkedin),
    twitter: stringValue(input.founderSocialLinks.twitter) ?? stringValue(input.companySocialLinks.twitter),
    website: input.website,
    ycCompanyUrl: stringValue(input.founderSocialLinks.yc_company),
    ycUrl: input.ycUrl
  });
}

function mapNoteRow(row: Row): EventPrepNote {
  return {
    id: String(row.id),
    type: toEventNoteType(stringValue(row.note_type)),
    body: String(row.body),
    source: stringValue(row.source_kind),
    createdAt: stringValue(row.created_at)
  };
}

function compareAttendanceRows(left: Row, right: Row) {
  const leftIndex = numberValue(objectValue(left.metadata).seed_index) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = numberValue(objectValue(right.metadata).seed_index) ?? Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;

  return String(left.founder_id).localeCompare(String(right.founder_id));
}

function groupRowsBy(rows: Row[], column: string) {
  const grouped = new Map<string, Row[]>();

  for (const row of rows) {
    const key = stringValue(row[column]);
    if (!key) continue;
    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }

  return grouped;
}

function askFor(company: Row | undefined, need: Row | undefined): string {
  const needText = stringValue(need?.need_text);
  const longDescription = stringValue(company?.long_description);
  const oneLiner = stringValue(company?.one_liner);

  if (needText) return needText;
  if (longDescription) return trimTo(cleanText(longDescription), 220);
  if (oneLiner) return `Meet founders who can compare notes on ${oneLiner.toLowerCase()}.`;
  return "Meet founders with adjacent customer, hiring, fundraising, or product context.";
}

function listNeedFor(need: Row | undefined, company: Row | undefined): string {
  const rawNeed = stringValue(need?.need_text) ?? stringValue(company?.one_liner) ?? "adjacent founder context";
  return `Need: ${trimTo(cleanText(rawNeed), 120)}`;
}

function displayStage(stage?: string): string {
  if (!stage || stage.toLowerCase() === "early") return "Seed";
  return stage;
}

function displayCategory(company?: Row): string {
  const category = stringValue(company?.category) ?? stringValue(company?.subindustry) ?? stringValue(company?.industry);
  if (!category) return "Founder";
  if (/ai/i.test(category) && /infra|developer|model|agent/i.test(`${category} ${stringValue(company?.one_liner) ?? ""}`)) {
    return "AI infra";
  }
  return category;
}

function sourceLabel(sourceKind?: string): string {
  return sourceKind ? sourceKind.replaceAll("_", " ") : "public YC seed";
}

function formatEventTime(value?: string): string {
  if (!value) return "7pm";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles"
  }).format(date);
}

function dateMs(value?: string) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function toEventNoteType(type?: string): NoteType {
  if (type === "office_hours") return "Office hours";
  if (type === "other_founder") return "Founder note";
  if (type === "room") return "Room note";
  return "Local note";
}

function fitLabelValue(value: unknown): FitLabel {
  if (value === "strong" || value === "good" || value === "check") return value;
  return "check";
}

function evidenceLabels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "label" in item) return String((item as { label: unknown }).label);
      return "";
    })
    .filter(Boolean);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimTo(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trim()}...`;
}
