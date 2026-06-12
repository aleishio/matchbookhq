import assert from "node:assert/strict";
import test from "node:test";

import { filterApprovalApplications } from "../app/lib/event-approvals-filters.ts";
import {
  chunkSupabaseInFilterValues,
  isLiveLumaEventApiId,
  isLegacyApprovalActionRpcMismatch,
  mapApplicationRow,
  mapEventRow,
  supabaseEventLookupFilters
} from "../app/lib/event-approvals-supabase-repository.ts";
import { SupabaseRestError } from "../app/lib/supabase/service-client.ts";

const baseApplicationRow = {
  id: "application-1",
  luma_event_id: "event-1",
  luma_guest_id: "guest-1",
  applicant_name: "Ada Founder",
  applicant_email: "ada@example.com",
  applicant_phone: "(415) 555-0101",
  luma_status: "pending_approval",
  approval_status: "awaiting_reply",
  match_confidence: 62,
  relation: "Possible YC founder",
  recommendation: "Wait for applicant details or review the parsed reply.",
  rule_code: "C2 clarification email sent, reply can be parsed before review",
  primary_action: "manual_review",
  selected_default: false,
  luma_fields: {
    event_api_id: "evt_123",
    registration_answers: {
      Company: "ExampleCo",
      "YC batch": "W24"
    }
  },
  luma_payload: {},
  ai_recommendation: {
    decision: "send_info",
    confidence: 67,
    model: "event-approvals-rules-plus-ai",
    prompt_version: "event-approvals-v0",
    reason: "Needs clarification before approval.",
    signals: ["email: missing"]
  },
  submitted_at: "2026-06-09T15:00:00Z",
  synced_at: "2026-06-09T15:05:00Z"
};

test("maps Lu.ma event URLs from Supabase event rows", () => {
  const event = mapEventRow({
    id: "event-1",
    luma_event_id: "evt_123",
    title: "Founder Mixer",
    starts_at: "2026-06-09T15:00:00Z",
    location_text: "San Francisco",
    capacity: 150,
    luma_event_applications: [{ count: 42 }],
    synced_at: "2026-06-09T15:05:00Z",
    url: "https://luma.com/founder-mixer"
  });

  assert.equal(event.url, "https://luma.com/founder-mixer");
});

test("looks up Supabase events by UUID, Lu.ma api id, or fixture seed id without UUID-casting Lu.ma ids", () => {
  assert.deepEqual(supabaseEventLookupFilters("2878da29-2532-4ff7-9fac-d219c7e4e372"), [
    [{ column: "id", value: "2878da29-2532-4ff7-9fac-d219c7e4e372" }],
    [{ column: "luma_event_id", value: "2878da29-2532-4ff7-9fac-d219c7e4e372" }],
    [{ column: "raw_payload->>seed_id", value: "2878da29-2532-4ff7-9fac-d219c7e4e372" }]
  ]);
  assert.deepEqual(supabaseEventLookupFilters("evt-YQNWbKPIleIwPzW"), [
    [{ column: "luma_event_id", value: "evt-YQNWbKPIleIwPzW" }],
    [{ column: "raw_payload->>seed_id", value: "evt-YQNWbKPIleIwPzW" }]
  ]);
});

