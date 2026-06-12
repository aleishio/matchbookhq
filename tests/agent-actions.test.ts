import assert from "node:assert/strict";
import test from "node:test";

import {
  createLumaGuestsForAgent,
  type AgentGuestRequestRecord
} from "../app/lib/agent-actions.ts";
import { POST as postLumaGuestsAction } from "../app/api/agent/actions/luma-guests/route.ts";
import type { LoadedLumaEvent } from "../app/lib/event-approvals-types.ts";
import { withAgentEnv, withTestEnv } from "./helpers/env.ts";
import { bearerHeaders, jsonPostRequest } from "./helpers/requests.ts";

test("agent event guest action previews when execute is false", async () => {
  const result = await createLumaGuestsForAgent(
    {
      eventId: "evt-agent-test",
      execute: false,
      guests: [
        {
          email: "Founder@Example.com",
          name: "Example Founder"
        }
      ]
    }
  );

  assert.equal(result.action, "event_guests.add");
  assert.equal(result.mode, "dry_run");
  assert.equal(result.dryRun, true);
  assert.equal(result.event.guestAdds, "dry_run_only");
  assert.equal(result.event.kind, "real");
  assert.equal(result.sendEmail, false);
  assert.equal(result.guests[0].emailDomain, "example.com");
  assert.equal("lumaEventId" in result.event, false);
  assert.equal(result.request.status, "dry_run");
  assert.equal(result.request.storage, "not_configured");
});

test("agent event guest action records previews for demo YC OS events", async () => {
  const records: AgentGuestRequestRecord[] = [];
  const events: LoadedLumaEvent[] = [
    {
      applicationCount: 3,
      id: "yc-demo-event",
      location: "San Francisco",
      seats: 10,
      source: "Lu.ma",
      startsAt: "Today",
      syncedAt: "fixture",
      title: "YC Demo Event"
    }
  ];

  const result = await createLumaGuestsForAgent(
    {
      eventId: "yc-demo-event",
      execute: false,
      guests: [{ email: "operator@example.com" }]
    },
    {
      events,
      guestRequestStore: {
        async createGuestRequest(record) {
          records.push(record);
          return {
            id: "agent_guest_request_db_1",
            storage: "database"
          };
        }
      }
    }
  );

  assert.equal(result.action, "event_guests.add");
  assert.equal(result.mode, "dry_run");
  assert.equal(result.event.guestAdds, "dry_run_only");
  assert.equal(result.event.kind, "demo");
  assert.equal("lumaEventId" in result.event, false);
  assert.equal(result.request.id, "agent_guest_request_db_1");
  assert.equal(result.request.status, "dry_run");
  assert.equal(result.request.storage, "database");
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "dry_run");
  assert.equal(records[0].event.lumaEventId, null);
});

test("agent event guest action records and queues resolved real events", async () => {
  const records: AgentGuestRequestRecord[] = [];
  const events: LoadedLumaEvent[] = [
    {
      applicationCount: 3,
      id: "yc-test-event",
      lumaApiId: "evt-resolved",
      location: "San Francisco",
      seats: 10,
      source: "Lu.ma",
      startsAt: "Today",
      syncedAt: "now",
      title: "YC Test Event"
    }
  ];

  const result = await createLumaGuestsForAgent(
    {
      approvalStatus: "waitlist",
      eventId: "yc-test-event",
      guests: [
        {
          email: "founder@example.com",
          phone_number: "+14155550123"
        }
      ],
      reason: "YC partner confirmed this guest should be added",
      sendEmail: true
    },
    {
      events,
      guestRequestStore: {
        async createGuestRequest(record) {
          records.push(record);
          return {
            id: "agent_guest_request_db_2",
            storage: "database"
          };
        }
      }
    }
  );

  assert.equal(result.action, "event_guests.add");
  assert.equal(result.mode, "queued");
  assert.equal(result.dryRun, false);
  assert.equal(result.event.guestAdds, "available");
  assert.equal(result.event.kind, "real");
  assert.equal("lumaEventId" in result.event, false);
  assert.equal(result.request.id, "agent_guest_request_db_2");
  assert.equal(result.request.status, "pending");
  assert.equal(result.request.storage, "database");
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "pending");
  assert.equal(records[0].approvalStatus, "waitlist");
  assert.equal(records[0].event.lumaEventId, "evt-resolved");
  assert.equal(records[0].sendEmail, true);
});

