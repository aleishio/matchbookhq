import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getEventPrepData } from "../app/lib/event-prep-data";
import { createSupabaseServiceClientFromEnv } from "../app/lib/supabase/service-client";

type SeedPayload = {
  events?: Array<Record<string, unknown>>;
  companies?: Array<Record<string, unknown>>;
  founders?: Array<Record<string, unknown>>;
  attendance?: Array<Record<string, unknown>>;
  founder_needs?: Array<Record<string, unknown>>;
  notes?: Array<Record<string, unknown>>;
};

type RealLumaFixture = {
  events?: Array<Record<string, unknown>>;
  attendees?: Array<Record<string, unknown>>;
};

const SEED_PATH = join(process.cwd(), "data/seed.json");
const REAL_LUMA_EVENTS_PATH = join(process.cwd(), "data/luma-real-events.json");
const BATCH_SIZE = 100;

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const seed = readSeed();
  const realLumaFixture = readJson<RealLumaFixture>(REAL_LUMA_EVENTS_PATH) ?? {};
  const prepData = await getEventPrepData();
  const eventId = prepData.event.id;
  const client = createSupabaseServiceClientFromEnv();

  const rows = {
    events: buildEventRows(seed, realLumaFixture, prepData.event),
    companies: buildCompanyRows(seed),
    founders: buildFounderRows(seed),
    attendance: buildAttendanceRows(seed, realLumaFixture, prepData),
    needs: buildNeedRows(seed, prepData),
    notes: buildNoteRows(seed, prepData),
    intros: buildIntroRows(prepData, eventId)
  };

  console.log(JSON.stringify({
    dryRun,
    eventId,
    events: rows.events.length,
    companies: rows.companies.length,
    founders: rows.founders.length,
    attendance: rows.attendance.length,
    needs: rows.needs.length,
    notes: rows.notes.length,
    intros: rows.intros.length
  }, null, 2));

  if (dryRun) return;

  await upsertRows(client, "yc_events", rows.events, "id");
  await upsertRows(client, "yc_companies", rows.companies, "id");
  await upsertRows(client, "yc_founders", rows.founders, "id");
  await upsertRows(client, "yc_event_attendance", rows.attendance, "event_id,founder_id");
  await upsertRows(client, "yc_founder_needs", rows.needs, "id");
  await upsertRows(client, "yc_notes", rows.notes, "id");
  await upsertRows(client, "yc_intro_suggestions", rows.intros, "id");

  console.log("Seeded event prep data into Supabase.");
}