test("maps durable clarification jobs, replies, and AI reviews onto approval applications", () => {
  const application = mapApplicationRow(baseApplicationRow, {
    sourceComparisons: new Map([
      [
        "application-1",
        [
          {
            field: "reply",
            source: "email_reply",
            lumaValue: "personal email",
            ycValue: "ada@example.com",
            result: "partial",
            weight: 20,
            notes: "Reply provided a YC-connected email candidate."
          }
        ]
      ]
    ]),
    clarificationJobs: new Map([
      [
        "application-1",
        {
          application_id: "application-1",
          from_email: "yc@events.matchbookhq.com",
          subject: "Confirming your YC event details",
          body_preview: "Please reply with your YC company, batch, role, and mapped YC email.",
          status: "succeeded",
          sent_at: "2026-06-09T15:10:00Z",
          created_at: "2026-06-09T15:09:00Z"
        }
      ]
    ]),
    replies: new Map([
      [
        "application-1",
        {
          application_id: "application-1",
          received_at: "2026-06-09T16:00:00Z",
          subject: "Re: Confirming your YC event details",
          parsed_fields: {
            company: "ExampleCo",
            batch: "W24",
            yc_email: "ada@example.com",
            role: "founder"
          },
          status: "auto_ready",
          created_at: "2026-06-09T16:01:00Z"
        }
      ]
    ]),
    aiReviews: new Map([
      [
        "application-1",
        {
          application_id: "application-1",
          model: "gpt-4.1-mini",
          prompt_version: "approval-reply-v1",
          decision: "approve",
          confidence: 91,
          reasoning: "Reply includes company, batch, role, and YC-connected email.",
          signals: ["reply: company", "reply: batch", "reply: yc_email"],
          output_payload: {
            summary: "Applicant confirmed they are a W24 founder at ExampleCo.",
            reason: "Company, batch, role, and mapped email are present.",
            extracted: {
              company: "ExampleCo",
              batch: "W24",
              yc_email: "ada@example.com",
              role: "founder",
              relationship: "founder"
            }
          },
          created_at: "2026-06-09T16:02:00Z"
        }
      ]
    ])
  });

  assert.equal(application.clarificationRequest?.sentFrom, "yc@events.matchbookhq.com");
  assert.equal(application.clarificationRequest?.subject, "Confirming your YC event details");
  assert.equal(application.parsedReply?.aiDecision, "approve");
  assert.equal(application.parsedReply?.summary, "Applicant confirmed they are a W24 founder at ExampleCo.");
  assert.deepEqual(application.parsedReply?.extracted, [
    "Company: ExampleCo",
    "Batch: W24",
    "YC email: ada@example.com",
    "Role: founder",
    "Relationship: founder"
  ]);
  assert.equal(application.aiRecommendation.decision, "approve");
  assert.equal(application.aiRecommendation.confidence, 91);
  assert.equal(application.aiRecommendation.promptVersion, "approval-reply-v1");
  assert.equal(application.sourceComparisons[0].source, "email_reply");
  assert.ok(application.evidence.some((item) => item.label === "Email" && item.value === "Clarification succeeded"));
  assert.ok(application.evidence.some((item) => item.label === "Reply" && item.value === "Applicant reply auto_ready"));
  assert.ok(application.audit.some((item) => item.includes("user decision remains authoritative")));
});

test("falls back to stored application AI recommendation when no reply review exists", () => {
  const application = mapApplicationRow({
    ...baseApplicationRow,
    id: "application-2",
    approval_status: "needs_info"
  });

  assert.equal(application.aiRecommendation.decision, "send_info");
  assert.equal(application.aiRecommendation.model, "event-approvals-rules-plus-ai");
  assert.equal(application.clarificationRequest, undefined);
  assert.equal(application.parsedReply, undefined);
  assert.deepEqual(application.sourceComparisons, []);
});

test("maps applicant image URLs from Lu.ma fields and raw payloads", () => {
  const normalizedImage = mapApplicationRow({
    ...baseApplicationRow,
    id: "application-photo-field",
    luma_fields: {
      ...baseApplicationRow.luma_fields,
      photo_url: "https://images.example.com/field-avatar.jpg"
    },
    luma_payload: {
      user: {
        avatar_url: "https://images.example.com/raw-avatar.jpg"
      }
    }
  });
  const rawImage = mapApplicationRow({
    ...baseApplicationRow,
    id: "application-photo-payload",
    luma_payload: {
      user: {
        avatar_url: "https://images.example.com/raw-avatar.jpg"
      }
    }
  });

  assert.equal(normalizedImage.photoUrl, "https://images.example.com/field-avatar.jpg");
  assert.equal(rawImage.photoUrl, "https://images.example.com/raw-avatar.jpg");
});

test("uses YC founder profile photos as a non-authoritative approval fallback", () => {
  const application = mapApplicationRow({
    ...baseApplicationRow,
    id: "application-yc-photo"
  }, {
    ycFounderProfiles: new Map([
      [
        "application-yc-photo",
        {
          id: "yc-founder-1",
          photoUrl: "https://images.example.com/yc-founder.jpg"
        }
      ]
    ])
  });

  assert.equal(application.photoUrl, "https://images.example.com/yc-founder.jpg");
  assert.equal(application.founderId, "");
});