test("agent event guest action can queue a direct provider id only when it is synced internally", async () => {
  const events: LoadedLumaEvent[] = [
    {
      applicationCount: 3,
      id: "yc-test-event",
      lumaApiId: "evt-resolved",
      location: "San Francisco",
      seats: 10,
      source: "Lu.ma",
      startsAt: "Today",
      syncedAt: "now",
      title: "YC Test Event"
    }
  ];

  const result = await createLumaGuestsForAgent(
    {
      eventId: "evt-resolved",
      guests: [{ email: "founder@example.com" }],
      reason: "YC partner confirmed this guest should be added"
    },
    { events }
  );

  assert.equal(result.mode, "queued");
  assert.equal(result.event.id, "yc-test-event");
  assert.equal(result.event.guestAdds, "available");
  assert.equal(result.event.kind, "real");
  assert.equal("lumaEventId" in result.event, false);
});

test("agent event guest action records and rejects dry-run-only events during execution", async () => {
  const records: AgentGuestRequestRecord[] = [];
  const events: LoadedLumaEvent[] = [
    {
      applicationCount: 3,
      id: "yc-demo-event",
      location: "San Francisco",
      seats: 10,
      source: "Lu.ma",
      startsAt: "Today",
      syncedAt: "fixture",
      title: "YC Demo Event"
    }
  ];

  await assert.rejects(
    () => createLumaGuestsForAgent(
      {
        eventId: "yc-demo-event",
        guests: [{ email: "founder@example.com" }],
        reason: "YC partner confirmed this guest should be added"
      },
      {
        events,
        guestRequestStore: {
          async createGuestRequest(record) {
            records.push(record);
            return {
              id: "agent_guest_request_db_blocked",
              storage: "database"
            };
          }
        }
      }
    ),
    /dry-run-only/
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "blocked");
  assert.equal(records[0].event.kind, "demo");
});

test("agent event guest action rejects unsynced direct provider ids during execution", async () => {
  await assert.rejects(
    () => createLumaGuestsForAgent(
      {
        eventId: "evt-unsynced",
        execute: true,
        guests: [{ email: "founder@example.com" }],
        reason: "YC partner confirmed this guest should be added"
      },
      { events: [] }
    ),
    /No approval event found/
  );
});

test("agent event guest action requires a reason before execution", async () => {
  await assert.rejects(
    () => createLumaGuestsForAgent({
      eventId: "evt-agent-test",
      guests: [{ email: "founder@example.com" }]
    }),
    /reason/
  );
});

test("agent event guest previews are disabled in production", async () => {
  const env = withTestEnv({ APP_ENV: "production" });

  try {
    await assert.rejects(
      () => createLumaGuestsForAgent({
        eventId: "evt-agent-test",
        execute: false,
        guests: [{ email: "founder@example.com" }]
      }),
      /do not accept execute=false/
    );
  } finally {
    env.restore();
  }
});

test("agent event guest action route requires bearer auth and supports explicit preview", async () => {
  const env = withAgentEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token"
  }, { localEventApprovals: true });

  try {
    const denied = await postLumaGuestsAction(jsonPostRequest("/api/agent/actions/luma-guests", {
      eventId: "evt-agent-test",
      execute: false,
      guests: [{ email: "founder@example.com" }]
    }));
    assert.equal(denied.status, 401);

    const response = await postLumaGuestsAction(jsonPostRequest("/api/agent/actions/luma-guests", {
      eventId: "evt-agent-test",
      execute: false,
      guests: [{ email: "founder@example.com" }]
    }, {
      headers: bearerHeaders()
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.result.mode, "dry_run");
    assert.equal(body.result.requestedCount, 1);
    assert.equal(body.result.event.kind, "real");
    assert.equal(body.result.event.guestAdds, "dry_run_only");
    assert.equal("lumaEventId" in body.result.event, false);
    assert.equal(body.result.request.status, "dry_run");
  } finally {
    env.restore();
  }
});
