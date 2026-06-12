import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  suggestIntrosForFounder,
  type FounderForMatching,
  type IntroSuggestion
} from "@/lib/matching";
import {
  getFounderNotesView,
  normalizeNotes,
  type Note
} from "@/lib/notes";
import {
  listLocalApprovalDecisionSnapshots,
  localApprovalDecisionVersion
} from "./event-approval-decisions";

export type FitLabel = "strong" | "good" | "check";
export type NoteType = "Office hours" | "Founder note" | "Room note" | "Local note";

export type EventPrepNote = {
  id: string;
  type: NoteType;
  body: string;
  source?: string;
  createdAt?: string;
};

export type EventPrepContactKind = "yc_profile" | "linkedin" | "website" | "social";

export type EventPrepContactRoute = {
  kind: EventPrepContactKind;
  label: string;
  value: string;
  url: string;
};

export type EventPrepIntroRoute = {
  recommendedBy: string;
  recommenderRole: string;
  channel: string;
  instruction: string;
  contacts: EventPrepContactRoute[];
};

export type EventPrepPublicContactSource = {
  companyLinkedin?: string | null;
  github?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  website?: string | null;
  ycCompanyUrl?: string | null;
  ycUrl?: string | null;
};

export type EventPrepIntro = {
  targetFounderId: string;
  fitLabel: FitLabel;
  reason: string;
  opener: string;
  caution?: string;
  evidence: string[];
  sameCompany?: boolean;
  route?: EventPrepIntroRoute;
};

export type EventPrepFounder = {
  id: string;
  name: string;
  role: string;
  photoUrl?: string;
  company: {
    id: string;
    name: string;
    batch: string;
    stage: string;
    category: string;
    oneLiner: string;
    website?: string;
    ycUrl?: string;
  };
  contactRoutes?: EventPrepContactRoute[];
  location: string;
  ask: string;
  need: string;
  introCount: number;
  cautionCount: number;
  intro?: EventPrepIntro;
  notes: EventPrepNote[];
};

export type EventPrepMode = "example" | "live";

export type EventPrepEvent = {
  id: string;
  title: string;
  location: string;
  startsAt: string;
  attendeeCount: number;
  source: string;
  sourceUrl?: string;
  mode?: EventPrepMode;
};

export type EventPrepData = {
  event: EventPrepEvent;
  founders: EventPrepFounder[];
};

type SeedEvent = {
  id: string;
  title: string;
  location?: string;
  starts_at?: string;
  attendee_count?: number;
  url?: string;
  source?: { kind?: string; source_url?: string } | string;
};

type SeedCompany = {
  id: string;
  name: string;
  batch?: string;
  stage?: string;
  category?: string;
  industry?: string;
  subindustry?: string;
  one_liner?: string;
  long_description?: string;
  website?: string;
  yc_url?: string;
  social_links?: Record<string, string | null | undefined>;
};

type SeedFounder = {
  id: string;
  name: string;
  company_id: string;
  role?: string;
  location?: string;
  bio?: string;
  social_links?: Record<string, string | null | undefined>;
  image_paths?: {
    photo?: string;
    source_photo_url?: string;
    initials_fallback?: string;
  };
};

type SeedNeed = {
  founder_id: string;
  company_id?: string;
  need_text?: string;
  need_category?: string;
};

type SeedPayload = {
  events?: SeedEvent[];
  companies?: SeedCompany[];
  founders?: SeedFounder[];
  founder_needs?: SeedNeed[];
  notes?: unknown[];
};

type RealLumaEventFixture = {
  events?: RealLumaEvent[];
  attendees?: RealLumaAttendee[];
};

type RealLumaEvent = {
  id: string;
  luma_event_id?: string;
  title: string;
  url?: string;
  location?: string;
  starts_at?: string;
  source?: string;
};

type RealLumaAttendee = {
  event_id: string;
  founder_id: string;
  prep_status?: string;
};

type EventSource = SeedEvent | RealLumaEvent | EventPrepEvent;

const SEED_PATH = join(process.cwd(), "data/seed.json");
const REAL_LUMA_EVENTS_PATH = join(process.cwd(), "data/luma-real-events.json");
export const MAX_EVENT_PREP_DEMO_FOUNDERS = 415;
let cachedEventPrepData: EventPrepData | null = null;
let cachedEventPrepDataVersion = -1;
const cachedEventPrepDataByEventId = new Map<string, { data: EventPrepData; version: number }>();

