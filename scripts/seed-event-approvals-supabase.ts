#!/usr/bin/env bun

import { getEventApprovalsData } from "../app/lib/event-approvals-data";
import type {
  ApprovalStatus,
  EventApprovalApplication,
  LoadedLumaEvent
} from "../app/lib/event-approvals-types";
import {
  createSupabaseServiceClientFromEnv,
  type SupabaseMutationOptions
} from "../app/lib/supabase/service-client";

type SeedOptions = {
  accountId: string;
  dryRun: boolean;
};

type UpsertedRow = {
  id: string;
  luma_event_id?: string;
  luma_guest_id?: string;
};

const CHUNK_SIZE = 100;
const DEFAULT_ACCOUNT_ID = "yc-os-demo-seed";
const EVENT_STARTS_AT: Record<string, string> = {
  "yc-founder-mixer": "2026-06-10T18:00:00.000Z",
  "ai-infra-office-hours": "2026-06-11T16:00:00.000Z",
  "founder-dinner": "2026-06-12T19:00:00.000Z"
};

async function main() {
  const options = readOptions();
  const data = await getEventApprovalsData();

  if (options.dryRun) {
    printSummary("dry-run", data.events, data.applications);
    return;
  }

  const client = createSupabaseServiceClientFromEnv();
  const account = await upsertExternalAccount(client, options, data.applications.length);
  const eventsBySeedId = await upsertEvents(client, account.id, data.events);
  const applications = await upsertApplications(client, eventsBySeedId, data.applications);

  await deleteSourceComparisons(applications.map((application) => application.id));
  await insertSourceComparisons(client, applications, data.applications);

  printSummary("seeded", data.events, data.applications);
}

async function upsertExternalAccount(
  client: ReturnType<typeof createSupabaseServiceClientFromEnv>,
  options: SeedOptions,
  applicationCount: number
) {
  const rows = await client.upsert<UpsertedRow>("external_accounts", [{
    provider: "luma",
    provider_account_id: options.accountId,
    display_name: "YC OS demo seed",
    metadata: {
      seeded_from: "app/lib/event-approvals-data.ts",
      synthetic: true,
      application_count: applicationCount
    }
  }], {
    onConflict: "provider,provider_account_id",
    select: "id,provider_account_id"
  });

  const account = rows[0];
  if (!account?.id) throw new Error("Unable to upsert Supabase external account.");
  return account;
}

async function upsertEvents(
  client: ReturnType<typeof createSupabaseServiceClientFromEnv>,
  accountId: string,
  events: LoadedLumaEvent[]
) {
  const rows = await client.upsert<UpsertedRow>("luma_events", events.map((event) => ({
    external_account_id: accountId,
    luma_event_id: event.lumaApiId ?? event.id,
    calendar_id: "yc-os-demo",
    title: event.title,
    url: event.url ?? null,
    starts_at: EVENT_STARTS_AT[event.id] ?? null,
    timezone: "America/Los_Angeles",
    location_text: event.location,
    capacity: event.seats,
    approval_mode: "manual",
    raw_payload: {
      seed_id: event.id,
      source: event.source,
      starts_at_label: event.startsAt,
      synced_at_label: event.syncedAt
    },
    synced_at: "2026-06-10T00:00:00.000Z"
  })), {
    onConflict: "external_account_id,luma_event_id",
    select: "id,luma_event_id"
  });

  const rowsByLumaEventId = new Map(rows.map((row) => [row.luma_event_id, row.id]));

  return new Map(events.map((event) => {
    const rowId = rowsByLumaEventId.get(event.lumaApiId ?? event.id);
    if (!rowId) throw new Error(`Missing Supabase event row for ${event.id}.`);
    return [event.id, rowId];
  }));
}

