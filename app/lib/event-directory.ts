import type { EventPrepEvent } from "./event-prep-data";
import type { LoadedLumaEvent } from "./event-approvals-types";

export const APPROVAL_TO_PREP_EVENT_ALIASES: Record<string, string> = {
  "yc-founder-mixer": "w26-founder-mixer-example",
  "ai-infra-office-hours": "w26-founder-mixer-example",
  "founder-dinner": "w26-founder-mixer-example"
};

export function eventPrepSummaryFromApprovalEvent(
  event: LoadedLumaEvent,
  options: {
    attendeeCount?: number;
    mode?: EventPrepEvent["mode"];
    sourceUrl?: string;
  } = {}
): EventPrepEvent {
  return {
    id: event.id,
    title: event.title,
    location: event.location,
    startsAt: event.startsAt,
    attendeeCount: options.attendeeCount ?? event.applicationCount,
    source: event.source,
    sourceUrl: options.sourceUrl ?? event.url,
    mode: options.mode ?? approvalEventMode(event)
  };
}

export function mergeEventPrepSummaries(
  primary: EventPrepEvent[],
  fallback: EventPrepEvent[]
) {
  const seen = new Set<string>();
  const merged: EventPrepEvent[] = [];

  for (const event of [...primary, ...fallback]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    merged.push(event);
  }

  return merged;
}

export function sortApprovalEventsForDisplay(events: LoadedLumaEvent[]) {
  return stableSortByEventRank(events, approvalEventMode);
}

export function sortEventPrepSummariesForDisplay(events: EventPrepEvent[]) {
  return stableSortByEventRank(events, (event) => event.mode);
}

export function approvalEventLookupKeys(event: LoadedLumaEvent) {
  return [
    event.seedId,
    event.lumaApiId,
    event.id,
    event.url
  ].filter((value): value is string => Boolean(value));
}

export function aliasedPrepEventIdForApprovalEvent(event: LoadedLumaEvent) {
  for (const key of approvalEventLookupKeys(event)) {
    const alias = APPROVAL_TO_PREP_EVENT_ALIASES[key];
    if (alias) return alias;
  }

  return undefined;
}

function approvalEventMode(event: LoadedLumaEvent): EventPrepEvent["mode"] {
  if (event.lumaApiId?.startsWith("evt")) return "live";
  if (event.seedId && !event.lumaApiId) return "example";
  if (event.url) return "live";
  return "example";
}

function stableSortByEventRank<T>(
  events: T[],
  modeForEvent: (event: T) => EventPrepEvent["mode"] | undefined
) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const rankDelta = eventDefaultRank(left.event, modeForEvent) - eventDefaultRank(right.event, modeForEvent);
      return rankDelta || left.index - right.index;
    })
    .map(({ event }) => event);
}

function eventDefaultRank<T>(
  event: T,
  modeForEvent: (event: T) => EventPrepEvent["mode"] | undefined
) {
  const mode = modeForEvent(event);
  if (isAiInfraEvent(event)) return 0;
  if (mode === "live" && isDogpatchEvent(event)) return 1;
  if (mode === "live") return 2;
  if (mode === "example") return 3;
  return 4;
}

function isAiInfraEvent(event: unknown) {
  if (!event || typeof event !== "object") return false;
  const record = event as Record<string, unknown>;
  const text = eventSearchText(record);

  return text.includes("ai-infra") || text.includes("ai infra");
}

function isDogpatchEvent(event: unknown) {
  if (!event || typeof event !== "object") return false;
  const record = event as Record<string, unknown>;
  const text = eventSearchText(record);

  return text.includes("dogpatch");
}

function eventSearchText(record: Record<string, unknown>) {
  const text = [
    record.id,
    record.title,
    record.location,
    record.url,
    record.sourceUrl
  ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  return text;
}
