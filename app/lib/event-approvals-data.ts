import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sortApprovalEventsForDisplay } from "./event-directory";
import type { EventPrepFounder } from "./event-prep-data";
import type {
  ApprovalAction,
  ApprovalEvidence,
  ApprovalLens,
  ApprovalStatus,
  AiApprovalRecommendation,
  ApplicantSourceComparison,
  ClarificationRequest,
  EventApprovalApplication,
  EventApprovalsData,
  LumaApplicationPayload,
  LoadedLumaEvent,
  ParsedReply
} from "./event-approvals-types";

export type {
  ApprovalAction,
  ApprovalEvidence,
  ApprovalLens,
  ApprovalStatus,
  AiApprovalRecommendation,
  ApplicantSourceComparison,
  ClarificationRequest,
  EventApprovalApplication,
  EventApprovalsData,
  LumaApplicationPayload,
  LoadedLumaEvent,
  ParsedReply
} from "./event-approvals-types";

type SeedCompany = {
  id: string;
  name: string;
  batch?: string;
  stage?: string;
  category?: string;
  industry?: string;
  subindustry?: string;
  one_liner?: string;
  website?: string;
  yc_url?: string;
};

type SeedFounder = {
  id: string;
  name: string;
  company_id: string;
  role?: string;
  location?: string;
  image_paths?: {
    photo?: string;
  };
};

type SeedPayload = {
  companies?: SeedCompany[];
  founders?: SeedFounder[];
};

type RealLumaEventFixture = {
  events?: RealLumaEvent[];
  attendees?: RealLumaAttendee[];
};

type RealLumaEvent = {
  id: string;
  luma_event_id: string;
  title: string;
  url?: string;
  location?: string;
  starts_at?: string;
  source?: string;
  synced_at?: string;
  raw_guest_count?: number;
  matched_founder_count?: number;
};

type RealLumaAttendee = {
  event_id: string;
  founder_id: string;
  luma_status: "approved" | "waitlist" | "declined" | "pending";
  review_status?: ApprovalStatus;
};

export const APPROVAL_LENSES: Array<{ id: ApprovalLens; label: string }> = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "needsInfo", label: "Needs info" },
  { id: "awaitingReply", label: "Awaiting" },
  { id: "manual", label: "Manual" },
  { id: "waitlist", label: "Waitlist" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" }
];

const EVENTS: LoadedLumaEvent[] = [
  {
    id: "yc-founder-mixer",
    title: "YC Founder Mixer",
    startsAt: "Tonight, 6:00 PM",
    location: "San Francisco",
    seats: 150,
    applicationCount: 600,
    source: "Lu.ma",
    seedId: "yc-founder-mixer",
    syncedAt: "2 min ago",
    url: "https://luma.com/yc-founder-mixer"
  },
  {
    id: "ai-infra-office-hours",
    title: "AI Infra Office Hours in SF",
    startsAt: "Thu, 4:00 PM",
    location: "Y Combinator",
    seats: 40,
    applicationCount: 86,
    source: "Lu.ma",
    seedId: "ai-infra-office-hours",
    syncedAt: "5 min ago",
    url: "https://luma.com/ai-infra-office-hours"
  },
  {
    id: "founder-dinner",
    title: "Women Founders Dinner",
    startsAt: "Fri, 7:00 PM",
    location: "San Francisco",
    seats: 30,
    applicationCount: 44,
    source: "Lu.ma",
    seedId: "founder-dinner",
    syncedAt: "8 min ago",
    url: "https://luma.com/women-founders-dinner"
  }
];

const EVENT_STATUS_COUNTS: Record<string, Array<{ status: ApprovalStatus; count: number }>> = {
  "yc-founder-mixer": [
    { status: "ready", count: 120 },
    { status: "needsInfo", count: 214 },
    { status: "awaitingReply", count: 66 },
    { status: "manual", count: 140 },
    { status: "waitlist", count: 60 }
  ],
  "ai-infra-office-hours": [
    { status: "ready", count: 24 },
    { status: "needsInfo", count: 31 },
    { status: "awaitingReply", count: 8 },
    { status: "manual", count: 18 },
    { status: "waitlist", count: 5 }
  ],
  "founder-dinner": [
    { status: "ready", count: 12 },
    { status: "needsInfo", count: 15 },
    { status: "awaitingReply", count: 5 },
    { status: "manual", count: 9 },
    { status: "waitlist", count: 3 }
  ]
};