async function upsertApplications(
  client: ReturnType<typeof createSupabaseServiceClientFromEnv>,
  eventsBySeedId: Map<string | undefined, string>,
  applications: EventApprovalApplication[]
) {
  const upserted: UpsertedRow[] = [];

  for (const chunk of chunks(applications, CHUNK_SIZE)) {
    const rows = await client.upsert<UpsertedRow>("luma_event_applications", chunk.map((application) => {
      const eventId = eventsBySeedId.get(application.eventId);
      if (!eventId) throw new Error(`Missing Supabase event for ${application.eventId}.`);

      return {
        luma_event_id: eventId,
        luma_guest_id: application.lumaPayload.guestId,
        applicant_name: application.name,
        applicant_email: application.email,
        applicant_phone: application.phone,
        luma_status: application.lumaPayload.approvalStatus,
        approval_status: approvalStatusToDb(application.status),
        match_confidence: application.matchConfidence,
        relation: application.relation,
        recommendation: application.recommendation,
        rule_code: application.rule,
        primary_action: primaryActionToDb(application.primaryAction),
        selected_default: application.selectedDefault,
        luma_fields: {
          ...application.lumaPayload.rawFields,
          event_api_id: application.lumaPayload.eventApiId,
          guest_api_id: application.lumaPayload.guestId,
          photo_url: application.photoUrl ?? null,
          registration_answers: application.lumaPayload.registrationAnswers
        },
        luma_payload: application.lumaPayload,
        ai_recommendation: application.aiRecommendation,
        submitted_at: submittedAtToIso(application.submittedAt),
        synced_at: "2026-06-10T00:00:00.000Z",
        last_seen_at: "2026-06-10T00:00:00.000Z"
      };
    }), mutationOptions("luma_event_id,luma_guest_id", "id,luma_guest_id"));

    upserted.push(...rows);
  }

  const byGuestId = new Map(upserted.map((row) => [row.luma_guest_id, row]));
  return applications.map((application) => {
    const row = byGuestId.get(application.lumaPayload.guestId);
    if (!row?.id) throw new Error(`Missing Supabase application for ${application.id}.`);
    return { seed: application, id: row.id };
  });
}

async function insertSourceComparisons(
  client: ReturnType<typeof createSupabaseServiceClientFromEnv>,
  applications: Array<{ seed: EventApprovalApplication; id: string }>,
  seedApplications: EventApprovalApplication[]
) {
  const idsBySeedId = new Map(applications.map((application) => [application.seed.id, application.id]));
  const rows = seedApplications.flatMap((application) => {
    const applicationId = idsBySeedId.get(application.id);
    if (!applicationId) return [];

    return application.sourceComparisons.map((comparison) => ({
      application_id: applicationId,
      field_name: comparison.field,
      source_kind: comparison.source,
      luma_value: comparison.lumaValue,
      yc_value: comparison.ycValue ?? null,
      result: comparison.result,
      weight: comparison.weight,
      notes: comparison.notes,
      raw_source: {
        seed_application_id: application.id
      }
    }));
  });

  for (const chunk of chunks(rows, CHUNK_SIZE)) {
    await client.insert("applicant_source_comparisons", chunk, { returning: "minimal" });
  }
}

async function deleteSourceComparisons(applicationIds: string[]) {
  if (applicationIds.length === 0) return;

  const baseUrl = normalizeSupabaseUrl(readRequiredEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]));
  const serviceRoleKey = readRequiredEnv(["SUPABASE_SERVICE_ROLE_KEY"]);

  for (const chunk of chunks(applicationIds, CHUNK_SIZE)) {
    const url = new URL("/rest/v1/applicant_source_comparisons", baseUrl);
    url.searchParams.set("application_id", `in.(${chunk.join(",")})`);

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        prefer: "return=minimal"
      }
    });

    if (!response.ok) {
      throw new Error(`Unable to delete prior source comparisons: ${response.status} ${await response.text()}`);
    }
  }
}

function mutationOptions(onConflict: string, select: string): SupabaseMutationOptions {
  return { onConflict, select };
}

function approvalStatusToDb(status: ApprovalStatus) {
  if (status === "needsInfo") return "needs_info";
  if (status === "awaitingReply") return "awaiting_reply";
  return status;
}

function primaryActionToDb(action: EventApprovalApplication["primaryAction"]) {
  if (action === "sendInfo") return "send_info";
  if (action === "manualReview") return "manual_review";
  return action;
}

function submittedAtToIso(value: string) {
  const match = value.match(/^Jun 9, (\d{2}):(\d{2})$/);
  if (!match) return null;
  return `2026-06-09T${match[1]}:${match[2]}:00.000Z`;
}

function readOptions(): SeedOptions {
  const args = new Set(process.argv.slice(2));
  return {
    accountId: process.env.LUMA_ACCOUNT_ID?.trim() || DEFAULT_ACCOUNT_ID,
    dryRun: args.has("--dry-run")
  };
}

function printSummary(mode: string, events: LoadedLumaEvent[], applications: EventApprovalApplication[]) {
  const counts = applications.reduce<Record<string, number>>((summary, application) => {
    summary[application.status] = (summary[application.status] ?? 0) + 1;
    return summary;
  }, {});

  console.log(JSON.stringify({
    mode,
    events: events.length,
    applications: applications.length,
    counts
  }, null, 2));
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function readRequiredEnv(keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`${keys.join(" or ")} is required.`);
}

function normalizeSupabaseUrl(url: string) {
  return new URL(url).toString();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
