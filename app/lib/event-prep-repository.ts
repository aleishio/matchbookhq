import {
  getEventPrepData,
  getEventPrepDataForEvent,
  MAX_EVENT_PREP_DEMO_FOUNDERS,
  type EventPrepData,
  type EventPrepFounder
} from "./event-prep-data";
import {
  eventPrepSummaryFromApprovalEvent,
  mergeEventPrepSummaries,
  sortEventPrepSummariesForDisplay
} from "./event-directory";
import { listApprovalEvents } from "./event-approvals-repository";

export type EventPrepLens = "all" | "intro" | "caution" | "ai";

export type EventPrepQuery = {
  eventId?: string;
  lens?: EventPrepLens;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type EventPrepCounts = Record<EventPrepLens, number>;
export type EventPrepEventSummary = EventPrepData["event"];

export type EventPrepListResponse = {
  event: EventPrepData["event"];
  founders: EventPrepFounder[];
  relatedFounders: EventPrepFounder[];
  total: number;
  page: number;
  pageSize: number;
  counts: EventPrepCounts;
  query: Required<EventPrepQuery>;
};

export class EventPrepRepositoryError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "EventPrepRepositoryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function listEventPrepEvents(): Promise<EventPrepEventSummary[]> {
  if (useSupabaseEventPrep()) {
    const repository = await import("./event-prep-supabase-repository");
    return repository.listEventPrepEventsFromSupabase();
  }

  const [data, approvalEvents] = await Promise.all([
    getEventPrepData(),
    listApprovalEvents().catch(() => [])
  ]);

  const approvalPrepEvents = approvalEvents.map((event) => {
    const summary = eventPrepSummaryFromApprovalEvent(event);
    const attendeeCount = summary.id === data.event.id
      ? data.founders.length
      : eventPrepSummaryCount(summary);

    return {
      ...summary,
      attendeeCount
    };
  });

  return sortEventPrepSummariesForDisplay(mergeEventPrepSummaries(approvalPrepEvents, [data.event]));
}

export async function listEventPrepFounders(
  query: EventPrepQuery = {}
): Promise<EventPrepListResponse> {
  if (useSupabaseEventPrep()) {
    const repository = await import("./event-prep-supabase-repository");
    return repository.listEventPrepFoundersFromSupabase(query);
  }

  const defaultData = await getEventPrepData();
  const events = await listEventPrepEvents();
  const selectedEventId = query.eventId?.trim() || events[0]?.id;
  const selectedEvent = events.find((event) => event.id === selectedEventId);

  if (!selectedEvent) {
    throw new EventPrepRepositoryError(
      "event_not_found",
      `No event prep event found for ${selectedEventId ?? "default event"}.`,
      404
    );
  }

  const data = selectedEvent.id === defaultData.event.id
    ? defaultData
    : await getEventPrepDataForEvent(selectedEvent);
  const normalized = normalizeEventPrepQuery(query, selectedEvent.id);

  if (normalized.eventId !== selectedEvent.id) {
    throw new EventPrepRepositoryError(
      "event_not_found",
      `No event prep event found for ${normalized.eventId}.`,
      404
    );
  }

  return buildEventPrepListResponse(data.event, data.founders, normalized);
}

export function buildEventPrepListResponse(
  event: EventPrepData["event"],
  founders: EventPrepFounder[],
  query: Required<EventPrepQuery>
): EventPrepListResponse {
  const filtered = filterEventPrepFounders(founders, query.lens, query.search);
  const pageStart = (query.page - 1) * query.pageSize;
  const pageFounders = filtered.slice(pageStart, pageStart + query.pageSize);
  const relatedFounders = relatedFoundersFor(pageFounders, founders);

  return {
    event,
    founders: stripUndefinedValues(pageFounders),
    relatedFounders: stripUndefinedValues(relatedFounders),
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
    counts: eventPrepCountsFor(founders),
    query
  };
}

