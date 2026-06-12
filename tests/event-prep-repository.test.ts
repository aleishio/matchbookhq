import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { clearLocalApprovalDecisionsForTests } from "../app/lib/event-approval-decisions.ts";
import {
  listEventPrepEvents,
  listEventPrepFounders
} from "../app/lib/event-prep-repository.ts";
import {
  listEventPrepEventsFromSupabase,
  listEventPrepFoundersFromSupabase
} from "../app/lib/event-prep-supabase-repository.ts";

beforeEach(() => {
  clearLocalApprovalDecisionsForTests();
});

test("lists event-prep founders through the backend contract", async () => {
  process.env.EVENT_PREP_DATA_SOURCE = "local";

  const result = await listEventPrepFounders({ page: 1, pageSize: 25 });

  assert.equal(result.event.id, "ai-infra-office-hours");
  assert.equal(result.total, 415);
  assert.equal(result.founders.length, 25);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 25);
  assert.equal(result.counts.all, 415);
});

test("event-prep intros include an actionable recommender route and public target contact", async () => {
  process.env.EVENT_PREP_DATA_SOURCE = "local";

  const result = await listEventPrepFounders({ lens: "intro", pageSize: 25 });
  const introFounder = result.founders.find((founder) => founder.intro?.route?.contacts.length);

  assert.ok(introFounder?.intro);
  assert.equal(introFounder.intro.route?.recommendedBy, "YC OS Assistant");
  assert.equal(introFounder.intro.route?.recommenderRole, "Event prep recommender");
  assert.match(introFounder.intro.route?.instruction ?? "", /assistant or host/i);
  assert.ok(introFounder.intro.route?.contacts.some((contact) => /^https:\/\//.test(contact.url)));
});

test("lists event-prep events for selector surfaces", async () => {
  process.env.EVENT_PREP_DATA_SOURCE = "local";

  const events = await listEventPrepEvents();

  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((event) => event.id),
    ["ai-infra-office-hours", "dogpatch-founder-breakfast", "yc-founder-mixer", "founder-dinner"]
  );
  assert.equal(events[0].attendeeCount, 415);
  assert.equal(events[0].mode, "example");
  assert.equal(events[0].sourceUrl, "https://luma.com/ai-infra-office-hours");
  assert.equal(events[1].attendeeCount, 5);
  assert.equal(events[1].mode, "live");
  assert.equal(events[1].sourceUrl, "https://luma.com/dogpatch-founder-breakfast-0623");
});

test("keeps the live Lu.ma event selectable for event prep", async () => {
  process.env.EVENT_PREP_DATA_SOURCE = "local";

  const result = await listEventPrepFounders({
    eventId: "dogpatch-founder-breakfast",
    pageSize: 25
  });

  assert.equal(result.event.id, "dogpatch-founder-breakfast");
  assert.equal(result.event.mode, "live");
  assert.equal(result.total, 5);
  assert.equal(result.founders.length, 5);
});

test("keeps a real Supabase approval event first even when it maps to example prep data", async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop();
    const payloadByTable: Record<string, unknown[]> = {
      luma_events: [
        {
          id: "dogpatch-founder-breakfast",
          luma_event_id: "evt-YQNWbKPIleIwPzW",
          title: "Dogpatch Founder Breakfast",
          url: "https://luma.com/dogpatch-founder-breakfast-0623",
          starts_at: "2026-06-23T17:00:00.000Z",
          location_text: "Dogpatch, San Francisco",
          capacity: 0,
          luma_event_applications: [{ count: 12 }],
          synced_at: "2026-06-10T00:00:00.000Z",
          raw_payload: {}
        }
      ],
      yc_events: [
        {
          id: "w26-founder-mixer-example",
          title: "YC Founder Mixer",
          location: "San Francisco",
          starts_at: "2026-06-09T17:00:00.000Z",
          attendee_count: 415,
          source_kind: "seed",
          metadata: { display_kind: "example" }
        }
      ],
      yc_event_attendance: [
        { event_id: "w26-founder-mixer-example" },
        { event_id: "w26-founder-mixer-example" },
        { event_id: "w26-founder-mixer-example" },
        { event_id: "w26-founder-mixer-example" },
        { event_id: "w26-founder-mixer-example" }
      ]
    };

    return Response.json(payloadByTable[table ?? ""] ?? []);
  }) as typeof fetch;

  try {
    const events = await listEventPrepEventsFromSupabase();

    assert.equal(events[0].id, "dogpatch-founder-breakfast");
    assert.equal(events[0].title, "Dogpatch Founder Breakfast");
    assert.equal(events[0].mode, "live");
    assert.equal(events[0].sourceUrl, "https://luma.com/dogpatch-founder-breakfast-0623");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("SUPABASE_URL", originalSupabaseUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalSupabaseServiceRoleKey);
  }
});

