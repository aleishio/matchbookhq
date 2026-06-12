import { createHash } from "node:crypto";

import {
  getEventApprovalsData,
  summarizeApprovalStatuses,
  type ApprovalLens,
  type ApprovalStatus,
  type EventApprovalApplication,
  type LoadedLumaEvent
} from "./event-approvals-data";
import {
  filterApprovalApplications,
  summarizeApprovalSegments,
  type ApprovalSegment as UiApprovalSegment
} from "./event-approvals-filters";
import {
  canApprove,
  canReject,
  canSendInfo,
  transitionApplication
} from "./event-approvals-state";
import {
  applyLocalApprovalDecisions,
  recordLocalApprovalDecisions
} from "./event-approval-decisions";
import {
  DEFAULT_CLARIFICATION_EMAIL_BODY,
  DEFAULT_CLARIFICATION_EMAIL_SUBJECT,
  MAX_CLARIFICATION_EMAIL_BODY_LENGTH,
  MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH,
  type AiApprovalDecision
} from "./event-approvals-types";

export type ApprovalQueue =
  | "all"
  | "ready"
  | "needs_info"
  | "awaiting_reply"
  | "manual"
  | "waitlist"
  | "approved"
  | "rejected";

export type ApprovalSegment =
  | "all"
  | "yc_founders"
  | "possible_yc"
  | "investors"
  | "network"
  | "unmapped"
  | "capacity";

export type BulkApprovalAction = "approve" | "reject" | "send_info";
export type AiDecisionFilter = AiApprovalDecision | "all";

export type EventApprovalsQuery = {
  eventId: string;
  queue?: ApprovalQueue;
  segment?: ApprovalSegment;
  aiDecision?: AiDecisionFilter;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ApprovalQueueCounts = Record<ApprovalQueue, number>;
export type ApprovalSegmentCounts = Record<ApprovalSegment, number>;

export type EventApprovalsListResponse = {
  event: LoadedLumaEvent;
  applications: EventApprovalApplication[];
  total: number;
  page: number;
  pageSize: number;
  counts: ApprovalQueueCounts;
  segmentCounts: ApprovalSegmentCounts;
  query: Required<Omit<EventApprovalsQuery, "page" | "pageSize">> & {
    page: number;
    pageSize: number;
  };
};

export type ApprovalDossierResponse = {
  event: LoadedLumaEvent;
  application: EventApprovalApplication;
  sourceComparisons: EventApprovalApplication["sourceComparisons"];
  lumaPayload: EventApprovalApplication["lumaPayload"];
  aiRecommendation: EventApprovalApplication["aiRecommendation"];
  audit: string[];
};

export type ApprovalGuestRuntimeEvent = {
  at?: string;
  kind: string;
  status?: string;
  summary: string;
};

export type ApprovalGuestContextResponse = ApprovalDossierResponse & {
  contact: {
    email: string;
    phone: string;
  };
  guest: {
    lumaGuestId: string;
    lumaStatus: string;
    registrationAnswers: Record<string, string>;
  };
  runtime: {
    events: ApprovalGuestRuntimeEvent[];
    latestEmail?: {
      id?: string;
      resendEmailId?: string;
      sentAt?: string;
      status: string;
      subject?: string;
    };
    latestReply?: {
      receivedAt?: string;
      status: string;
      summary?: string;
    };
    latestWriteback?: {
      completedAt?: string;
      id?: string;
      lastError?: string;
      status: string;
      targetStatus?: string;
    };
  };
};

export type BulkApprovalRequest = {
  eventId: string;
  action: BulkApprovalAction;
  applicationIds?: string[];
  query?: Omit<EventApprovalsQuery, "eventId">;
  actorId?: string;
  actorName?: string;
  reason?: string;
  clarificationEmail?: ClarificationEmailInput;
  dryRun?: boolean;
};

export type ClarificationEmailInput = {
  subject?: string;
  body?: string;
};

export type NormalizedClarificationEmail = {
  subject: string;
  body: string;
  isCustom: boolean;
};

export type BulkOperationJob =
  | {
      type: "luma_writeback";
      provider: "luma";
      applicationId: string;
      lumaGuestId: string;
      targetStatus: "approved" | "declined";
      payload: Record<string, string>;
    }
  | {
      type: "clarification_email";
      provider: "resend";
      applicationId: string;
      to: string;
      from: string;
      subject: string;
      preview: string;
      payload: Record<string, string>;
    };

export type BulkApprovalResult = {
  operationId: string;
  eventId: string;
  action: BulkApprovalAction;
  dryRun: boolean;
  requestedCount: number;
  appliedCount: number;
  skippedCount: number;
  applications: EventApprovalApplication[];
  skipped: Array<{ applicationId: string; reason: string }>;
  jobs: BulkOperationJob[];
  writebackSync?: {
    status: "skipped" | "syncing" | "synced" | "retrying" | "not_configured";
    claimed: number;
    succeeded: number;
    failed: number;
  };
};

export class EventApprovalsRepositoryError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "EventApprovalsRepositoryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const QUEUE_TO_LENS: Record<ApprovalQueue, ApprovalLens> = {
  all: "all",
  ready: "ready",
  needs_info: "needsInfo",
  awaiting_reply: "awaitingReply",
  manual: "manual",
  waitlist: "waitlist",
  approved: "approved",
  rejected: "rejected"
};