test("maps Lu.ma writeback status into operator-facing sync language", () => {
  const syncing = mapApplicationRow({
    ...baseApplicationRow,
    id: "approved-syncing",
    approval_status: "approved"
  }, {
    writebackJobs: new Map([
      [
        "approved-syncing",
        {
          application_id: "approved-syncing",
          status: "running",
          target_status: "approved",
          created_at: "2026-06-09T17:00:00Z"
        }
      ]
    ])
  });
  const synced = mapApplicationRow({
    ...baseApplicationRow,
    id: "approved-synced",
    approval_status: "approved"
  }, {
    writebackJobs: new Map([
      [
        "approved-synced",
        {
          application_id: "approved-synced",
          status: "succeeded",
          target_status: "approved",
          completed_at: "2026-06-09T17:01:00Z"
        }
      ]
    ])
  });
  const retrying = mapApplicationRow({
    ...baseApplicationRow,
    id: "rejected-retrying",
    approval_status: "rejected"
  }, {
    writebackJobs: new Map([
      [
        "rejected-retrying",
        {
          application_id: "rejected-retrying",
          status: "failed",
          target_status: "declined",
          scheduled_at: "2026-06-09T17:02:00Z"
        }
      ]
    ])
  });

  assert.equal(syncing.rule, "A1 user approved and synced to Lu.ma");
  assert.equal(syncing.lumaStatus, "Approved in Lu.ma");
  assert.ok(syncing.evidence.some((item) => item.label === "Lu.ma sync" && item.value === "Synced"));
  assert.equal(synced.rule, "A1 user approved and synced to Lu.ma");
  assert.equal(synced.lumaStatus, "Approved in Lu.ma");
  assert.equal(retrying.rule, "J1 user rejected and retrying Lu.ma");
  assert.equal(retrying.lumaStatus, "Rejected in YC OS, retrying Lu.ma sync");
});

test("maps non-Lu.ma example approvals as Supabase-only provider skips", () => {
  const application = mapApplicationRow({
    ...baseApplicationRow,
    id: "example-approved",
    approval_status: "approved"
  }, {
    writebackJobs: new Map([
      [
        "example-approved",
        {
          application_id: "example-approved",
          status: "succeeded",
          target_status: "approved",
          completed_at: "2026-06-09T17:01:00Z",
          response_payload: {
            skipped_provider: true,
            reason: "non_luma_example_event"
          }
        }
      ]
    ])
  });

  assert.equal(application.rule, "A1 user approved and kept in YC OS only");
  assert.equal(application.lumaStatus, "Approved in YC OS only");
  assert.ok(application.evidence.some((item) => item.label === "Lu.ma sync" && item.value === "Supabase only"));
  assert.ok(application.audit.some((item) => item.includes("Provider sync skipped for non-Lu.ma example event")));
});

test("detects real Lu.ma event api ids", () => {
  assert.equal(isLiveLumaEventApiId("evt-YQNWbKPIleIwPzW"), true);
  assert.equal(isLiveLumaEventApiId("evt_123"), true);
  assert.equal(isLiveLumaEventApiId("yc-founder-mixer"), false);
  assert.equal(isLiveLumaEventApiId(undefined), false);
});

test("routes a clarified personal-email applicant to AI-ready review without auto-approving", () => {
  const application = mapApplicationRow({
    ...baseApplicationRow,
    id: "personal-email-ready",
    applicant_name: "Alex Founder",
    applicant_email: "alex.founder@gmail.example",
    approval_status: "awaiting_reply",
    primary_action: "manual_review",
    luma_fields: {
      event_api_id: "evt_123",
      registration_answers: {
        Company: "Outsmart",
        "YC batch": "S24"
      }
    }
  }, {
    replies: new Map([
      [
        "personal-email-ready",
        {
          application_id: "personal-email-ready",
          received_at: "2026-06-09T17:00:00Z",
          parsed_fields: {
            company: "Outsmart",
            batch: "S24",
            yc_email: "alex@outsmart.example",
            role: "founder"
          },
          status: "auto_ready",
          ai_review_id: "ai-review-ready",
          created_at: "2026-06-09T17:01:00Z"
        }
      ]
    ]),
    aiReviews: new Map([
      [
        "personal-email-ready",
        {
          id: "ai-review-ready",
          application_id: "personal-email-ready",
          model: "gpt-4.1-mini",
          prompt_version: "approval-reply-v1",
          decision: "approve",
          confidence: 93,
          reasoning: "Personal-email applicant clarified company, batch, role, and YC-connected email.",
          signals: ["reply: company", "reply: batch", "reply: yc_email"],
          output_payload: {
            summary: "Applicant used a personal Gmail-style address on Lu.ma and clarified YC identity.",
            reason: "Reply includes company, batch, founder role, and a YC-connected email candidate.",
            extracted: {
              company: "Outsmart",
              batch: "S24",
              yc_email: "alex@outsmart.example",
              role: "founder",
              relationship: "founder"
            }
          },
          created_at: "2026-06-09T17:02:00Z"
        }
      ]
    ])
  });

  assert.equal(application.email, "alex.founder@gmail.example");
  assert.equal(application.status, "awaitingReply");
  assert.equal(application.primaryAction, "manualReview");
  assert.equal(application.parsedReply?.aiDecision, "approve");
  assert.equal(application.aiRecommendation.decision, "approve");
  assert.equal(application.aiRecommendation.confidence, 93);
  assert.ok(application.audit.some((item) => item.includes("user decision remains authoritative")));
});