test("hides Supabase prep rows behind visible approval-backed prep events", async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop();
    const payloadByTable: Record<string, unknown[]> = {
      luma_events: [
        {
          id: "ai-infra-approval-event",
          luma_event_id: "ai-infra-office-hours",
          title: "AI Infra Office Hours in SF",
          url: "https://luma.com/ai-infra-office-hours",
          starts_at: "2026-06-11T16:00:00.000Z",
          location_text: "San Francisco",
          capacity: 0,
          luma_event_applications: [{ count: 86 }],
          synced_at: "2026-06-10T00:00:00.000Z",
          raw_payload: { seed_id: "ai-infra-office-hours" }
        },
        {
          id: "dogpatch-approval-event",
          luma_event_id: "evt-YQNWbKPIleIwPzW",
          title: "Dogpatch Founder Breakfast",
          url: "https://luma.com/dogpatch-founder-breakfast-0623",
          starts_at: "2026-06-23T17:00:00.000Z",
          location_text: "Dogpatch, San Francisco",
          capacity: 0,
          luma_event_applications: [{ count: 13 }],
          synced_at: "2026-06-10T00:00:00.000Z",
          raw_payload: {}
        },
        {
          id: "resend-test-event",
          luma_event_id: "yc-os-test-resend-aleix-20260610065856",
          title: "YC OS Resend Reply Test",
          starts_at: "2026-06-10T06:58:57.000Z",
          location_text: "TBD",
          capacity: 0,
          luma_event_applications: [{ count: 1 }],
          synced_at: "2026-06-10T00:00:00.000Z",
          raw_payload: {}
        },
        {
          id: "mixer-approval-event",
          luma_event_id: "yc-founder-mixer",
          title: "YC Founder Mixer",
          url: "https://luma.com/yc-founder-mixer",
          starts_at: "2026-06-10T18:00:00.000Z",
          location_text: "San Francisco",
          capacity: 0,
          luma_event_applications: [{ count: 600 }],
          synced_at: "2026-06-10T00:00:00.000Z",
          raw_payload: { seed_id: "yc-founder-mixer" }
        },
        {
          id: "women-founder-approval-event",
          luma_event_id: "founder-dinner",
          title: "Women Founders Dinner",
          url: "https://luma.com/founder-dinner",
          starts_at: "2026-06-12T19:00:00.000Z",
          location_text: "San Francisco",
          capacity: 0,
          luma_event_applications: [{ count: 44 }],
          synced_at: "2026-06-10T00:00:00.000Z",
          raw_payload: { seed_id: "founder-dinner" }
        }
      ],
      yc_events: [
        {
          id: "dogpatch-founder-breakfast",
          title: "Dogpatch Founder Breakfast",
          location: "Dogpatch, San Francisco",
          starts_at: "2026-06-23T17:00:00.000Z",
          attendee_count: 1,
          source_kind: "luma",
          source_url: "https://luma.com/dogpatch-founder-breakfast-0623",
          metadata: { display_kind: "live", luma_event_id: "evt-YQNWbKPIleIwPzW" }
        },
        {
          id: "w26-founder-mixer-example",
          title: "W26 Founder Mixer Example",
          location: "San Francisco",
          starts_at: "2026-06-09T17:00:00.000Z",
          attendee_count: 2,
          source_kind: "seed",
          metadata: {
            display_kind: "example",
            approval_event_ids: ["yc-founder-mixer", "ai-infra-office-hours", "founder-dinner"]
          }
        }
      ],
      yc_event_attendance: [
        { event_id: "dogpatch-founder-breakfast" },
        { event_id: "w26-founder-mixer-example" },
        { event_id: "w26-founder-mixer-example" }
      ],
      luma_event_applications: [
        {
          id: "application-ai-approved-1",
          luma_event_id: "ai-infra-approval-event",
          luma_guest_id: "guest-ai-approved-1",
          applicant_name: "AI Approved One",
          approval_status: "approved",
          luma_status: "approved",
          luma_fields: { registration_answers: {} },
          luma_payload: {}
        },
        {
          id: "application-ai-approved-2",
          luma_event_id: "ai-infra-approval-event",
          luma_guest_id: "guest-ai-approved-2",
          applicant_name: "AI Approved Two",
          approval_status: "approved",
          luma_status: "approved",
          luma_fields: { registration_answers: {} },
          luma_payload: {}
        },
        {
          id: "application-ai-rejected",
          luma_event_id: "ai-infra-approval-event",
          luma_guest_id: "guest-ai-rejected",
          applicant_name: "AI Rejected",
          approval_status: "rejected",
          luma_status: "declined",
          luma_fields: { registration_answers: {} },
          luma_payload: {}
        },
        {
          id: "application-dogpatch-approved",
          luma_event_id: "dogpatch-approval-event",
          luma_guest_id: "guest-dogpatch-approved",
          applicant_name: "Dogpatch Approved",
          approval_status: "approved",
          luma_status: "approved",
          luma_fields: { registration_answers: {} },
          luma_payload: {}
        }
      ]
    };

    return Response.json(payloadByTable[table ?? ""] ?? []);
  }) as typeof fetch;

  try {
    const events = await listEventPrepEventsFromSupabase();

    assert.deepEqual(
      events.map((event) => event.id),
      ["ai-infra-approval-event", "dogpatch-approval-event"]
    );
    assert.equal(events[0].title, "AI Infra Office Hours in SF");
    assert.equal(events[0].attendeeCount, 2);
    assert.equal(events[1].sourceUrl, "https://luma.com/dogpatch-founder-breakfast-0623");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("SUPABASE_URL", originalSupabaseUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalSupabaseServiceRoleKey);
  }
});