const SEED_PATH = join(process.cwd(), "data/seed.json");
const REAL_LUMA_EVENTS_PATH = join(process.cwd(), "data/luma-real-events.json");
const MAX_APPROVAL_FOUNDERS = 415;
let cachedApprovalsData: EventApprovalsData | null = null;

export async function getEventApprovalsData(): Promise<EventApprovalsData> {
  if (cachedApprovalsData) return cachedApprovalsData;

  const founders = approvalFoundersFromSeed();
  const fixture = readJson<RealLumaEventFixture>(REAL_LUMA_EVENTS_PATH);
  const realEvents = realLumaEventsForApprovals(fixture);
  const realAttendeesByEventId = realLumaAttendeesByEventId(fixture);
  const sourceEvents = [...EVENTS, ...realEvents];
  const sourceEventIndexById = new Map(sourceEvents.map((event, index) => [event.id, index]));
  const events = sortApprovalEventsForDisplay(sourceEvents);

  cachedApprovalsData = {
    events,
    applications: events.flatMap((event) =>
      buildApplicationsForEvent(
        event,
        founders,
        sourceEventIndexById.get(event.id) ?? 0,
        realAttendeesByEventId.get(event.id)
      )
    )
  };

  return cachedApprovalsData;
}

function approvalFoundersFromSeed(): EventPrepFounder[] {
  const seed = readJson<SeedPayload>(SEED_PATH);
  const companiesById = new Map((seed?.companies ?? []).map((company) => [company.id, company]));
  const seedFounders = (seed?.founders ?? [])
    .filter((founder) => companiesById.has(founder.company_id))
    .slice(0, MAX_APPROVAL_FOUNDERS);

  if (seedFounders.length === 0) return fallbackFounders();

  return seedFounders.map((founder): EventPrepFounder => {
    const company = companiesById.get(founder.company_id);

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
      location: founder.location ?? "Event attendee",
      ask: "Review event application.",
      need: "Event approval review",
      introCount: 0,
      cautionCount: 0,
      notes: []
    };
  });
}

function realLumaEventsForApprovals(fixture: RealLumaEventFixture | null): LoadedLumaEvent[] {
  return (fixture?.events ?? []).map((event) => ({
    id: event.id,
    lumaApiId: event.luma_event_id,
    title: event.title,
    startsAt: formatApprovalEventTime(event.starts_at),
    location: event.location ?? "San Francisco",
    seats: 0,
    applicationCount: event.matched_founder_count ?? event.raw_guest_count ?? 0,
    seedId: event.id,
    source: event.source ?? "Lu.ma API",
    syncedAt: syncedLabel(event.synced_at),
    url: event.url
  }));
}

function realLumaAttendeesByEventId(fixture: RealLumaEventFixture | null) {
  const attendeesByEventId = new Map<string, RealLumaAttendee[]>();

  for (const attendee of fixture?.attendees ?? []) {
    const attendees = attendeesByEventId.get(attendee.event_id) ?? [];
    attendees.push(attendee);
    attendeesByEventId.set(attendee.event_id, attendees);
  }

  return attendeesByEventId;
}

export function summarizeApprovalStatuses(applications: EventApprovalApplication[]) {
  return APPROVAL_LENSES.reduce<Record<ApprovalLens, number>>((counts, lens) => {
    counts[lens.id] = lens.id === "all"
      ? applications.length
      : applications.filter((application) => application.status === lens.id).length;
    return counts;
  }, {} as Record<ApprovalLens, number>);
}