const LENS_TO_QUEUE: Record<ApprovalLens, ApprovalQueue> = {
  all: "all",
  ready: "ready",
  needsInfo: "needs_info",
  awaitingReply: "awaiting_reply",
  manual: "manual",
  waitlist: "waitlist",
  approved: "approved",
  rejected: "rejected"
};

const SEGMENT_TO_UI: Record<ApprovalSegment, UiApprovalSegment> = {
  all: "all",
  yc_founders: "ycFounders",
  possible_yc: "possibleYc",
  investors: "investors",
  network: "network",
  unmapped: "unmapped",
  capacity: "capacity"
};

const UI_TO_SEGMENT: Record<UiApprovalSegment, ApprovalSegment> = {
  all: "all",
  ycFounders: "yc_founders",
  possibleYc: "possible_yc",
  investors: "investors",
  network: "network",
  unmapped: "unmapped",
  capacity: "capacity"
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function listApprovalEvents(): Promise<LoadedLumaEvent[]> {
  if (useSupabaseApprovals()) {
    const repository = await import("./event-approvals-supabase-repository");
    return repository.listApprovalEventsFromSupabase();
  }

  const data = await getEventApprovalsData();
  return data.events;
}

export async function listEventApprovals(
  query: EventApprovalsQuery
): Promise<EventApprovalsListResponse> {
  if (useSupabaseApprovals()) {
    const repository = await import("./event-approvals-supabase-repository");
    return repository.listEventApprovalsFromSupabase(query);
  }

  const normalized = normalizeApprovalsQuery(query);
  const data = await getEventApprovalsData();
  const event = getEventOrThrow(data.events, normalized.eventId);
  const eventApplications = applyLocalApprovalDecisions(
    data.applications.filter((application) => application.eventId === event.id)
  );
  const lens = QUEUE_TO_LENS[normalized.queue];
  const segment = SEGMENT_TO_UI[normalized.segment];
  const filteredApplications = filterByAiDecision(filterApprovalApplications(
    eventApplications,
    lens,
    segment,
    normalized.search
  ), normalized.aiDecision);
  const pageStart = (normalized.page - 1) * normalized.pageSize;

  return {
    event,
    applications: filteredApplications.slice(pageStart, pageStart + normalized.pageSize),
    total: filteredApplications.length,
    page: normalized.page,
    pageSize: normalized.pageSize,
    counts: queueCountsFor(eventApplications),
    segmentCounts: segmentCountsFor(
      eventApplications.filter((application) => lens === "all" || application.status === lens)
    ),
    query: normalized
  };
}

export async function getApprovalDossier(applicationId: string): Promise<ApprovalDossierResponse> {
  if (useSupabaseApprovals()) {
    const repository = await import("./event-approvals-supabase-repository");
    return repository.getApprovalDossierFromSupabase(applicationId);
  }

  const data = await getEventApprovalsData();
  const application = applyLocalApprovalDecisions(data.applications)
    .find((candidate) => candidate.id === applicationId);

  if (!application) {
    throw new EventApprovalsRepositoryError(
      "application_not_found",
      `No approval application found for ${applicationId}.`,
      404
    );
  }

  const event = getEventOrThrow(data.events, application.eventId);

  return {
    event,
    application,
    sourceComparisons: application.sourceComparisons,
    lumaPayload: application.lumaPayload,
    aiRecommendation: application.aiRecommendation,
    audit: application.audit
  };
}

export async function getApprovalGuestContext(applicationId: string): Promise<ApprovalGuestContextResponse> {
  if (useSupabaseApprovals()) {
    const repository = await import("./event-approvals-supabase-repository");
    return repository.getApprovalGuestContextFromSupabase(applicationId);
  }

  const dossier = await getApprovalDossier(applicationId);
  const application = dossier.application;
  const events: ApprovalGuestRuntimeEvent[] = [
    ...application.audit.map((summary) => ({
      kind: "audit",
      summary
    }))
  ];

  if (application.clarificationRequest) {
    events.push({
      kind: "clarification_email",
      status: "queued_or_sent",
      summary: application.clarificationRequest.subject
    });
  }

  if (application.parsedReply) {
    events.push({
      at: application.parsedReply.receivedAt,
      kind: "applicant_reply",
      status: application.parsedReply.aiDecision,
      summary: application.parsedReply.summary
    });
  }

  return {
    ...dossier,
    contact: {
      email: application.email,
      phone: application.phone
    },
    guest: {
      lumaGuestId: application.lumaPayload.guestId,
      lumaStatus: application.lumaStatus,
      registrationAnswers: application.lumaPayload.registrationAnswers
    },
    runtime: {
      events,
      latestEmail: application.clarificationRequest
        ? {
            status: "queued_or_sent",
            subject: application.clarificationRequest.subject
          }
        : undefined,
      latestReply: application.parsedReply
        ? {
            receivedAt: application.parsedReply.receivedAt,
            status: application.parsedReply.aiDecision,
            summary: application.parsedReply.summary
          }
        : undefined
    }
  };
}

export async function createBulkApprovalOperation(
  request: BulkApprovalRequest
): Promise<BulkApprovalResult> {
  if (useSupabaseApprovals()) {
    const repository = await import("./event-approvals-supabase-repository");
    return repository.createBulkApprovalOperationInSupabase(request);
  }

  const action = normalizeBulkAction(request.action);
  const clarificationEmail = action === "send_info"
    ? normalizeClarificationEmail(request.clarificationEmail)
    : undefined;
  const data = await getEventApprovalsData();
  const event = getEventOrThrow(data.events, request.eventId);
  const eventApplications = applyLocalApprovalDecisions(
    data.applications.filter((application) => application.eventId === event.id)
  );
  const targetApplications = selectBulkTargets(eventApplications, request);

  const applied: EventApprovalApplication[] = [];
  const skipped: Array<{ applicationId: string; reason: string }> = [];
  const jobs: BulkOperationJob[] = [];
  const auditMessage = bulkAuditMessage(action, request.actorName, request.reason);

  for (const application of targetApplications) {
    if (!isEligibleForBulkAction(application, action)) {
      skipped.push({
        applicationId: application.id,
        reason: ineligibleReasonFor(application, action)
      });
      continue;
    }

    const nextStatus = statusForBulkAction(action);
    const transitioned = transitionApplication(application, nextStatus, auditMessage);
    applied.push(transitioned);
    const job = jobForBulkAction(action, transitioned, clarificationEmail);
    if (job) jobs.push(job);
  }

  if (!request.dryRun) recordLocalApprovalDecisions(applied);

  return {
    operationId: operationIdFor(event.id, action, targetApplications.map((application) => application.id), clarificationEmail),
    eventId: event.id,
    action,
    dryRun: request.dryRun ?? false,
    requestedCount: targetApplications.length,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    applications: applied,
    skipped,
    jobs
  };
}

export function normalizeApprovalQueue(value?: string | null, fallback: ApprovalQueue = "all"): ApprovalQueue {
  if (!value) return fallback;
  if (isApprovalQueue(value)) return value;
  if (value === "needsInfo") return "needs_info";
  if (value === "awaitingReply") return "awaiting_reply";
  throw new EventApprovalsRepositoryError("invalid_queue", `Unsupported approval queue: ${value}.`);
}

export function normalizeApprovalSegment(
  value?: string | null,
  fallback: ApprovalSegment = "all"
): ApprovalSegment {
  if (!value) return fallback;
  if (isApprovalSegment(value)) return value;
  if (value === "ycFounders") return "yc_founders";
  if (value === "possibleYc") return "possible_yc";
  throw new EventApprovalsRepositoryError("invalid_segment", `Unsupported approval segment: ${value}.`);
}

export function normalizeBulkAction(value?: string | null): BulkApprovalAction {
  if (value === "approve" || value === "reject" || value === "send_info") return value;
  if (value === "sendInfo") return "send_info";
  throw new EventApprovalsRepositoryError("invalid_action", `Unsupported bulk approval action: ${value ?? ""}.`);
}

export function normalizeClarificationEmail(input?: ClarificationEmailInput): NormalizedClarificationEmail {
  const providedSubject = normalizeSubject(input?.subject);
  const providedBody = normalizeBody(input?.body);
  const subject = providedSubject || DEFAULT_CLARIFICATION_EMAIL_SUBJECT;
  const body = providedBody || DEFAULT_CLARIFICATION_EMAIL_BODY;

  if (subject.length > MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH) {
    throw new EventApprovalsRepositoryError(
      "invalid_clarification_email",
      `Clarification email subject must be ${MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH} characters or fewer.`
    );
  }

  if (body.length > MAX_CLARIFICATION_EMAIL_BODY_LENGTH) {
    throw new EventApprovalsRepositoryError(
      "invalid_clarification_email",
      `Clarification email body must be ${MAX_CLARIFICATION_EMAIL_BODY_LENGTH} characters or fewer.`
    );
  }

  return {
    subject,
    body,
    isCustom: subject !== DEFAULT_CLARIFICATION_EMAIL_SUBJECT || body !== DEFAULT_CLARIFICATION_EMAIL_BODY
  };
}

export function normalizeAiDecision(value?: string | null, fallback: AiDecisionFilter = "all"): AiDecisionFilter {
  if (!value) return fallback;
  if (value === "all" || value === "approve" || value === "send_info" || value === "manual" || value === "waitlist" || value === "reject") {
    return value;
  }
  if (value === "sendInfo") return "send_info";
  throw new EventApprovalsRepositoryError("invalid_ai_decision", `Unsupported AI decision filter: ${value}.`);
}

export function boundedInteger(value: string | number | null | undefined, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeApprovalsQuery(query: EventApprovalsQuery): Required<Omit<EventApprovalsQuery, "page" | "pageSize">> & {
  page: number;
  pageSize: number;
} {
  return {
    eventId: query.eventId,
    queue: normalizeApprovalQueue(query.queue, "all"),
    segment: normalizeApprovalSegment(query.segment, "all"),
    aiDecision: normalizeAiDecision(query.aiDecision, "all"),
    search: query.search?.trim() ?? "",
    page: boundedInteger(query.page, 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: boundedInteger(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  };
}

function selectBulkTargets(applications: EventApprovalApplication[], request: BulkApprovalRequest) {
  if (request.applicationIds?.length) {
    const requestedIds = new Set(request.applicationIds);
    return applications.filter((application) => requestedIds.has(application.id));
  }

  if (!request.query) {
    throw new EventApprovalsRepositoryError(
      "missing_bulk_scope",
      "Bulk operations require applicationIds or a query scope."
    );
  }

  const normalized = normalizeApprovalsQuery({
    eventId: request.eventId,
    ...request.query,
    page: request.query.page ?? 1,
    pageSize: request.query.pageSize ?? MAX_PAGE_SIZE
  });

  const filtered = filterByAiDecision(filterApprovalApplications(
    applications,
    QUEUE_TO_LENS[normalized.queue],
    SEGMENT_TO_UI[normalized.segment],
    normalized.search
  ), normalized.aiDecision);

  if (request.query.page !== undefined || request.query.pageSize !== undefined) {
    const pageStart = (normalized.page - 1) * normalized.pageSize;
    return filtered.slice(pageStart, pageStart + normalized.pageSize);
  }

  return filtered;
}

function queueCountsFor(applications: EventApprovalApplication[]): ApprovalQueueCounts {
  const counts = summarizeApprovalStatuses(applications);
  return Object.fromEntries(
    Object.entries(counts).map(([lens, count]) => [LENS_TO_QUEUE[lens as ApprovalLens], count])
  ) as ApprovalQueueCounts;
}

function segmentCountsFor(applications: EventApprovalApplication[]): ApprovalSegmentCounts {
  const counts = summarizeApprovalSegments(applications);
  return Object.fromEntries(
    Object.entries(counts).map(([segment, count]) => [UI_TO_SEGMENT[segment as UiApprovalSegment], count])
  ) as ApprovalSegmentCounts;
}

function filterByAiDecision(applications: EventApprovalApplication[], aiDecision: AiDecisionFilter) {
  if (aiDecision === "all") return applications;
  return applications.filter((application) => application.aiRecommendation.decision === aiDecision);
}

function getEventOrThrow(events: LoadedLumaEvent[], eventId: string): LoadedLumaEvent {
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) {
    throw new EventApprovalsRepositoryError("event_not_found", `No Lu.ma event found for ${eventId}.`, 404);
  }
  return event;
}

function isEligibleForBulkAction(application: EventApprovalApplication, action: BulkApprovalAction) {
  if (action === "approve") return canApprove(application);
  if (action === "reject") return canReject(application);
  return canSendInfo(application);
}

function statusForBulkAction(action: BulkApprovalAction): ApprovalStatus {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  return "awaitingReply";
}

function ineligibleReasonFor(application: EventApprovalApplication, action: BulkApprovalAction) {
  if (action === "approve") return `${application.status} applications are not eligible for approval.`;
  if (action === "send_info") return `${application.status} applications do not need clarification email.`;
  return `${application.status} applications cannot be rejected.`;
}

function jobForBulkAction(
  action: BulkApprovalAction,
  application: EventApprovalApplication,
  clarificationEmail?: NormalizedClarificationEmail
): BulkOperationJob | null {
  if (action === "approve" || action === "reject") {
    return {
      type: "luma_writeback",
      provider: "luma",
      applicationId: application.id,
      lumaGuestId: application.lumaPayload.guestId,
      targetStatus: action === "approve" ? "approved" : "declined",
      payload: {
        event_id: application.lumaPayload.eventApiId,
        guest_type: "api_id",
        guest_api_id: application.lumaPayload.guestId,
        status: action === "approve" ? "approved" : "declined"
      }
    };
  }

  return {
    type: "clarification_email",
    provider: "resend",
    applicationId: application.id,
    to: application.email,
    from: application.clarificationRequest?.sentFrom ?? "events@events.ycombinator.com",
    subject: clarificationEmail?.subject ?? application.clarificationRequest?.subject ?? DEFAULT_CLARIFICATION_EMAIL_SUBJECT,
    preview: clarificationEmail?.body ?? application.clarificationRequest?.preview ?? DEFAULT_CLARIFICATION_EMAIL_BODY,
    payload: {
      event_id: application.lumaPayload.eventApiId,
      guest_api_id: application.lumaPayload.guestId,
      template: "event_approval_clarification",
      subject: clarificationEmail?.subject ?? application.clarificationRequest?.subject ?? DEFAULT_CLARIFICATION_EMAIL_SUBJECT,
      body: clarificationEmail?.body ?? application.clarificationRequest?.preview ?? DEFAULT_CLARIFICATION_EMAIL_BODY,
      custom_copy: clarificationEmail?.isCustom ? "true" : "false"
    }
  };
}

function bulkAuditMessage(action: BulkApprovalAction, actorName?: string, reason?: string) {
  const actor = actorName?.trim() || "ops";
  const suffix = reason?.trim() ? ` Reason: ${reason.trim()}` : "";
  if (action === "approve") return `Bulk approved by ${actor} from YC OS.${suffix}`;
  if (action === "reject") return `Bulk rejected by ${actor} from YC OS.${suffix}`;
  return `Clarification email queued by ${actor} from events.ycombinator.com.${suffix}`;
}

function operationIdFor(
  eventId: string,
  action: BulkApprovalAction,
  applicationIds: string[],
  clarificationEmail?: NormalizedClarificationEmail
) {
  const digest = createHash("sha1")
    .update(JSON.stringify({
      eventId,
      action,
      applicationIds: [...applicationIds].sort(),
      clarificationEmail: clarificationEmail?.isCustom
        ? { subject: clarificationEmail.subject, body: clarificationEmail.body }
        : undefined
    }))
    .digest("hex")
    .slice(0, 16);
  return `approval_bulk_${digest}`;
}

function normalizeSubject(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeBody(value?: string) {
  return value?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() ?? "";
}

function isApprovalQueue(value: string): value is ApprovalQueue {
  return [
    "all",
    "ready",
    "needs_info",
    "awaiting_reply",
    "manual",
    "waitlist",
    "approved",
    "rejected"
  ].includes(value);
}

function isApprovalSegment(value: string): value is ApprovalSegment {
  return [
    "all",
    "yc_founders",
    "possible_yc",
    "investors",
    "network",
    "unmapped",
    "capacity"
  ].includes(value);
}

function useSupabaseApprovals() {
  return process.env.EVENT_APPROVALS_DATA_SOURCE === "supabase";
}
