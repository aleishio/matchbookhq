import assert from "node:assert/strict";
import test from "node:test";

import {
  addEventAttendeesForAgent,
  createEventForAgent,
  createSupabaseAgentEventStoreFromEnv,
  enrichEventContextForAgent,
  type AgentAddEventAttendeesRecord,
  type AgentCreateEventRecord,
  type AgentEnrichEventContextRecord
} from "../app/lib/agent-event-actions.ts";
import { withTestEnv } from "./helpers/env.ts";

test("agent event creation previews when execute is false", async () => {
  const result = await createEventForAgent({
    capacity: 50,
    execute: false,
    location: "San Francisco",
    startsAt: "2026-06-30T18:00:00Z",
    title: "YC Agent Test Event"
  });

  assert.equal(result.action, "events.create");
  assert.equal(result.mode, "dry_run");
  assert.equal(result.dryRun, true);
  assert.equal(result.event.title, "YC Agent Test Event");
  assert.equal(result.event.providerSync, "yc_os_runtime");
  assert.equal(result.event.source, "yc_os");
  assert.equal(result.event.capacity, 50);
  assert.equal(result.request.status, "dry_run");
  assert.equal(result.request.storage, "not_configured");
});

test("agent event creation stores YC OS events by default with reason", async () => {
  const records: AgentCreateEventRecord[] = [];
  const result = await createEventForAgent(
    {
      actorName: "YC Operator",
      capacity: 25,
      description: "Invite-only test event",
      location: "Dogpatch",
      reason: "YC partner asked the agent to create the test event",
      title: "YC Backend-Owned Event",
      url: "https://events.example.com/test"
    },
    {
      eventStore: {
        async createEvent(record) {
          records.push(record);
          return {
            id: "yc-agent-event-db-1",
            storage: "database"
          };
        }
      }
    }
  );

  assert.equal(result.action, "events.create");
  assert.equal(result.mode, "created");
  assert.equal(result.dryRun, false);
  assert.equal(result.request.id, "agent_event_request_yc-agent-event-db-1");
  assert.equal(result.request.status, "created");
  assert.equal(result.request.storage, "database");
  assert.equal(records.length, 1);
  assert.equal(records[0].event.providerSync, "yc_os_runtime");
  assert.equal(records[0].event.description, "Invite-only test event");
  assert.equal(records[0].status, "created");
});

test("agent event creation requires a reason before execution", async () => {
  await assert.rejects(
    () => createEventForAgent({
      title: "YC Event Without Reason"
    }),
    /requires a short reason/
  );
});

test("agent event write previews are disabled in production", async () => {
  const env = withTestEnv({ APP_ENV: "production" });

  try {
    await assert.rejects(
      () => createEventForAgent({
        execute: false,
        title: "YC Event Preview"
      }),
      /do not accept execute=false/
    );
  } finally {
    env.restore();
  }
});

test("agent event attendees preview uses YC source ids only", async () => {
  const result = await addEventAttendeesForAgent({
    attendees: [
      {
        companyId: "company_1",
        founderId: "founder_1"
      }
    ],
    execute: false,
    eventId: "yc-agent-event-1"
  });

  assert.equal(result.action, "event_attendees.add");
  assert.equal(result.mode, "dry_run");
  assert.equal(result.dryRun, true);
  assert.equal(result.checks.ycSourcesOnly, true);
  assert.equal(result.attendees[0].founderId, "founder_1");
  assert.equal(result.attendees[0].status, "expected");
});

test("agent event attendees execute through YC OS storage", async () => {
  const records: AgentAddEventAttendeesRecord[] = [];
  const result = await addEventAttendeesForAgent(
    {
      attendees: [
        {
          companyId: "company_1",
          founderId: "founder_1",
          status: "registered"
        }
      ],
      eventId: "yc-agent-event-1",
      reason: "YC operator confirmed this founder should be added to the event"
    },
    {
      eventStore: {
        async addEventAttendees(record) {
          records.push(record);
          return {
            id: "yc-agent-event-1-attendees",
            storage: "database"
          };
        },
        async createEvent() {
          throw new Error("not used");
        }
      }
    }
  );

  assert.equal(result.mode, "applied");
  assert.equal(result.request.status, "applied");
  assert.equal(result.request.storage, "database");
  assert.equal(records.length, 1);
  assert.equal(records[0].attendees[0].founderId, "founder_1");
  assert.equal(records[0].attendees[0].status, "registered");
});

test("agent event enrichment preview summarizes notes and needs without provider calls", async () => {
  const result = await enrichEventContextForAgent({
    eventId: "yc-agent-event-1",
    execute: false,
    needs: [
      {
        founderId: "founder_1",
        needText: "Looking for fintech infrastructure introductions"
      }
    ],
    notes: [
      {
        body: "Met at office hours and wants customer intros.",
        founderId: "founder_1",
        noteType: "office_hours"
      }
    ]
  });

  assert.equal(result.action, "event_context.enrich");
  assert.equal(result.mode, "dry_run");
  assert.equal(result.checks.ycSourcesOnly, true);
  assert.equal(result.needs[0].needTextLength > 0, true);
  assert.equal(result.notes[0].bodyLength > 0, true);
});