function buildApplicationsForEvent(
  event: LoadedLumaEvent,
  founders: EventPrepFounder[],
  eventIndex: number,
  realLumaAttendees?: RealLumaAttendee[]
): EventApprovalApplication[] {
  if (realLumaAttendees?.length) {
    const foundersById = new Map(founders.map((founder) => [founder.id, founder]));

    return realLumaAttendees.flatMap((attendee, index) => {
      const founder = foundersById.get(attendee.founder_id);
      if (!founder) return [];

      return toApplication(event, founder, approvalStatusForRealLuma(attendee), index, {
        importedFinalStatus: attendee.review_status === undefined
      });
    });
  }

  const statuses = expandStatuses(EVENT_STATUS_COUNTS[event.id] ?? []);

  return statuses.map((status, index) => {
    const founder = founders[(index + eventIndex * 17) % founders.length];
    return toApplication(event, founder, status, index);
  });
}

function expandStatuses(statusCounts: Array<{ status: ApprovalStatus; count: number }>): ApprovalStatus[] {
  return statusCounts.flatMap(({ status, count }) => Array.from({ length: count }, () => status));
}

function approvalStatusForRealLuma(attendee: RealLumaAttendee): ApprovalStatus {
  if (attendee.review_status) return attendee.review_status;
  if (attendee.luma_status === "approved") return "approved";
  if (attendee.luma_status === "declined") return "rejected";
  return "waitlist";
}

function toApplication(
  event: LoadedLumaEvent,
  founder: EventPrepFounder,
  status: ApprovalStatus,
  index: number,
  options: {
    importedFinalStatus?: boolean;
  } = {}
): EventApprovalApplication {
  const applicant = fixtureApplicantFor(event, founder, status, index);
  const relation = relationFor(applicant, status, index);
  const confidence = confidenceFor(status, index);
  const email = emailFor(applicant, status, index);
  const phone = phoneFor(index);
  const submittedAt = submittedAtFor(index);
  const evidence = evidenceFor(applicant, status, email, phone);
  const lumaPayload = lumaPayloadFor(event, applicant, status, index, email, phone, submittedAt);
  const sourceComparisons = sourceComparisonsFor(applicant, status, email, phone);
  const aiRecommendation = aiRecommendationFor(status, relation, sourceComparisons, index);
  const clarificationRequest = needsClarification(status)
    ? clarificationFor(applicant, event)
    : undefined;
  const parsedReply = parsedReplyFor(status, applicant, index);

  return {
    id: `${event.id}-application-${String(index + 1).padStart(3, "0")}`,
    eventId: event.id,
    lumaId: `luma_${event.id}_${String(index + 1).padStart(4, "0")}`,
    founderId: applicant.id,
    name: applicant.name,
    email,
    phone,
    companyName: applicant.company.name,
    companyLine: `${applicant.company.name} | ${applicant.company.batch} | ${applicant.company.category}`,
    photoUrl: applicant.photoUrl,
    submittedAt,
    status,
    matchConfidence: confidence,
    relation,
    recommendation: recommendationFor(status, relation),
    rule: ruleFor(status),
    lumaStatus: lumaStatusFor(status, options.importedFinalStatus),
    primaryAction: primaryActionFor(status),
    selectedDefault: event.id === "yc-founder-mixer" && status === "ready" && index < 4,
    lumaPayload,
    sourceComparisons,
    aiRecommendation,
    evidence,
    audit: auditFor(status, confidence, relation),
    clarificationRequest,
    parsedReply
  };
}

function fixtureApplicantFor(
  event: LoadedLumaEvent,
  founder: EventPrepFounder,
  status: ApprovalStatus,
  index: number
): EventPrepFounder {
  if (event.id !== "yc-founder-mixer" || status !== "needsInfo" || index !== 120) return founder;

  return {
    ...founder,
    id: "test-aleix-ordeig",
    name: "Aleix Ordeig",
    role: "Founder",
    location: "San Francisco",
    company: {
      ...founder.company,
      id: "test-aleix-company",
      name: "Aleix Test Co",
      batch: "S24",
      category: "AI"
    }
  };
}