export async function getEventPrepData(): Promise<EventPrepData> {
  const approvalDecisionVersion = localApprovalDecisionVersion();
  if (cachedEventPrepData && cachedEventPrepDataVersion === approvalDecisionVersion) return cachedEventPrepData;

  const seed = readJson<SeedPayload>(SEED_PATH);

  if (seed?.founders?.length && seed.companies?.length) {
    cachedEventPrepData = fromSeed(seed);
    cachedEventPrepDataVersion = approvalDecisionVersion;
    return cachedEventPrepData;
  }

  cachedEventPrepData = fallbackData();
  cachedEventPrepDataVersion = approvalDecisionVersion;
  return cachedEventPrepData;
}

export async function getEventPrepDataForEvent(event: EventPrepEvent): Promise<EventPrepData> {
  const cached = cachedEventPrepDataByEventId.get(event.id);
  const approvalDecisionVersion = localApprovalDecisionVersion();
  if (cached && cached.version === approvalDecisionVersion) return cached.data;

  const seed = readJson<SeedPayload>(SEED_PATH);

  if (seed?.founders?.length && seed.companies?.length) {
    const data = fromSeed(seed, { eventOverride: event });
    cachedEventPrepDataByEventId.set(event.id, { data, version: approvalDecisionVersion });
    return data;
  }

  const fallback = fallbackData();
  const data = {
    event: {
      ...event,
      attendeeCount: fallback.founders.length
    },
    founders: fallback.founders
  };
  cachedEventPrepDataByEventId.set(event.id, { data, version: approvalDecisionVersion });
  return data;
}

function fromSeed(
  seed: SeedPayload,
  options: { eventOverride?: EventPrepEvent } = {}
): EventPrepData {
  const realLumaFixture = readJson<RealLumaEventFixture>(REAL_LUMA_EVENTS_PATH);
  const realLumaEvent = realLumaFixture?.events?.[0];
  const event = options.eventOverride ?? realLumaEvent ?? seed.events?.[0];
  const realLumaAttendeeIds = new Set(
    (realLumaFixture?.attendees ?? [])
      .filter((attendee) => attendee.event_id === event?.id && attendee.prep_status === "attending")
      .map((attendee) => attendee.founder_id)
  );
  applyLocalApprovalPrepDecisions(realLumaAttendeeIds, event?.id);
  const companiesById = new Map((seed.companies ?? []).map((company) => [company.id, company]));
  const needsByFounderId = new Map((seed.founder_needs ?? []).map((need) => [need.founder_id, need]));
  const importedNotes = normalizeNotes(seed.notes ?? []);
  const seedFounders = (seed.founders ?? [])
    .filter((founder) => companiesById.has(founder.company_id))
    .filter((founder) => realLumaAttendeeIds.size === 0 || realLumaAttendeeIds.has(founder.id))
    .slice(0, MAX_EVENT_PREP_DEMO_FOUNDERS);
  const seedFoundersById = new Map(seedFounders.map((founder) => [founder.id, founder]));
  const matchingFounders = seedFounders.map((founder) =>
    toMatchingFounder(founder, companiesById.get(founder.company_id), needsByFounderId.get(founder.id))
  );
  const matchingById = new Map(matchingFounders.map((founder) => [founder.id, founder]));

  const founders = seedFounders.map((founder): EventPrepFounder => {
    const company = companiesById.get(founder.company_id);
    const need = needsByFounderId.get(founder.id);
    const suggestion = suggestIntrosForFounder(founder.id, candidatePoolFor(founder.id, matchingFounders), {
      max_suggestions_per_founder: 1,
      include_same_company_context: true
    })[0];
    const target = suggestion ? matchingById.get(suggestion.to_founder_id) : null;
    const targetFounder = target ? seedFoundersById.get(target.id) : undefined;
    const targetCompany = targetFounder ? companiesById.get(targetFounder.company_id) : undefined;
    const sameCompany = Boolean(
      target?.company_id && target.company_id === founder.company_id
    );
    const contactRoutes = contactRoutesFor(founder, company);
    const targetContactRoutes = contactRoutesFor(targetFounder, targetCompany);

    return {
      id: founder.id,
      name: founder.name,
      role: founder.role ?? "Founder",
      photoUrl: founder.image_paths?.photo,
      company: {
        id: company?.id ?? founder.company_id,
        name: company?.name ?? "Unknown company",
        batch: company?.batch ?? "W26",
        stage: displayStage(company?.stage),
        category: displayCategory(company),
        oneLiner: company?.one_liner ?? "Building a YC company.",
        website: company?.website,
        ycUrl: company?.yc_url
      },
      contactRoutes,
      location: founder.location ?? "Event attendee",
      ask: askFor(company, need),
      need: listNeedFor(need, company),
      introCount: suggestion && !sameCompany ? 1 : 0,
      cautionCount: suggestion?.caution ? 1 : 0,
      intro: suggestion ? toEventIntro(suggestion, sameCompany, {
        fromName: founder.name,
        targetCompanyName: target?.company_name ?? targetCompany?.name,
        targetContactRoutes,
        targetName: target?.name
      }) : undefined,
      notes: notesForFounder(importedNotes, founder, company, need, event?.id)
    };
  });

  return {
    event: eventFromSource(event, founders.length),
    founders
  };
}

