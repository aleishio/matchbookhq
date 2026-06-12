import assert from "node:assert/strict";
import test from "node:test";

import {
  sortApprovalEventsForDisplay,
  sortEventPrepSummariesForDisplay
} from "../app/lib/event-directory.ts";
import type { LoadedLumaEvent } from "../app/lib/event-approvals-types.ts";
import type { EventPrepEvent } from "../app/lib/event-prep-data.ts";

test("defaults event selectors to the AI Infra event before other approval events", () => {
  const events: LoadedLumaEvent[] = [
    approvalEvent({
      id: "yc-founder-mixer",
      title: "YC Founder Mixer",
      seedId: "yc-founder-mixer"
    }),
    approvalEvent({
      id: "founder-coffee",
      title: "Founder Coffee",
      lumaApiId: "evt-founderCoffee",
      url: "https://luma.com/founder-coffee"
    }),
    approvalEvent({
      id: "dogpatch-founder-breakfast",
      title: "Dogpatch Founder Breakfast",
      lumaApiId: "evt-YQNWbKPIleIwPzW",
      url: "https://luma.com/dogpatch-founder-breakfast-0623"
    }),
    approvalEvent({
      id: "ai-infra-office-hours",
      title: "AI Infra Office Hours in SF",
      seedId: "ai-infra-office-hours",
      url: "https://luma.com/ai-infra-office-hours"
    })
  ];

  assert.deepEqual(
    sortApprovalEventsForDisplay(events).map((event) => event.id),
    ["ai-infra-office-hours", "dogpatch-founder-breakfast", "founder-coffee", "yc-founder-mixer"]
  );
});

test("defaults event selectors to the AI Infra event before other prep events", () => {
  const events: EventPrepEvent[] = [
    prepEvent({
      id: "yc-w26-event-prep",
      title: "YC Winter 2026 Event Prep",
      mode: "example"
    }),
    prepEvent({
      id: "founder-coffee",
      title: "Founder Coffee",
      mode: "live",
      sourceUrl: "https://luma.com/founder-coffee"
    }),
    prepEvent({
      id: "dogpatch-founder-breakfast",
      title: "Dogpatch Founder Breakfast",
      location: "Dogpatch, San Francisco",
      mode: "live",
      sourceUrl: "https://luma.com/dogpatch-founder-breakfast-0623"
    }),
    prepEvent({
      id: "ai-infra-office-hours",
      title: "AI Infra Office Hours in SF",
      mode: "example",
      sourceUrl: "https://luma.com/ai-infra-office-hours"
    })
  ];

  assert.deepEqual(
    sortEventPrepSummariesForDisplay(events).map((event) => event.id),
    ["ai-infra-office-hours", "dogpatch-founder-breakfast", "founder-coffee", "yc-w26-event-prep"]
  );
});

function approvalEvent(overrides: Partial<LoadedLumaEvent>): LoadedLumaEvent {
  return {
    id: "event",
    title: "Event",
    startsAt: "2026-06-23T17:00:00.000Z",
    location: "San Francisco",
    seats: 0,
    applicationCount: 0,
    source: "Lu.ma",
    syncedAt: "now",
    ...overrides
  };
}

function prepEvent(overrides: Partial<EventPrepEvent>): EventPrepEvent {
  return {
    id: "event",
    title: "Event",
    location: "San Francisco",
    startsAt: "10:00 AM",
    attendeeCount: 0,
    source: "Lu.ma",
    ...overrides
  };
}