function relationFor(founder: EventPrepFounder, status: ApprovalStatus, index: number) {
  if (status === "manual" && index % 3 === 0) return "Investor network";
  if (status === "manual" && index % 3 === 1) return "Founder guest";
  if (status === "needsInfo") return "Possible YC founder";
  if (status === "awaitingReply") return "Unmapped applicant";
  if (status === "waitlist") return `Verified ${founder.company.batch} founder`;
  return `${founder.company.batch} founder`;
}

function confidenceFor(status: ApprovalStatus, index: number) {
  if (status === "ready") return 94 + (index % 6);
  if (status === "waitlist") return 86 + (index % 8);
  if (status === "awaitingReply") return 52 + (index % 10);
  if (status === "manual") return 44 + (index % 18);
  if (status === "approved") return 100;
  if (status === "rejected") return 0;
  return 61 + (index % 16);
}

function emailFor(founder: EventPrepFounder, status: ApprovalStatus, index: number) {
  if (founder.id === "test-aleix-ordeig") return "manual-review@example.com";

  const name = slugify(founder.name);
  const company = slugify(founder.company.name);

  if (status === "ready" || status === "waitlist") {
    return `${name}@${company || "company"}.example`;
  }

  if (status === "manual" && index % 3 === 0) {
    return `${name}.investor@example.com`;
  }

  return `${name}.${String(index + 1).padStart(3, "0")}@gmail.example`;
}

function phoneFor(index: number) {
  return `(415) 555-${String(1000 + (index % 9000)).slice(-4)}`;
}

function submittedAtFor(index: number) {
  const hour = 8 + (index % 11);
  const minute = (index * 7) % 60;
  return `Jun 9, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function evidenceFor(
  founder: EventPrepFounder,
  status: ApprovalStatus,
  email: string,
  phone: string
): ApprovalEvidence[] {
  if (status === "ready" || status === "waitlist") {
    return [
      { label: "Email", value: `${email} matches YC verified email`, tone: "ok" },
      { label: "Phone", value: `${phone} matches YC profile last four`, tone: "ok" },
      { label: "YC record", value: `${founder.company.batch} founder at ${founder.company.name}`, tone: "ok" }
    ];
  }

  if (status === "awaitingReply") {
    return [
      { label: "Email", value: "Clarification email sent from events.ycombinator.com", tone: "neutral" },
      { label: "Name", value: `Possible match to ${founder.name}`, tone: "warn" },
      { label: "Phone", value: "Applicant used a number not mapped to YC DB", tone: "warn" }
    ];
  }

  if (status === "manual") {
    return [
      { label: "Name", value: `Ambiguous name match to ${founder.name}`, tone: "warn" },
      { label: "Network", value: "Claims YC investor or founder guest relationship", tone: "neutral" },
      { label: "Email", value: "Email is not on a verified YC founder record", tone: "warn" }
    ];
  }

  return [
    { label: "Name", value: `Likely match to ${founder.name}`, tone: "neutral" },
    { label: "Email", value: "Personal email is not mapped in YC DB", tone: "warn" },
    { label: "Phone", value: "Phone number not found on verified records", tone: "warn" }
  ];
}

function lumaPayloadFor(
  event: LoadedLumaEvent,
  founder: EventPrepFounder,
  status: ApprovalStatus,
  index: number,
  email: string,
  phone: string,
  submittedAt: string
): LumaApplicationPayload {
  const guestId = `guest_${event.id}_${String(index + 1).padStart(4, "0")}`;
  const role = status === "manual" && index % 3 === 0
    ? "Investor in YC companies"
    : founder.role;

  return {
    guestId,
    eventApiId: event.lumaApiId ?? `evt-${event.id}`,
    approvalStatus: lumaApprovalStatusFor(status),
    registeredAt: submittedAt,
    name: founder.name,
    email,
    phone,
    registrationAnswers: {
      "YC company": status === "manual" && index % 3 === 0
        ? "Investor network"
        : founder.company.name,
      "YC batch": founder.company.batch,
      Role: role,
      LinkedIn: `https://linkedin.example/${slugify(founder.name)}`,
      "Why do you want to attend?": status === "needsInfo"
        ? "I am connected to YC but used my personal email."
        : "Meet other YC founders and the broader network."
    },
    rawFields: {
      calendar_source: event.source,
      event_capacity: event.seats,
      event_url: event.url ?? null,
      luma_guest_id: guestId,
      luma_guest_status: "pending",
      luma_approval_status: lumaApprovalStatusFor(status),
      application_rank: index + 1,
      answer_count: 5,
      used_personal_email: status !== "ready" && status !== "waitlist",
      imported_from_luma: true
    }
  };
}