function applyLocalApprovalPrepDecisions(attendeeIds: Set<string>, eventId?: string) {
  if (!eventId || attendeeIds.size === 0) return;

  for (const decision of listLocalApprovalDecisionSnapshots(eventId)) {
    if (decision.status === "approved") {
      attendeeIds.add(decision.founderId);
    } else {
      attendeeIds.delete(decision.founderId);
    }
  }
}

function candidatePoolFor(founderId: string, founders: FounderForMatching[]): FounderForMatching[] {
  const founder = founders.find((item) => item.id === founderId);
  if (!founder) return founders.slice(0, 40);

  const category = normalizeForPool(founder.category);
  const companyId = founder.company_id;
  const sameCategory = founders.filter(
    (item) => item.id !== founderId && normalizeForPool(item.category) === category
  );
  const sameCompany = founders.filter(
    (item) => item.id !== founderId && Boolean(companyId) && item.company_id === companyId
  );
  const aiPool = isAiForPool(founder)
    ? founders.filter((item) => item.id !== founderId && isAiForPool(item))
    : [];
  const fallback = founders.filter((item) => item.id !== founderId).slice(0, 16);
  const uniqueCandidates = uniqueById([founder, ...sameCategory, ...sameCompany, ...aiPool, ...fallback]);

  return uniqueCandidates.slice(0, 48);
}

function uniqueById(founders: FounderForMatching[]): FounderForMatching[] {
  const seen = new Set<string>();
  const result: FounderForMatching[] = [];

  for (const founder of founders) {
    if (seen.has(founder.id)) continue;
    seen.add(founder.id);
    result.push(founder);
  }

  return result;
}

function normalizeForPool(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase();
}

function isAiForPool(founder: FounderForMatching): boolean {
  return `${founder.category ?? ""} ${founder.one_liner ?? ""} ${founder.need_text ?? ""}`
    .toLowerCase()
    .includes("ai");
}

function toMatchingFounder(
  founder: SeedFounder,
  company: SeedCompany | undefined,
  need: SeedNeed | undefined
): FounderForMatching {
  return {
    id: founder.id,
    name: founder.name,
    company_id: founder.company_id,
    company_name: company?.name,
    role: founder.role,
    location: founder.location,
    batch: company?.batch,
    stage: displayStage(company?.stage),
    category: displayCategory(company),
    one_liner: company?.one_liner,
    website: company?.website,
    yc_url: company?.yc_url,
    need_text: need?.need_text,
    ask: need?.need_text,
    tags: [
      displayCategory(company),
      company?.industry,
      company?.subindustry,
      need?.need_category
    ].filter((value): value is string => Boolean(value))
  };
}

function toEventIntro(
  suggestion: IntroSuggestion,
  sameCompany: boolean,
  routeInput: {
    fromName: string;
    targetCompanyName?: string | null;
    targetContactRoutes: EventPrepContactRoute[];
    targetName?: string | null;
  }
): EventPrepIntro {
  return {
    targetFounderId: suggestion.to_founder_id,
    fitLabel: suggestion.fit_label,
    reason: suggestion.reason,
    opener: suggestion.opener,
    caution: suggestion.caution ?? undefined,
    evidence: suggestion.evidence.map((item) => item.label).filter(unique),
    sameCompany,
    route: introRouteFor(routeInput, sameCompany)
  };
}