test("uses approval applications as Supabase prep when an approval event only maps to example data", async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop();
    const payloadByTable: Record<string, unknown[]> = {
      luma_events: [
        {
          id: "ai-infra-approval-event",
          luma_event_id: "ai-infra-office-hours",
          title: "AI Infra Office Hours in SF",
          starts_at: "2026-06-11T16:00:00.000Z",
          location_text: "San Francisco",
          capacity: 0,
          luma_event_applications: [{ count: 2 }],
          synced_at: "2026-06-10T00:00:00.000Z",
          raw_payload: { seed_id: "ai-infra-office-hours" }
        }
      ],
      yc_events: [
        {
          id: "w26-founder-mixer-example",
          title: "W26 Founder Mixer Example",
          location: "San Francisco",
          starts_at: "2026-06-09T17:00:00.000Z",
          attendee_count: 415,
          source_kind: "seed",
          metadata: {
            display_kind: "example",
            approval_event_ids: ["ai-infra-office-hours"]
          }
        }
      ],
      yc_event_attendance: [
        { event_id: "w26-founder-mixer-example", founder_id: "seed-founder-1" },
        { event_id: "w26-founder-mixer-example", founder_id: "ai-founder-1" },
        { event_id: "w26-founder-mixer-example", founder_id: "ai-founder-2" }
      ],
      yc_founders: [
        { id: "seed-founder-1", name: "Seed Founder", company_id: "seed-company", role: "Founder" },
        {
          id: "ai-founder-1",
          name: "AI Applicant One",
          company_id: "seed-company",
          image_paths: { photo: "https://images.example.com/ai-one.jpg" },
          role: "Founder"
        },
        {
          id: "ai-founder-2",
          name: "AI Applicant Two",
          company_id: "seed-company",
          image_paths: { photo: "https://images.example.com/ai-two.jpg" },
          role: "Founder",
          social_links: { linkedin: "https://www.linkedin.com/in/ai-applicant-two" }
        }
      ],
      yc_companies: [
        {
          id: "seed-company",
          name: "Seed Co",
          batch: "W26",
          one_liner: "Seed example company.",
          yc_url: "https://www.ycombinator.com/companies/seed-co"
        }
      ],
      yc_founder_needs: [
        {
          event_id: "w26-founder-mixer-example",
          founder_id: "ai-founder-1",
          need_text: "Find infrastructure buyers",
          need_category: "customers"
        }
      ],
      yc_notes: [
        {
          id: "note-ai-founder-1",
          event_id: "w26-founder-mixer-example",
          founder_id: "ai-founder-1",
          note_type: "room",
          body: "Strong AI infrastructure fit.",
          source_kind: "seed",
          created_at: "2026-06-10T00:00:00.000Z"
        }
      ],
      yc_intro_suggestions: [
        {
          event_id: "w26-founder-mixer-example",
          from_founder_id: "ai-founder-1",
          to_founder_id: "ai-founder-2",
          fit_label: "strong",
          reason: "Both founders sell infrastructure into AI teams.",
          opener: "Compare notes on AI infra buyers.",
          evidence: ["shared AI infra category"],
          same_company: false
        }
      ],
      luma_event_applications: [
        {
          id: "application-ai-1",
          luma_event_id: "ai-infra-approval-event",
          luma_guest_id: "guest-ai-1",
          applicant_name: "AI Applicant One",
          applicant_email: "one@example.com",
          approval_status: "approved",
          luma_status: "approved",
          match_confidence: 58,
          relation: "AI infra founder",
          recommendation: "Approved for AI infrastructure fit.",
          primary_action: "approve",
          luma_fields: { registration_answers: { Company: "AI Co One" } },
          luma_payload: {},
          submitted_at: "2026-06-10T00:00:00.000Z"
        },
        {
          id: "application-ai-2",
          luma_event_id: "ai-infra-approval-event",
          luma_guest_id: "guest-ai-2",
          applicant_name: "AI Applicant Two",
          applicant_email: "two@example.com",
          approval_status: "approved",
          luma_status: "approved",
          match_confidence: 88,
          relation: "AI infra founder",
          recommendation: "Approved based on event fit.",
          primary_action: "approve",
          luma_fields: { registration_answers: { Company: "AI Co Two" } },
          luma_payload: {},
          submitted_at: "2026-06-10T00:01:00.000Z"
        },
        {
          id: "application-ai-rejected",
          luma_event_id: "ai-infra-approval-event",
          luma_guest_id: "guest-ai-rejected",
          applicant_name: "Rejected Applicant",
          applicant_email: "rejected@example.com",
          approval_status: "rejected",
          luma_status: "declined",
          match_confidence: 10,
          relation: "Not a fit",
          recommendation: "Rejected.",
          primary_action: "none",
          luma_fields: { registration_answers: { Company: "Rejected Co" } },
          luma_payload: {},
          submitted_at: "2026-06-10T00:02:00.000Z"
        }
      ]
    };

    return Response.json(payloadByTable[table ?? ""] ?? []);
  }) as typeof fetch;

  try {
    const result = await listEventPrepFoundersFromSupabase({
      eventId: "ai-infra-approval-event",
      pageSize: 25
    });

    assert.equal(result.event.id, "ai-infra-approval-event");
    assert.equal(result.event.attendeeCount, 2);
    assert.equal(result.total, 2);
    assert.deepEqual(
      result.founders.map((founder) => founder.name),
      ["AI Applicant One", "AI Applicant Two"]
    );
    assert.equal(result.founders[0].id, "ai-founder-1");
    assert.equal(result.founders[0].company.name, "Seed Co");
    assert.equal(result.founders[0].photoUrl, "https://images.example.com/ai-one.jpg");
    assert.equal(result.founders[0].introCount, 1);
    assert.equal(result.founders[0].intro?.targetFounderId, "ai-founder-2");
    assert.equal(result.founders[0].intro?.route?.recommendedBy, "YC OS Assistant");
    assert.equal(result.founders[0].intro?.route?.contacts[0]?.label, "YC profile");
    assert.equal(result.founders[0].intro?.route?.contacts[1]?.label, "LinkedIn");
    assert.equal(result.founders[0].notes[0].source, "event approval");
    assert.equal(result.founders[0].notes[1].source, "seed");

    const backingEventResult = await listEventPrepFoundersFromSupabase({
      eventId: "w26-founder-mixer-example",
      pageSize: 25
    });

    assert.equal(backingEventResult.event.id, "ai-infra-approval-event");
    assert.equal(backingEventResult.total, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("SUPABASE_URL", originalSupabaseUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalSupabaseServiceRoleKey);
  }
});