function sourceComparisonsFor(
  founder: EventPrepFounder,
  status: ApprovalStatus,
  email: string,
  phone: string
): ApplicantSourceComparison[] {
  const expectedEmail = `${slugify(founder.name)}@${slugify(founder.company.name) || "company"}.example`;
  const verifiedContact = status === "ready" || status === "waitlist";
  const weakIdentity = status === "awaitingReply" || status === "manual";

  return [
    {
      field: "email",
      source: "yc_founder",
      lumaValue: email,
      ycValue: expectedEmail,
      result: verifiedContact ? "match" : status === "needsInfo" ? "missing" : "conflict",
      weight: 36,
      notes: verifiedContact
        ? "Lu.ma email matches a verified YC founder email or alias."
        : "Lu.ma email is not mapped to the YC founder record."
    },
    {
      field: "phone",
      source: "yc_founder",
      lumaValue: phone,
      ycValue: verifiedContact ? phone : "not mapped",
      result: verifiedContact ? "match" : "missing",
      weight: 22,
      notes: verifiedContact
        ? "Phone last four matches the YC profile contact record."
        : "Phone was present in Lu.ma but missing from YC contact records."
    },
    {
      field: "name",
      source: "yc_founder",
      lumaValue: founder.name,
      ycValue: founder.name,
      result: weakIdentity ? "partial" : "match",
      weight: 18,
      notes: weakIdentity
        ? "Name match exists but is insufficient without a mapped contact method."
        : "Name aligns with the YC founder directory record."
    },
    {
      field: "company",
      source: "yc_company",
      lumaValue: founder.company.name,
      ycValue: founder.company.name,
      result: status === "manual" ? "partial" : "match",
      weight: 14,
      notes: status === "manual"
        ? "Company or network claim needs a human check."
        : "Company answer aligns with YC directory data."
    },
    {
      field: "batch",
      source: "yc_company",
      lumaValue: founder.company.batch,
      ycValue: founder.company.batch,
      result: "match",
      weight: 10,
      notes: "Batch answer can be compared to the YC company record."
    },
    {
      field: "network",
      source: "yc_network",
      lumaValue: status === "manual" ? "claims investor or founder guest relationship" : "not claimed",
      ycValue: status === "manual" ? "network context found, not a founder identity" : "no separate network claim",
      result: status === "manual" ? "partial" : "not_checked",
      weight: status === "manual" ? 18 : 0,
      notes: status === "manual"
        ? "Network or investor context is useful for routing but not sufficient for auto-approval."
        : "No separate investor or guest claim was needed for this row."
    }
  ];
}