function readSeed(): SeedPayload {
  return readJson<SeedPayload>(SEED_PATH) ?? {};
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function buildEventRows(seed: SeedPayload, realLumaFixture: RealLumaFixture, fallbackEvent: {
  id: string;
  title: string;
  location: string;
  startsAt: string;
  attendeeCount: number;
  source: string;
}) {
  const event = realLumaFixture.events?.find((candidate) => candidate.id === fallbackEvent.id)
    ?? seed.events?.find((candidate) => candidate.id === fallbackEvent.id)
    ?? {
    id: fallbackEvent.id,
    title: fallbackEvent.title,
    location: fallbackEvent.location,
    attendee_count: fallbackEvent.attendeeCount,
    source: fallbackEvent.source
  };
  const source = objectValue(event.source);

  return [{
    id: String(event.id),
    title: stringValue(event.title) ?? fallbackEvent.title,
    location: stringValue(event.location) ?? fallbackEvent.location,
    starts_at: stringValue(event.starts_at),
    attendee_count: numberValue(event.attendee_count) ?? fallbackEvent.attendeeCount,
    source_kind: typeof event.source === "string" ? event.source : stringValue(source.kind) ?? fallbackEvent.source,
    source_url: stringValue(event.url) ?? stringValue(source.source_url),
    retrieved_at: stringValue(source.retrieved_at),
    metadata: {
      imported_at: stringValue(source.imported_at),
      luma_event_id: stringValue(event.luma_event_id),
      synced_at: stringValue(event.synced_at),
      raw_guest_count: numberValue(event.raw_guest_count),
      matched_founder_count: numberValue(event.matched_founder_count),
      approved_founder_count: numberValue(event.approved_founder_count),
      sanitized_fields_omitted: stringArray(event.sanitized_fields_omitted),
      raw_source: event.source ?? null
    }
  }];
}

function buildCompanyRows(seed: SeedPayload) {
  return (seed.companies ?? []).map((company) => ({
    id: String(company.id),
    source_id: stringValue(company.source_id),
    name: String(company.name),
    slug: stringValue(company.slug),
    batch: stringValue(company.batch),
    stage: stringValue(company.stage),
    category: stringValue(company.category),
    industry: stringValue(company.industry),
    subindustry: stringValue(company.subindustry),
    one_liner: stringValue(company.one_liner),
    long_description: stringValue(company.long_description),
    website: stringValue(company.website),
    yc_url: stringValue(company.yc_url),
    location: stringValue(company.location),
    city: stringValue(company.city),
    country: stringValue(company.country),
    team_size: numberValue(company.team_size),
    year_founded: numberValue(company.year_founded),
    is_hiring: booleanValue(company.is_hiring),
    top_company: booleanValue(company.top_company),
    tags: stringArray(company.tags),
    regions: stringArray(company.regions),
    primary_group_partner: objectOrNull(company.primary_group_partner),
    social_links: objectValue(company.social_links),
    image_paths: objectValue(company.image_paths),
    public_counts: objectValue(company.public_counts),
    metadata: {
      source_id: stringValue(company.source_id)
    }
  }));
}

function buildFounderRows(seed: SeedPayload) {
  return (seed.founders ?? []).map((founder) => ({
    id: String(founder.id),
    source_id: stringValue(founder.source_id),
    company_id: String(founder.company_id),
    name: String(founder.name),
    role: stringValue(founder.role),
    location: stringValue(founder.location),
    bio: stringValue(founder.bio),
    is_active: booleanValue(founder.is_active),
    has_public_email_flag: booleanValue(founder.has_public_email_flag),
    social_links: objectValue(founder.social_links),
    image_paths: objectValue(founder.image_paths),
    metadata: {
      initials_fallback: stringValue(objectValue(founder.image_paths).initials_fallback)
    }
  }));
}

function buildAttendanceRows(
  seed: SeedPayload,
  realLumaFixture: RealLumaFixture,
  prepData: Awaited<ReturnType<typeof getEventPrepData>>
) {
  const founderIndex = new Map((seed.founders ?? []).map((founder, index) => [String(founder.id), index]));
  const seedFoundersById = new Map((seed.founders ?? []).map((founder) => [String(founder.id), founder]));
  const seedAttendanceByFounderId = new Map((seed.attendance ?? []).map((attendance) => [String(attendance.founder_id), attendance]));
  const lumaAttendanceByFounderId = new Map(
    (realLumaFixture.attendees ?? [])
      .filter((attendance) => attendance.event_id === prepData.event.id)
      .map((attendance) => [String(attendance.founder_id), attendance])
  );

  return prepData.founders.map((founder, index) => {
    const lumaAttendance = lumaAttendanceByFounderId.get(founder.id);
    const seedAttendance = seedAttendanceByFounderId.get(founder.id);
    const seedFounder = seedFoundersById.get(founder.id);

    return {
      event_id: prepData.event.id,
      founder_id: founder.id,
      company_id: stringValue(seedFounder?.company_id) ?? founder.company.id,
      status: stringValue(lumaAttendance?.prep_status) ?? stringValue(seedAttendance?.status) ?? "attending",
      source: lumaAttendance ? "luma_sanitized_fixture" : stringValue(seedAttendance?.source),
      metadata: {
        source_id: stringValue(seedAttendance?.id),
        luma_status: stringValue(lumaAttendance?.luma_status),
        seed_index: founderIndex.get(founder.id) ?? index
      }
    };
  });
}

function buildNeedRows(seed: SeedPayload, prepData: Awaited<ReturnType<typeof getEventPrepData>>) {
  const attendeeIds = new Set(prepData.founders.map((founder) => founder.id));

  return (seed.founder_needs ?? [])
    .filter((need) => attendeeIds.has(String(need.founder_id)) && stringValue(need.need_text))
    .map((need) => ({
      id: `${prepData.event.id}_${String(need.id)}`,
      event_id: prepData.event.id,
      founder_id: String(need.founder_id),
      company_id: stringValue(need.company_id),
      need_text: String(need.need_text),
      need_category: stringValue(need.need_category),
      source: stringValue(need.source),
      source_url: stringValue(need.source_url),
      is_current: true,
      updated_at: stringValue(need.updated_at),
      metadata: {
        source: stringValue(need.source)
      }
    }));
}

function buildNoteRows(seed: SeedPayload, prepData: Awaited<ReturnType<typeof getEventPrepData>>) {
  const attendeeIds = new Set(prepData.founders.map((founder) => founder.id));
  const foundersById = new Map((seed.founders ?? []).map((founder) => [String(founder.id), founder]));

  return (seed.notes ?? [])
    .filter((note) => attendeeIds.has(String(note.founder_id)) && stringValue(note.body))
    .map((note) => {
      const founder = foundersById.get(String(note.founder_id));

      return {
        id: `${prepData.event.id}_${String(note.id)}`,
        event_id: prepData.event.id,
        founder_id: String(note.founder_id),
        company_id: stringValue(founder?.company_id),
        note_type: noteTypeValue(note.note_type),
        body: String(note.body),
        source_kind: stringValue(note.source),
        source_url: stringValue(note.source_url),
        created_at: stringValue(note.created_at),
        updated_at: stringValue(note.updated_at),
        metadata: {
          is_synthetic: true
        }
      };
    });
}

function buildIntroRows(
  prepData: Awaited<ReturnType<typeof getEventPrepData>>,
  eventId: string
) {
  return prepData.founders
    .filter((founder) => founder.intro)
    .map((founder) => {
      const intro = founder.intro;
      if (!intro) throw new Error("intro should be present after filter");

      return {
        id: `${eventId}_${founder.id}_${intro.targetFounderId}_event_prep_v1`,
        event_id: eventId,
        from_founder_id: founder.id,
        to_founder_id: intro.targetFounderId,
        fit_label: intro.fitLabel,
        reason: intro.reason,
        opener: intro.opener,
        caution: intro.caution,
        evidence: intro.evidence,
        same_company: intro.sameCompany ?? false,
        algorithm_version: "event_prep_v1"
      };
    });
}

async function upsertRows(
  client: ReturnType<typeof createSupabaseServiceClientFromEnv>,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string
) {
  const normalizedRows = normalizeRows(rows);

  for (let index = 0; index < normalizedRows.length; index += BATCH_SIZE) {
    const chunk = normalizedRows.slice(index, index + BATCH_SIZE);
    if (chunk.length === 0) continue;
    await client.upsert<Record<string, unknown>>(table, chunk, {
      onConflict,
      returning: "minimal"
    });
  }
}

function normalizeRows(rows: Array<Record<string, unknown>>) {
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));

  return rows.map((row) => Object.fromEntries(
    [...keys].map((key) => [key, row[key] ?? null])
  ));
}

function noteTypeValue(value: unknown) {
  if (value === "office_hours" || value === "other_founder" || value === "room" || value === "user") return value;
  return "room";
}

function objectOrNull(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
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
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}