test("includes approved Lu.ma applicants in Supabase event prep even without YC founder mapping", async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop();
    const payloadByTable: Record<string, unknown[]> = {
      luma_events: [
        {
          id: "dogpatch-approval-event",
          luma_event_id: "evt-dogpatch",
          title: "Dogpatch Founder Breakfast",
          url: "https://luma.com/dogpatch-founder-breakfast-0623",
          starts_at: "2026-06-23T17:00:00.000Z",
          location_text: "Dogpatch, San Francisco",
          capacity: 0,
          luma_event_applications: [{ count: 2 }],
          synced_at: "2026-06-10T00:00:00.000Z",
          raw_payload: {}
        }
      ],
      yc_events: [
        {
          id: "dogpatch-prep-event",
          title: "Dogpatch Founder Breakfast",
          location: "Dogpatch, San Francisco",
          starts_at: "2026-06-23T17:00:00.000Z",
          attendee_count: 1,
          source_kind: "luma",
          source_url: "https://luma.com/dogpatch-founder-breakfast-0623",
          metadata: { display_kind: "live", luma_event_id: "evt-dogpatch" }
        }
      ],
      yc_event_attendance: [
        { event_id: "dogpatch-prep-event", founder_id: "founder-1", metadata: { seed_index: 0 } }
      ],
      yc_founders: [
        { id: "founder-1", name: "Mapped Founder", company_id: "company-1", role: "Founder" }
      ],
      yc_companies: [
        { id: "company-1", name: "Mapped Co", batch: "W26", one_liner: "Mapped YC company." }
      ],
      yc_founder_needs: [],
      yc_notes: [],
      yc_intro_suggestions: [],
      luma_event_applications: [
        {
          id: "application-mapped",
          luma_event_id: "dogpatch-approval-event",
          luma_guest_id: "guest-mapped",
          applicant_name: "Mapped Founder",
          applicant_email: "mapped@example.com",
          approval_status: "approved",
          luma_status: "approved",
          luma_fields: { registration_answers: {} },
          luma_payload: {},
          submitted_at: "2026-06-10T00:00:00.000Z"
        },
        {
          id: "application-unmapped",
          luma_event_id: "dogpatch-approval-event",
          luma_guest_id: "guest-unmapped",
          applicant_name: "Unmapped Approved",
          applicant_email: "unmapped@example.com",
          approval_status: "approved",
          luma_status: "approved",
          luma_fields: { registration_answers: { Company: "Unmapped Co" } },
          luma_payload: {},
          relation: "Approved applicant",
          recommendation: "Approved by ops.",
          submitted_at: "2026-06-10T00:00:00.000Z"
        }
      ]
    };

    return Response.json(payloadByTable[table ?? ""] ?? []);
  }) as typeof fetch;

  try {
    const result = await listEventPrepFoundersFromSupabase({
      eventId: "dogpatch-approval-event",
      pageSize: 25
    });

    assert.equal(result.total, 2);
    assert.deepEqual(
      result.founders.map((founder) => founder.name),
      ["Mapped Founder", "Unmapped Approved"]
    );
    assert.equal(result.founders[1].company.name, "Unmapped Co");
    assert.equal(result.founders[1].notes[0].source, "event approval");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("SUPABASE_URL", originalSupabaseUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalSupabaseServiceRoleKey);
  }
});