test("keeps an ambiguous clarified personal-email applicant in manual review", () => {
  const application = mapApplicationRow({
    ...baseApplicationRow,
    id: "personal-email-manual",
    applicant_name: "Alex Founder",
    applicant_email: "alex.founder@gmail.example",
    approval_status: "awaiting_reply",
    primary_action: "manual_review",
    relation: "Network or guest claim"
  }, {
    replies: new Map([
      [
        "personal-email-manual",
        {
          application_id: "personal-email-manual",
          received_at: "2026-06-09T18:00:00Z",
          parsed_fields: {
            company: "Outsmart",
            relationship: "friend of a YC founder"
          },
          status: "manual",
          ai_review_id: "ai-review-manual",
          created_at: "2026-06-09T18:01:00Z"
        }
      ]
    ]),
    aiReviews: new Map([
      [
        "personal-email-manual",
        {
          id: "ai-review-manual",
          application_id: "personal-email-manual",
          model: "gpt-4.1-mini",
          prompt_version: "approval-reply-v1",
          decision: "manual",
          confidence: 54,
          reasoning: "Reply has network context but no batch, founder role, or mapped YC email.",
          signals: ["reply: network", "reply: missing_yc_email"],
          output_payload: {
            summary: "Applicant clarified a network relationship but not a mapped YC identity.",
            reason: "Keep manual because the reply lacks batch, role, and YC-connected email evidence.",
            extracted: {
              company: "Outsmart",
              relationship: "friend of a YC founder"
            }
          },
          created_at: "2026-06-09T18:02:00Z"
        }
      ]
    ])
  });

  assert.equal(application.email, "alex.founder@gmail.example");
  assert.equal(application.status, "awaitingReply");
  assert.equal(application.primaryAction, "manualReview");
  assert.equal(application.parsedReply?.aiDecision, "manual");
  assert.equal(application.aiRecommendation.decision, "manual");
  assert.equal(application.aiRecommendation.confidence, 54);
  assert.match(application.parsedReply?.reason ?? "", /Keep manual/);
});

test("approval search includes mapped clarification and parsed reply content", () => {
  const application = mapApplicationRow(baseApplicationRow, {
    replies: new Map([
      [
        "application-1",
        {
          application_id: "application-1",
          received_at: "2026-06-09T16:00:00Z",
          parsed_fields: {
            company: "ExampleCo",
            batch: "W24",
            role: "founder"
          },
          status: "manual",
          created_at: "2026-06-09T16:01:00Z"
        }
      ]
    ])
  });

  assert.equal(filterApprovalApplications([application], "all", "all", "ExampleCo").length, 1);
  assert.equal(filterApprovalApplications([application], "all", "all", "W24").length, 1);
  assert.equal(filterApprovalApplications([application], "all", "all", "founder").length, 1);
});

test("chunks Supabase in-filter values for large approval events", () => {
  const ids = Array.from({ length: 205 }, (_, index) => `application-${index + 1}`);
  const chunks = chunkSupabaseInFilterValues(ids, 100);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 5]);
  assert.equal(chunks[0][0], "application-1");
  assert.equal(chunks[2][4], "application-205");
});

test("detects the legacy approval action RPC signature mismatch", () => {
  const error = new SupabaseRestError("Supabase REST request failed with status 404.", 404, {
    code: "PGRST202",
    details: "Searched for the function public.queue_luma_approval_action with parameters p_action, p_actor_id, p_actor_name, p_application_ids, p_dry_run, p_email_payload, p_filter_payload, p_reason or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
    hint: "Perhaps you meant to call the function public.queue_luma_approval_action(p_action, p_actor_id, p_actor_name, p_application_ids, p_dry_run, p_filter_payload, p_reason)",
    message: "Could not find the function public.queue_luma_approval_action(p_action, p_actor_id, p_actor_name, p_application_ids, p_dry_run, p_email_payload, p_filter_payload, p_reason) in the schema cache"
  });

  assert.equal(isLegacyApprovalActionRpcMismatch(error), true);
  assert.equal(isLegacyApprovalActionRpcMismatch(new SupabaseRestError("Not found.", 404, { code: "PGRST202" })), false);
});