export function normalizeEventPrepQuery(
  query: EventPrepQuery,
  defaultEventId: string
): Required<EventPrepQuery> {
  return {
    eventId: query.eventId?.trim() || defaultEventId,
    lens: normalizeEventPrepLens(query.lens, "all"),
    search: query.search?.trim() ?? "",
    page: boundedEventPrepInteger(query.page, 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: boundedEventPrepInteger(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  };
}

export function normalizeEventPrepLens(
  value?: string | null,
  fallback: EventPrepLens = "all"
): EventPrepLens {
  if (!value) return fallback;
  if (value === "all" || value === "intro" || value === "caution" || value === "ai") return value;
  throw new EventPrepRepositoryError("invalid_lens", `Unsupported event prep lens: ${value}.`);
}

export function boundedEventPrepInteger(
  value: string | number | null | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function filterEventPrepFounders(
  founders: EventPrepFounder[],
  lens: EventPrepLens,
  search: string
) {
  const normalizedSearch = search.trim().toLowerCase();

  return founders.filter((founder) => {
    if (lens === "intro" && founder.introCount < 1) return false;
    if (lens === "caution" && founder.cautionCount < 1) return false;
    if (lens === "ai" && !isAiFounder(founder)) return false;

    if (!normalizedSearch) return true;

    return matchesFounderSearch(founderSearchText(founder), normalizedSearch);
  });
}

export function eventPrepCountsFor(founders: EventPrepFounder[]): EventPrepCounts {
  return {
    all: founders.length,
    intro: founders.filter((founder) => founder.introCount > 0).length,
    caution: founders.filter((founder) => founder.cautionCount > 0).length,
    ai: founders.filter(isAiFounder).length
  };
}

export function relatedFoundersFor(
  founders: EventPrepFounder[],
  allFounders: EventPrepFounder[]
) {
  const visibleIds = new Set(founders.map((founder) => founder.id));
  const targetIds = new Set(
    founders
      .map((founder) => founder.intro?.targetFounderId)
      .filter((id): id is string => typeof id === "string" && !visibleIds.has(id))
  );
  const foundersById = new Map(allFounders.map((founder) => [founder.id, founder]));

  return [...targetIds]
    .map((id) => foundersById.get(id))
    .filter((founder): founder is EventPrepFounder => Boolean(founder));
}

function founderSearchText(founder: EventPrepFounder) {
  return [
    founder.name,
    founder.company.name,
    founder.company.stage,
    founder.company.category,
    founder.company.oneLiner,
    founder.location,
    founder.ask,
    founder.need
  ].join(" ").toLowerCase();
}

function matchesFounderSearch(searchText: string, normalizedSearch: string) {
  if (searchText.includes(normalizedSearch)) return true;

  const terms = normalizedSearch.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  return terms.every((term) => searchTermAliases(term).some((alias) => searchText.includes(alias)));
}

function searchTermAliases(term: string) {
  if (term === "ai") return ["ai", "agent", "agentic", "model", "llm"];
  if (term === "infrastructure") return ["infrastructure", "infra"];
  if (term === "infra") return ["infra", "infrastructure"];
  if (term === "artificial") return ["artificial", "ai"];
  if (term === "intelligence") return ["intelligence", "ai"];
  return [term];
}

function isAiFounder(founder: EventPrepFounder) {
  const text = `${founder.company.category} ${founder.company.oneLiner}`.toLowerCase();
  return text.includes("ai") || text.includes("model") || text.includes("agent") || text.includes("infra");
}

function eventPrepSummaryCount(event: EventPrepEventSummary) {
  if (event.mode === "example") return MAX_EVENT_PREP_DEMO_FOUNDERS;
  return event.attendeeCount;
}

function useSupabaseEventPrep() {
  return process.env.EVENT_PREP_DATA_SOURCE === "supabase";
}

function stripUndefinedValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedValues) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedValues(item)])
    ) as T;
  }

  return value;
}