test("filters event-prep founders with API-facing lenses and search", async () => {
  process.env.EVENT_PREP_DATA_SOURCE = "local";

  const aiResult = await listEventPrepFounders({ lens: "ai", pageSize: 50 });
  const searchResult = await listEventPrepFounders({ search: "Agentic Fabriq", pageSize: 10 });
  const phraseSearchResult = await listEventPrepFounders({ search: "AI infrastructure", pageSize: 10 });

  assert.ok(aiResult.total > 0);
  assert.ok(aiResult.founders.every((founder) => {
    const text = `${founder.company.category} ${founder.company.oneLiner}`.toLowerCase();
    return text.includes("ai") || text.includes("model") || text.includes("agent") || text.includes("infra");
  }));
  assert.ok(searchResult.total > 0);
  assert.ok(searchResult.founders.some((founder) => founder.company.name === "Agentic Fabriq"));
  assert.ok(phraseSearchResult.total > 0);
});

test("includes related intro targets for founders returned on the current page", async () => {
  process.env.EVENT_PREP_DATA_SOURCE = "local";

  const result = await listEventPrepFounders({ lens: "intro", pageSize: 25 });
  const visibleIds = new Set(result.founders.map((founder) => founder.id));
  const relatedIds = new Set(result.relatedFounders.map((founder) => founder.id));
  const missingTargets = result.founders
    .map((founder) => founder.intro?.targetFounderId)
    .filter((id): id is string => typeof id === "string" && !visibleIds.has(id) && !relatedIds.has(id));

  assert.equal(missingTargets.length, 0);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