function aiRecommendationFor(
  status: ApprovalStatus,
  relation: string,
  comparisons: ApplicantSourceComparison[],
  index: number
): AiApprovalRecommendation {
  const matchWeight = comparisons.reduce((score, comparison) => {
    if (comparison.result === "match") return score + comparison.weight;
    if (comparison.result === "partial") return score + comparison.weight * 0.5;
    return score;
  }, 0);
  const signals = comparisons
    .filter((comparison) => comparison.result === "match" || comparison.result === "partial")
    .map((comparison) => `${comparison.field}: ${comparison.result}`);

  if (status === "ready") {
    return {
      decision: "approve",
      confidence: Math.min(99, 92 + Math.round(matchWeight / 20)),
      model: "event-approvals-rules-plus-ai",
      promptVersion: "event-approvals-v0",
      reviewedAt: aiReviewedAtFor(index),
      reason: `Approve candidate. Matched ${relation} across YC identity sources.`,
      signals
    };
  }

  if (status === "waitlist") {
    return {
      decision: "waitlist",
      confidence: 88,
      model: "event-approvals-rules-plus-ai",
      promptVersion: "event-approvals-v0",
      reviewedAt: aiReviewedAtFor(index),
      reason: "Verified YC identity, but event capacity should be resolved by ops.",
      signals
    };
  }

  if (status === "awaitingReply" && index % 2 === 0) {
    return {
      decision: "approve",
      confidence: 76,
      model: "event-approvals-rules-plus-ai",
      promptVersion: "event-approvals-v0",
      reviewedAt: aiReviewedAtFor(index),
      reason: "Parsed reply supplies company and batch; ops should confirm before writeback.",
      signals: [...signals, "reply: partial"]
    };
  }

  if (status === "manual") {
    return {
      decision: "manual",
      confidence: 58,
      model: "event-approvals-rules-plus-ai",
      promptVersion: "event-approvals-v0",
      reviewedAt: aiReviewedAtFor(index),
      reason: "Network context is plausible but does not prove a mapped YC identity.",
      signals
    };
  }

  return {
    decision: "send_info",
    confidence: 67,
    model: "event-approvals-rules-plus-ai",
    promptVersion: "event-approvals-v0",
    reviewedAt: aiReviewedAtFor(index),
    reason: "Name and company are plausible, but email or phone is missing from YC records.",
    signals
  };
}

function aiReviewedAtFor(index: number) {
  const minute = (index * 3) % 60;
  return `2026-06-09T10:${String(minute).padStart(2, "0")}:00Z`;
}

function clarificationFor(founder: EventPrepFounder, event: LoadedLumaEvent): ClarificationRequest {
  return {
    sentFrom: "events@events.ycombinator.com",
    subject: `Confirming your YC details for ${event.title}`,
    preview: `Hi ${firstName(founder.name)}, thanks for applying. We could not map the email or phone on your Lu.ma application to a YC profile. Please reply with your YC company, batch, and the best email connected to your YC account.`
  };
}

function parsedReplyFor(
  status: ApprovalStatus,
  founder: EventPrepFounder,
  index: number
): ParsedReply | undefined {
  if (status !== "manual" && status !== "awaitingReply") return undefined;
  if (status === "awaitingReply" && index % 2 === 1) return undefined;

  return {
    receivedAt: `Jun 9, ${String(12 + (index % 5)).padStart(2, "0")}:${String((index * 11) % 60).padStart(2, "0")}`,
    summary: `Applicant says they are connected to ${founder.company.name} and used a personal email on Lu.ma.`,
    extracted: [
      `Company: ${founder.company.name}`,
      `Batch: ${founder.company.batch}`,
      `Role: ${status === "manual" ? "investor or guest, needs ops check" : "founder"}`
    ],
    aiDecision: status === "manual" ? "manual" : "approve",
    reason: status === "manual"
      ? "Reply mentions YC context but does not prove the person controls a mapped YC email."
      : "Reply includes company, batch, and a YC email candidate for ops to confirm."
  };
}

function recommendationFor(status: ApprovalStatus, relation: string) {
  if (status === "ready") return `Approve. Identified as ${relation}.`;
  if (status === "waitlist") return "Verified, but hold for capacity before writing to Lu.ma.";
  if (status === "awaitingReply") return "Wait for applicant details or review the parsed reply.";
  if (status === "manual") return "Manual review. Relationship is plausible but not verified.";
  if (status === "approved") return "Approved by ops in YC OS.";
  if (status === "rejected") return "Rejected by ops in YC OS.";
  return "Ask for more information before approving or rejecting.";
}