test("agent event enrichment execute writes YC notes and needs through storage", async () => {
  const records: AgentEnrichEventContextRecord[] = [];
  const result = await enrichEventContextForAgent(
    {
      eventId: "yc-agent-event-1",
      needs: [
        {
          founderId: "founder_1",
          needCategory: "customers",
          needText: "Wants introductions to CFO buyers"
        }
      ],
      notes: [
        {
          body: "Strong fit for finance operators.",
          companyId: "company_1",
          noteType: "user"
        }
      ],
      reason: "YC operator asked the agent to enrich this event"
    },
    {
      eventStore: {
        async createEvent() {
          throw new Error("not used");
        },
        async enrichEventContext(record) {
          records.push(record);
          return {
            id: "yc-agent-event-1-enrichment",
            storage: "database"
          };
        }
      }
    }
  );

  assert.equal(result.mode, "applied");
  assert.equal(result.request.status, "applied");
  assert.equal(records.length, 1);
  assert.equal(records[0].needs[0].needCategory, "customers");
  assert.equal(records[0].notes[0].companyId, "company_1");
});

test("supabase event store writes created events to yc_events", async () => {
  const calls: SupabaseCall[] = [];
  const store = createSupabaseAgentEventStoreFromEnv(supabaseEnv(), supabaseFetch(calls, {
    yc_events: [{ id: "yc-agent-event-db-1" }]
  }));

  assert.ok(store);

  const result = await createEventForAgent(
    {
      actorName: "YC Operator",
      capacity: 40,
      description: "Backend alignment test",
      execute: true,
      location: "San Francisco",
      reason: "Testing Supabase-backed event creation",
      startsAt: "2026-07-01T18:00:00Z",
      timezone: "America/Los_Angeles",
      title: "YC Supabase Event"
    },
    { eventStore: store }
  );

  assert.equal(result.event.id, "yc-agent-event-db-1");
  assert.equal(result.request.storage, "database");
  assert.equal(calls.length, 1);

  const call = calls[0];
  const body = call.body as Array<Record<string, unknown>>;
  const row = body[0];
  const metadata = row.metadata as Record<string, unknown>;

  assert.equal(call.url.pathname, "/rest/v1/yc_events");
  assert.equal(call.url.searchParams.get("select"), "id");
  assert.equal(call.init.method, "POST");
  assert.equal(call.headers.apikey, "supabase_service_key");
  assert.equal(call.headers.authorization, "Bearer supabase_service_key");
  assert.equal(call.headers.prefer, "return=representation");
  assert.equal(row.title, "YC Supabase Event");
  assert.equal(row.location, "San Francisco");
  assert.equal(row.source_kind, "yc_os_agent");
  assert.equal(row.starts_at, "2026-07-01T18:00:00Z");
  assert.equal(metadata.agent_created, true);
  assert.equal(metadata.provider_sync, "yc_os_runtime");
  assert.equal(metadata.capacity, 40);
});

test("supabase event store upserts YC OS attendance rows", async () => {
  const calls: SupabaseCall[] = [];
  const store = createSupabaseAgentEventStoreFromEnv(supabaseEnv(), supabaseFetch(calls));

  assert.ok(store);

  const result = await addEventAttendeesForAgent(
    {
      attendees: [
        {
          companyId: "company_1",
          founderId: "founder_1",
          status: "registered"
        }
      ],
      eventId: "yc-agent-event-1",
      execute: true,
      reason: "Testing Supabase-backed attendance"
    },
    { eventStore: store }
  );

  assert.equal(result.mode, "applied");
  assert.equal(result.request.storage, "database");
  assert.equal(calls.length, 1);

  const call = calls[0];
  const body = call.body as Array<Record<string, unknown>>;
  const row = body[0];
  const metadata = row.metadata as Record<string, unknown>;

  assert.equal(call.url.pathname, "/rest/v1/yc_event_attendance");
  assert.equal(call.url.searchParams.get("on_conflict"), "event_id,founder_id");
  assert.equal(call.headers.prefer, "return=minimal,resolution=merge-duplicates");
  assert.equal(row.event_id, "yc-agent-event-1");
  assert.equal(row.founder_id, "founder_1");
  assert.equal(row.company_id, "company_1");
  assert.equal(row.source, "yc_os_agent");
  assert.equal(row.status, "registered");
  assert.equal(metadata.agent_added, true);
});