export function introRouteFor(
  input: {
    fromName: string;
    targetCompanyName?: string | null;
    targetContactRoutes?: EventPrepContactRoute[];
    targetName?: string | null;
  },
  sameCompany = false
): EventPrepIntroRoute {
  const targetName = input.targetName?.trim() || "the target founder";
  const fromName = input.fromName.trim() || "the founder";
  const contacts = input.targetContactRoutes ?? [];
  const firstContact = contacts[0];

  if (sameCompany) {
    return {
      recommendedBy: targetName,
      recommenderRole: `${input.targetCompanyName ?? "Same company"} context`,
      channel: firstContact?.label ?? "In-person context",
      instruction: `Ask ${targetName} for context before meeting ${fromName}.`,
      contacts
    };
  }

  return {
    recommendedBy: "YC OS Assistant",
    recommenderRole: "Event prep recommender",
    channel: firstContact?.label ?? "In-room intro",
    instruction: `Have the assistant or host introduce ${firstName(fromName)} to ${firstName(targetName)}; use the public contact route if the room intro does not happen.`,
    contacts
  };
}

function contactRoutesFor(
  founder: Pick<SeedFounder, "social_links"> | undefined,
  company: Pick<SeedCompany, "social_links" | "website" | "yc_url"> | undefined
): EventPrepContactRoute[] {
  return publicContactRoutesFor({
    companyLinkedin: company?.social_links?.linkedin,
    github: company?.social_links?.github,
    linkedin: founder?.social_links?.linkedin,
    twitter: founder?.social_links?.twitter ?? company?.social_links?.twitter,
    website: company?.website,
    ycCompanyUrl: founder?.social_links?.yc_company,
    ycUrl: company?.yc_url
  });
}

export function publicContactRoutesFor(source: EventPrepPublicContactSource): EventPrepContactRoute[] {
  const routes: EventPrepContactRoute[] = [
    contactRoute("yc_profile", "YC profile", source.ycUrl ?? source.ycCompanyUrl),
    contactRoute("linkedin", "LinkedIn", source.linkedin),
    contactRoute("website", "Website", source.website),
    contactRoute("social", "Company LinkedIn", source.companyLinkedin),
    contactRoute("social", "X", source.twitter),
    contactRoute("social", "GitHub", source.github)
  ].filter((route): route is EventPrepContactRoute => Boolean(route));

  return uniqueContactRoutes(routes).slice(0, 3);
}

