import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalStatusFor,
  firstCalendarId,
  syncLumaApprovals,
  type LumaSyncStore,
  type UpsertLumaApplicationInput,
  type UpsertLumaEventInput
} from "../app/lib/luma/sync.ts";

test("syncs Lu.ma events and guests into the durable store with request pacing", async () => {
  const delays: number[] = [];
  const events: UpsertLumaEventInput[] = [];
  const applications: UpsertLumaApplicationInput[] = [];
  const accounts: Array<{ providerAccountId: string; displayName?: string; metadata?: Record<string, unknown> }> = [];
  const store: LumaSyncStore = {
    async upsertExternalAccount(input) {
      accounts.push(input);
      return { id: "account-1" };
    },
    async upsertLumaEvent(input) {
      events.push(input);
      return { id: "db-event-1", lumaEventId: input.lumaEventId };
    },
    async listApplicationsForEvent() {
      return [];
    },
    async upsertLumaApplications(rows) {
      applications.push(...rows);
    }
  };
  const lumaClient = {
    async listCalendarEvents() {
      return {
        entries: [{
          id: "event-internal",
          api_id: "evt-api-1",
          calendar_id: "cal-single",
          name: "Founder Office Hours",
          start_at: "2026-06-20T10:00:00.000Z",
          url: "https://lu.ma/test"
        }],
        next_cursor: null
      };
    },
    async listEventGuests() {
      return {
        entries: [{
          id: "guest-internal",
          api_id: "guest-api-1",
          user_email: "founder@example.com",
          user_name: "Ada Founder",
          user_avatar_url: "https://images.example.com/ada.jpg",
          phone_number: "+15555550123",
          approval_status: "pending_approval" as const,
          registered_at: "2026-06-10T12:00:00.000Z",
          registration_answers: [{ label: "Company", answer: "Example AI" }]
        }],
        next_cursor: null
      };
    }
  };

  const summary = await syncLumaApprovals({
    lumaClient,
    store,
    options: {
      requestSpacingMs: 125,
      sleepFn: async (milliseconds) => {
        delays.push(milliseconds);
      },
      now: () => new Date("2026-06-09T00:00:00.000Z")
    }
  });

  assert.equal(summary.status, "completed");
  assert.equal(summary.eventsSynced, 1);
  assert.equal(summary.applicationsSynced, 1);
  assert.equal(accounts[0].providerAccountId, "cal-single");
  assert.equal(accounts[0].displayName, "Lu.ma calendar cal-single");
  assert.equal(events[0].lumaEventId, "evt-api-1");
  assert.equal(events[0].calendarId, "cal-single");
  assert.equal(applications[0].lumaGuestId, "guest-api-1");
  assert.equal(applications[0].approvalStatus, "manual");
  assert.equal(applications[0].lumaFields.guest_api_id, "guest-api-1");
  assert.equal(applications[0].lumaFields.guest_unique_id, "guest-api-1");
  assert.equal(applications[0].lumaFields.photo_url, "https://images.example.com/ada.jpg");
  assert.equal((applications[0].lumaFields.registration_answers as Record<string, unknown>)["Company"], "Example AI");
  assert.deepEqual(delays, [125]);
});

test("infers a single Lu.ma calendar id from event payloads", () => {
  assert.equal(firstCalendarId([
    {
      id: "event-internal",
      calendar_id: "cal-from-internal",
      name: "Founder Office Hours"
    }
  ]), "cal-from-internal");
  assert.equal(firstCalendarId([
    {
      id: "event-internal",
      calendar_api_id: "cal-from-api",
      calendar_id: "cal-from-internal",
      name: "Founder Office Hours"
    }
  ]), "cal-from-api");
  assert.equal(firstCalendarId([]), undefined);
});

test("groups multiple Lu.ma calendars by event payload without extra env", async () => {
  const accounts: Array<{ providerAccountId: string; displayName?: string; metadata?: Record<string, unknown> }> = [];
  const events: UpsertLumaEventInput[] = [];
  const store: LumaSyncStore = {
    async upsertExternalAccount(input) {
      accounts.push(input);
      return { id: `account-${input.providerAccountId}` };
    },
    async upsertLumaEvent(input) {
      events.push(input);
      return { id: `db-${input.lumaEventId}`, lumaEventId: input.lumaEventId };
    },
    async listApplicationsForEvent() {
      return [];
    },
    async upsertLumaApplications() {}
  };
  const lumaClient = {
    async listCalendarEvents() {
      return {
        entries: [
          {
            id: "event-1",
            api_id: "evt-1",
            calendar_id: "cal-one",
            name: "Calendar One Event"
          },
          {
            id: "event-2",
            api_id: "evt-2",
            calendar_id: "cal-two",
            name: "Calendar Two Event"
          }
        ],
        next_cursor: null
      };
    },
    async listEventGuests() {
      return { entries: [], next_cursor: null };
    }
  };

  const summary = await syncLumaApprovals({
    lumaClient,
    store,
    options: {
      requestSpacingMs: 0
    }
  });

  assert.equal(summary.status, "completed");
  assert.equal(summary.externalAccountId, "multiple");
  assert.deepEqual(accounts.map((account) => account.providerAccountId), ["cal-one", "cal-two"]);
  assert.deepEqual(events.map((event) => ({
    externalAccountId: event.externalAccountId,
    calendarId: event.calendarId,
    lumaEventId: event.lumaEventId
  })), [
    {
      externalAccountId: "account-cal-one",
      calendarId: "cal-one",
      lumaEventId: "evt-1"
    },
    {
      externalAccountId: "account-cal-two",
      calendarId: "cal-two",
      lumaEventId: "evt-2"
    }
  ]);
});

test("sync preserves a local approved decision while Lu.ma is still pending", () => {
  assert.equal(approvalStatusFor("pending_approval", "approved"), "approved");
  assert.equal(approvalStatusFor("declined", "approved"), "rejected");
});