test("supabase event store anchors Lu.ma approval events before prep writes", async () => {
  const eventId = "2878da29-2532-4ff7-9fac-d219c7e4e372";
  const calls: SupabaseCall[] = [];
  const store = createSupabaseAgentEventStoreFromEnv(supabaseEnv(), supabaseFetch(calls, {
    luma_events: [{
      calendar_id: "calendar_1",
      id: eventId,
      location_text: "San Francisco",
      luma_event_id: "evt_luma_1",
      starts_at: "2026-06-18T16:00:00Z",
      synced_at: "2026-06-12T00:00:00Z",
      title: "Approval-backed Event",
      url: "https://lu.ma/example"
    }],
    yc_events: []
  }));

  assert.ok(store);

  const result = await addEventAttendeesForAgent(
    {
      attendees: [{ companyId: "company_1", founderId: "founder_1" }],
      eventId,
      execute: true,
      reason: "Testing approval event anchor writes"
    },
    { eventStore: store }
  );

  assert.equal(result.mode, "applied");
  assert.equal(calls.length, 4);

  const [eventLookup, lumaLookup, anchorUpsert, attendanceUpsert] = calls;
  assert.equal(eventLookup.url.pathname, "/rest/v1/yc_events");
  assert.equal(eventLookup.init.method, "GET");
  assert.equal(eventLookup.url.searchParams.get("id"), `eq.${eventId}`);
  assert.equal(lumaLookup.url.pathname, "/rest/v1/luma_events");
  assert.equal(lumaLookup.url.searchParams.get("id"), `eq.${eventId}`);

  const anchorRow = (anchorUpsert.body as Array<Record<string, unknown>>)[0];
  const anchorMetadata = anchorRow.metadata as Record<string, unknown>;
  assert.equal(anchorUpsert.url.pathname, "/rest/v1/yc_events");
  assert.equal(anchorUpsert.url.searchParams.get("on_conflict"), "id");
  assert.equal(anchorUpsert.headers.prefer, "return=minimal,resolution=merge-duplicates");
  assert.equal(anchorRow.id, eventId);
  assert.equal(anchorRow.title, "Approval-backed Event");
  assert.equal(anchorRow.source_kind, "luma_approval");
  assert.equal(anchorMetadata.agent_write_anchor, true);
  assert.equal(anchorMetadata.luma_event_id, "evt_luma_1");

  assert.equal(attendanceUpsert.url.pathname, "/rest/v1/yc_event_attendance");
  assert.equal(attendanceUpsert.url.searchParams.get("on_conflict"), "event_id,founder_id");
});

test("supabase event store writes YC notes and needs for enrichment", async () => {
  const calls: SupabaseCall[] = [];
  const store = createSupabaseAgentEventStoreFromEnv(supabaseEnv(), supabaseFetch(calls));

  assert.ok(store);

  const result = await enrichEventContextForAgent(
    {
      eventId: "yc-agent-event-1",
      execute: true,
      needs: [
        {
          companyId: "company_1",
          founderId: "founder_1",
          needCategory: "customers",
          needText: "Wants CFO buyer introductions"
        }
      ],
      notes: [
        {
          body: "Strong fit for finance operators.",
          founderId: "founder_1",
          noteType: "user"
        }
      ],
      reason: "Testing Supabase-backed enrichment"
    },
    { eventStore: store }
  );

  assert.equal(result.mode, "applied");
  assert.equal(result.request.storage, "database");

  const noteCall = calls.find((call) => call.url.pathname === "/rest/v1/yc_notes");
  const needCall = calls.find((call) => call.url.pathname === "/rest/v1/yc_founder_needs");
  assert.ok(noteCall);
  assert.ok(needCall);

  const note = (noteCall.body as Array<Record<string, unknown>>)[0];
  const noteMetadata = note.metadata as Record<string, unknown>;
  const need = (needCall.body as Array<Record<string, unknown>>)[0];
  const needMetadata = need.metadata as Record<string, unknown>;

  assert.equal(note.event_id, "yc-agent-event-1");
  assert.equal(note.founder_id, "founder_1");
  assert.equal(note.note_type, "user");
  assert.equal(note.source_kind, "yc_os_agent");
  assert.equal(note.visibility, "team");
  assert.equal(noteMetadata.agent_enriched, true);
  assert.equal(need.event_id, "yc-agent-event-1");
  assert.equal(need.founder_id, "founder_1");
  assert.equal(need.company_id, "company_1");
  assert.equal(need.need_category, "customers");
  assert.equal(need.need_text, "Wants CFO buyer introductions");
  assert.equal(need.source, "yc_os_agent");
  assert.equal(need.is_current, true);
  assert.equal(needMetadata.agent_enriched, true);
});

type SupabaseCall = {
  body: unknown;
  headers: Record<string, string>;
  init: RequestInit;
  url: URL;
};

function supabaseEnv(): NodeJS.ProcessEnv {
  return {
    EVENT_PREP_DATA_SOURCE: "supabase",
    NODE_ENV: "test",
    SUPABASE_SERVICE_ROLE_KEY: "supabase_service_key",
    SUPABASE_URL: "https://supabase.test"
  } as NodeJS.ProcessEnv;
}

function supabaseFetch(
  calls: SupabaseCall[],
  responses: Record<string, unknown> = {}
): typeof fetch {
  return (async (input, init = {}) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop() ?? "";
    calls.push({
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
      init,
      url
    });

    const payload = responses[table] ?? {};
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}