function contactRoute(
  kind: EventPrepContactKind,
  label: string,
  url: string | null | undefined
): EventPrepContactRoute | undefined {
  const normalized = url?.trim();
  if (!normalized || !/^https?:\/\//i.test(normalized)) return undefined;

  return {
    kind,
    label,
    url: normalized,
    value: contactValue(normalized)
  };
}

function uniqueContactRoutes(routes: EventPrepContactRoute[]) {
  const seen = new Set<string>();
  const uniqueRoutes: EventPrepContactRoute[] = [];

  for (const route of routes) {
    if (seen.has(route.url)) continue;
    seen.add(route.url);
    uniqueRoutes.push(route);
  }

  return uniqueRoutes;
}

function notesForFounder(
  notes: Note[],
  founder: SeedFounder,
  company: SeedCompany | undefined,
  need: SeedNeed | undefined,
  eventId?: string
): EventPrepNote[] {
  const view = getFounderNotesView(
    notes,
    {
      id: founder.id,
      name: founder.name,
      companyName: company?.name,
      category: displayCategory(company),
      needText: need?.need_text,
      location: founder.location
    },
    { eventId }
  );

  return view.notes.map((note): EventPrepNote => ({
    id: note.id,
    type: toEventNoteType(note.type),
    body: note.body,
    source: note.source.label ?? note.source.kind,
    createdAt: note.createdAt
  }));
}

function toEventNoteType(type: Note["type"]): NoteType {
  if (type === "office_hours") return "Office hours";
  if (type === "other_founder") return "Founder note";
  if (type === "room") return "Room note";
  return "Local note";
}

function askFor(company: SeedCompany | undefined, need: SeedNeed | undefined): string {
  if (need?.need_text) return need.need_text;
  if (company?.long_description) return trimTo(cleanText(company.long_description), 220);
  if (company?.one_liner) return `Meet founders who can compare notes on ${company.one_liner.toLowerCase()}.`;
  return "Meet founders with adjacent customer, hiring, fundraising, or product context.";
}

function listNeedFor(need: SeedNeed | undefined, company: SeedCompany | undefined): string {
  const rawNeed = need?.need_text ?? company?.one_liner ?? "adjacent founder context";
  return `Need: ${trimTo(cleanText(rawNeed), 120)}`;
}

function displayStage(stage?: string): string {
  if (!stage || stage.toLowerCase() === "early") return "Seed";
  return stage;
}

function displayCategory(company?: SeedCompany): string {
  const category = company?.category ?? company?.subindustry ?? company?.industry;
  if (!category) return "Founder";
  if (/ai/i.test(category) && /infra|developer|model|agent/i.test(`${category} ${company?.one_liner ?? ""}`)) {
    return "AI infra";
  }
  return category;
}

function eventFromSource(event: EventSource | undefined, founderCount: number): EventPrepEvent {
  return {
    id: event?.id ?? "yc-w26-event-prep",
    title: event?.title ?? "YC Founder Mixer - Tonight",
    location: event?.location ?? "San Francisco",
    startsAt: eventStartsAt(event),
    attendeeCount: founderCount,
    source: sourceLabel(event),
    sourceUrl: eventSourceUrl(event),
    mode: eventMode(event)
  };
}

function eventStartsAt(event?: EventSource): string {
  if (!event) return "7pm";
  if ("startsAt" in event) return event.startsAt;
  return formatEventTime(event.starts_at);
}

function sourceLabel(event?: EventSource): string {
  if (!event) return "public YC seed";
  if ("startsAt" in event) return event.source;
  const source = event.source;
  if (typeof source === "string") return source;
  if (source?.kind) return source.kind.replaceAll("_", " ");
  return "public YC seed";
}

function eventSourceUrl(event?: EventSource): string | undefined {
  if (!event) return undefined;
  if ("startsAt" in event) return event.sourceUrl;
  if (typeof event.url === "string" && event.url.trim()) return event.url.trim();
  if (typeof event.source === "object" && typeof event.source.source_url === "string" && event.source.source_url.trim()) {
    return event.source.source_url.trim();
  }
  return undefined;
}

function eventMode(event?: EventSource): EventPrepMode {
  if (!event) return "example";
  if ("startsAt" in event) {
    if (event.mode) return event.mode;
    return `${event.source} ${event.sourceUrl ?? ""}`.toLowerCase().includes("luma") ? "live" : "example";
  }

  const text = `${typeof event.source === "string" ? event.source : event.source?.kind ?? ""} ${event.url ?? ""}`.toLowerCase();
  return text.includes("luma") ? "live" : "example";
}

function formatEventTime(value?: string): string {
  if (!value) return "7pm";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles"
  }).format(date);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimTo(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trim()}...`;
}

function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}

function contactValue(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function unique(value: string, index: number, list: string[]): boolean {
  return Boolean(value) && list.indexOf(value) === index;
}

function fallbackData(): EventPrepData {
  const founders: EventPrepFounder[] = [
    {
      id: "demo-devi",
      name: "Devi Jha",
      role: "Founder",
      company: {
        id: "demo-cardinal",
        name: "Cardinal",
        batch: "W26",
        stage: "Seed",
        category: "AI",
        oneLiner: "AI platform for precision outbound."
      },
      location: "San Francisco",
      ask: "Find founders and sales leaders who need precision outbound and can compare AI GTM workflows.",
      need: "Need: compare founder-led outbound with teams seeing real pipeline pressure.",
      introCount: 1,
      cautionCount: 0,
      intro: {
        targetFounderId: "demo-noah",
        fitLabel: "strong",
        reason: "Devi Jha and Noah Yin match on workflow automation and GTM urgency.",
        opener: "Devi, Noah is also turning messy ops signals into software. Compare when a workflow becomes urgent.",
        evidence: ["Workflow overlap", "GTM"]
      },
      notes: [
        {
          id: "demo-devi-office",
          type: "Office hours",
          body: "Current ask is concrete: compare outbound workflows with teams under pipeline pressure."
        },
        {
          id: "demo-devi-room",
          type: "Room note",
          body: "Good candidate for an early in-person intro."
        }
      ]
    },
    {
      id: "demo-noah",
      name: "Noah Yin",
      role: "Founder",
      company: {
        id: "demo-pollen",
        name: "Pollen",
        batch: "W26",
        stage: "Seed",
        category: "Ops",
        oneLiner: "Workflow software for operational teams."
      },
      location: "San Francisco",
      ask: "Find design partners with dense operational workflows.",
      need: "Need: find design partners with dense operational workflows.",
      introCount: 1,
      cautionCount: 0,
      notes: []
    }
  ];

  return {
    event: {
      id: "demo-event",
      title: "YC Founder Mixer - Tonight",
      location: "San Francisco",
      startsAt: "7pm",
      attendeeCount: founders.length,
      source: "fallback demo",
      mode: "example"
    },
    founders
  };
}