function ruleFor(status: ApprovalStatus) {
  if (status === "ready") return "R1 exact email or alias match plus verified YC founder record";
  if (status === "waitlist") return "R2 verified YC record but event capacity is constrained";
  if (status === "awaitingReply") return "C2 clarification email sent, reply can be parsed before review";
  if (status === "manual") return "M1 network/investor claim requires human review";
  if (status === "approved") return "A1 user approved and synced to Lu.ma";
  if (status === "rejected") return "J1 user rejected and synced to Lu.ma";
  return "C1 name match exists but email or phone is not mapped";
}

function lumaStatusFor(status: ApprovalStatus, importedFinalStatus = false) {
  if (importedFinalStatus && status === "approved") return "Approved in Lu.ma";
  if (importedFinalStatus && status === "rejected") return "Declined in Lu.ma";
  if (importedFinalStatus && status === "waitlist") return "Waitlisted in Lu.ma";
  if (status === "approved") return "Approved in Lu.ma";
  if (status === "rejected") return "Declined in Lu.ma";
  return "Pending in Lu.ma";
}

function lumaApprovalStatusFor(status: ApprovalStatus) {
  if (status === "approved") return "approved";
  if (status === "rejected") return "declined";
  if (status === "waitlist") return "waitlist";
  return "pending_approval";
}

function primaryActionFor(status: ApprovalStatus): ApprovalAction {
  if (status === "ready") return "approve";
  if (status === "needsInfo") return "sendInfo";
  if (status === "awaitingReply") return "manualReview";
  if (status === "manual") return "manualReview";
  if (status === "waitlist") return "waitlist";
  return "none";
}

function needsClarification(status: ApprovalStatus) {
  return status === "needsInfo" || status === "awaitingReply" || status === "manual";
}

function auditFor(status: ApprovalStatus, confidence: number, relation: string) {
  if (status === "ready") {
    return [
      "High-confidence match from email, phone, and YC profile.",
      `Relationship classified as ${relation}.`,
      "No block flags found. Safe for user-triggered bulk approval."
    ];
  }

  if (status === "waitlist") {
    return [
      "Verified from YC records.",
      "Event has more verified applicants than seats.",
      "Keep pending until ops chooses final capacity."
    ];
  }

  if (status === "awaitingReply") {
    return [
      "Clarification email was sent from events.ycombinator.com.",
      "Keep Lu.ma application pending until reply is parsed or reviewed.",
      confidence >= 60 ? "Possible YC identity match remains open." : "Identity match remains weak."
    ];
  }

  if (status === "manual") {
    return [
      "Applicant appears in network context but not as a verified founder record.",
      "Review dossier, reply, or team notes before deciding.",
      confidence >= 55 ? "Manual reviewer should verify the network claim." : "Manual reviewer should treat the claim as low-confidence."
    ];
  }

  return [
    confidence >= 70 ? "Name search found a plausible YC record." : "Name search found a weak possible YC record.",
    "Email and phone did not match verified YC data.",
    "Send clarification before approving or rejecting."
  ];
}

function fallbackFounders(): EventPrepFounder[] {
  return [
    {
      id: "fallback-founder",
      name: "YC Founder",
      role: "Founder",
      company: {
        id: "fallback-company",
        name: "DemoCo",
        batch: "W26",
        stage: "Seed",
        category: "AI",
        oneLiner: "Building YC OS."
      },
      location: "San Francisco",
      ask: "Meet other YC founders.",
      need: "Event approval review",
      introCount: 0,
      cautionCount: 0,
      notes: []
    }
  ];
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function formatApprovalEventTime(value?: string) {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles"
  }).format(date);
}

function syncedLabel(value?: string) {
  if (!value) return "from Lu.ma API";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "from Lu.ma API";

  return `synced ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles"
  }).format(date)}`;
}

function displayStage(stage?: string) {
  if (!stage) return "Seed";
  return stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayCategory(company?: SeedCompany) {
  return company?.category ?? company?.subindustry ?? company?.industry ?? "Startup";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 48);
}

function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}
