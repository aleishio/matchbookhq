import { createHash } from "node:crypto";

import {
  filterApprovalApplications,
  summarizeApprovalSegments
} from "./event-approvals-filters";
import type {
  ApprovalQueue,
  ApprovalSegment,
  AiDecisionFilter,
  BulkApprovalRequest,
  BulkApprovalAction,
  BulkOperationJob,
  BulkApprovalResult,
  EventApprovalsListResponse,
  ApprovalDossierResponse,
  ApprovalGuestContextResponse,
  ApprovalGuestRuntimeEvent,
  NormalizedClarificationEmail
} from "./event-approvals-repository";
import {
  normalizeApprovalQueue,
  normalizeApprovalSegment,
  normalizeAiDecision,
  normalizeClarificationEmail,
  boundedInteger,
  EventApprovalsRepositoryError
} from "./event-approvals-repository";
import {
  canApprove,
  canReject,
  canSendInfo,
  transitionApplication
} from "./event-approvals-state";
import type {
  AiApprovalRecommendation,
  ApprovalLens,
  ApprovalStatus,
  ClarificationRequest,
  ParsedReply,
  EventApprovalApplication,
  LoadedLumaEvent
} from "./event-approvals-types";
import {
  DEFAULT_CLARIFICATION_EMAIL_BODY,
  DEFAULT_CLARIFICATION_EMAIL_SUBJECT
} from "./event-approvals-types";
import { sortApprovalEventsForDisplay } from "./event-directory";
import { createSupabaseServiceClientFromEnv, SupabaseRestError } from "./supabase/service-client";

type SupabaseClient = ReturnType<typeof createSupabaseServiceClientFromEnv>;
type SourceComparisonRow = ReturnType<typeof mapSourceComparisonRow>;
type YcFounderProfile = {
  id: string;
  photoUrl?: string;
};
type ApprovalEmailSidecars = {
  sourceComparisons: Map<string, SourceComparisonRow[]>;
  clarificationJobs: Map<string, Record<string, unknown>>;
  writebackJobs: Map<string, Record<string, unknown>>;
  replies: Map<string, Record<string, unknown>>;
  aiReviews: Map<string, Record<string, unknown>>;
  ycFounderProfiles: Map<string, YcFounderProfile>;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SUPABASE_IN_FILTER_CHUNK_SIZE = 100;

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

const DB_STATUS_TO_UI: Record<string, ApprovalStatus> = {
  ready: "ready",
  needs_info: "needsInfo",
  awaiting_reply: "awaitingReply",
  manual: "manual",
  waitlist: "waitlist",
  approved: "approved",
  rejected: "rejected"
};

export async function listApprovalEventsFromSupabase(): Promise<LoadedLumaEvent[]> {
  const client = createSupabaseServiceClientFromEnv();
  const rows = await client.select<Array<Record<string, unknown>>[number]>("luma_events", {
    select: "id,luma_event_id,title,url,starts_at,location_text,capacity,luma_event_applications(count),synced_at,raw_payload",
    order: "starts_at.asc"
  });

  return sortApprovalEventsForDisplay(rows.map(mapEventRow));
}

export async function listEventApprovalsFromSupabase(query: {
  eventId: string;
  queue?: ApprovalQueue;
  segment?: ApprovalSegment;
  aiDecision?: AiDecisionFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<EventApprovalsListResponse> {
  const normalized = normalizeQuery(query);
  const client = createSupabaseServiceClientFromEnv();
  const event = await getEventOrThrow(client, normalized.eventId);
  const allApplications = await listApplicationsForEvent(client, event.id);
  const lens = QUEUE_TO_LENS[normalized.queue];
  const segment = segmentToUi(normalized.segment);
  const filtered = filterByAiDecision(
    filterApprovalApplications(allApplications, lens, segment, normalized.search),
    normalized.aiDecision
  );
  const pageStart = (normalized.page - 1) * normalized.pageSize;

  return {
    event,
    applications: filtered.slice(pageStart, pageStart + normalized.pageSize),
    total: filtered.length,
    page: normalized.page,
    pageSize: normalized.pageSize,
    counts: queueCountsFor(allApplications),
    segmentCounts: segmentCountsFor(allApplications.filter((application) => lens === "all" || application.status === lens)),
    query: normalized
  };
}

export async function getApprovalDossierFromSupabase(applicationId: string): Promise<ApprovalDossierResponse> {
  const client = createSupabaseServiceClientFromEnv();
  const rows = await client.select<Array<Record<string, unknown>>[number]>("luma_event_applications", {
    select: "*",
    filters: [{ column: "id", value: applicationId }],
    limit: 1
  });
  const row = rows[0];
  if (!row) {
    throw new EventApprovalsRepositoryError("application_not_found", `No approval application found for ${applicationId}.`, 404);
  }

  const event = await getEventOrThrow(client, String(row.luma_event_id));
  const [sourceComparisons, sidecars] = await Promise.all([
    listSourceComparisons(client, applicationId),
    listApprovalEmailSidecars(client, [applicationId], {
      applicationRows: [row],
      includeSourceComparisons: false
    })
  ]);
  sidecars.sourceComparisons.set(applicationId, sourceComparisons);
  const application = mapApplicationRow(row, sidecars);

  return {
    event,
    application,
    sourceComparisons,
    lumaPayload: application.lumaPayload,
    aiRecommendation: application.aiRecommendation,
    audit: application.audit
  };
}

export async function getApprovalGuestContextFromSupabase(applicationId: string): Promise<ApprovalGuestContextResponse> {
  const client = createSupabaseServiceClientFromEnv();
  const dossier = await getApprovalDossierFromSupabase(applicationId);
  const application = dossier.application;
  const [
    emailJobs,
    replies,
    aiReviews,
    decisions,
    operationItems,
    writebacks
  ] = await Promise.all([
    client.select<Array<Record<string, unknown>>[number]>("clarification_email_jobs", {
      select: "id,status,subject,sent_at,scheduled_at,created_at,resend_email_id,last_error",
      filters: [{ column: "application_id", value: applicationId }],
      order: "created_at.desc",
      limit: 10
    }),
    client.select<Array<Record<string, unknown>>[number]>("applicant_replies", {
      select: "id,status,received_at,subject,parsed_fields,created_at",
      filters: [{ column: "application_id", value: applicationId }],
      order: "created_at.desc",
      limit: 10
    }),
    client.select<Array<Record<string, unknown>>[number]>("applicant_ai_reviews", {
      select: "id,decision,confidence,reasoning,created_at",
      filters: [{ column: "application_id", value: applicationId }],
      order: "created_at.desc",
      limit: 10
    }),
    client.select<Array<Record<string, unknown>>[number]>("approval_decisions", {
      select: "id,decision,prior_status,next_status,actor_name,reason,created_at",
      filters: [{ column: "application_id", value: applicationId }],
      order: "created_at.desc",
      limit: 10
    }),
    client.select<Array<Record<string, unknown>>[number]>("approval_bulk_operation_items", {
      select: "id,status,reason,created_at",
      filters: [{ column: "application_id", value: applicationId }],
      order: "created_at.desc",
      limit: 10
    }),
    client.select<Array<Record<string, unknown>>[number]>("luma_writeback_jobs", {
      select: "id,status,target_status,completed_at,scheduled_at,created_at,last_error,response_payload",
      filters: [{ column: "application_id", value: applicationId }],
      order: "created_at.desc",
      limit: 10
    })
  ]);
  const latestEmail = emailJobs[0];
  const latestReply = replies[0];
  const latestWriteback = writebacks[0];

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
      events: runtimeEventsFor({
        aiReviews,
        decisions,
        emailJobs,
        operationItems,
        replies,
        writebacks
      }),
      latestEmail: latestEmail
        ? {
            id: stringValue(latestEmail.id),
            resendEmailId: stringValue(latestEmail.resend_email_id),
            sentAt: stringValue(latestEmail.sent_at),
            status: stringValue(latestEmail.status) ?? "unknown",
            subject: stringValue(latestEmail.subject)
          }
        : undefined,
      latestReply: latestReply
        ? {
            receivedAt: stringValue(latestReply.received_at) ?? stringValue(latestReply.created_at),
            status: stringValue(latestReply.status) ?? "unknown",
            summary: replySummary(latestReply)
          }
        : undefined,
      latestWriteback: latestWriteback
        ? {
            completedAt: stringValue(latestWriteback.completed_at),
            id: stringValue(latestWriteback.id),
            lastError: stringValue(latestWriteback.last_error),
            status: stringValue(latestWriteback.status) ?? "unknown",
            targetStatus: stringValue(latestWriteback.target_status)
          }
        : undefined
    }
  };
}

export async function createBulkApprovalOperationInSupabase(request: BulkApprovalRequest): Promise<BulkApprovalResult> {
  const action = request.action;
  const clarificationEmail = action === "send_info"
    ? normalizeClarificationEmail(request.clarificationEmail)
    : undefined;
  const client = createSupabaseServiceClientFromEnv();
  const event = await getEventOrThrow(client, request.eventId);
  const applications = await listApplicationsForEvent(client, event.id);
  const targets = selectTargets(applications, request);
  const hasLiveLumaDestination = isLiveLumaEventApiId(event.lumaApiId);
  const localPreviewCounts = bulkPreviewCounts(targets, action);
  if (targets.length === 0) {
    return {
      operationId: "",
      eventId: event.id,
      action,
      dryRun: request.dryRun ?? false,
      requestedCount: 0,
      appliedCount: 0,
      skippedCount: 0,
      applications: [],
      skipped: [],
      jobs: []
    };
  }
  if (request.dryRun) {
    const preview = previewBulkApprovalResult(action, targets, request, clarificationEmail, {
      ...localPreviewCounts,
      hasLiveLumaDestination
    });

    return {
      operationId: "",
      eventId: event.id,
      action,
      dryRun: true,
      requestedCount: targets.length,
      appliedCount: localPreviewCounts.appliedCount,
      skippedCount: localPreviewCounts.skippedCount,
      applications: preview.applications,
      skipped: preview.skipped,
      jobs: preview.jobs
    };
  }

  const rpcPayload = {
    p_application_ids: targets.map((target) => target.id),
    p_action: action,
    p_actor_id: request.actorId ?? null,
    p_actor_name: request.actorName ?? null,
    p_reason: request.reason ?? null,
    p_filter_payload: request.query ?? {},
    p_dry_run: request.dryRun ?? false,
    p_email_payload: clarificationEmail?.isCustom
      ? {
          subject: clarificationEmail.subject,
          body: clarificationEmail.body
        }
      : {}
  };
  let result = await callApprovalActionRpc(client, rpcPayload, clarificationEmail);
  const appliedCount = numberValue(result.applied_count) ?? 0;
  const skippedCount = numberValue(result.skipped_count) ?? 0;
  if (shouldFallbackFromLegacyApprovalRpc(action, targets, localPreviewCounts, appliedCount, skippedCount)) {
    result = await createBulkApprovalOperationDirectly(client, {
      action,
      event,
      request,
      targets
    });
  }
  const finalAppliedCount = numberValue(result.applied_count) ?? 0;
  const finalSkippedCount = numberValue(result.skipped_count) ?? 0;
  if (!request.dryRun && !hasLiveLumaDestination && (action === "approve" || action === "reject")) {
    await markNonProviderWritebacksSucceeded(client, stringValue(result.operation_id));
  }
  const preview = previewBulkApprovalResult(action, targets, request, clarificationEmail, {
    appliedCount: finalAppliedCount,
    skippedCount: finalSkippedCount,
    hasLiveLumaDestination
  });

  return {
    operationId: stringValue(result.operation_id) ?? "",
    eventId: event.id,
    action,
    dryRun: Boolean(result.dry_run),
    requestedCount: numberValue(result.requested_count) ?? targets.length,
    appliedCount: finalAppliedCount,
    skippedCount: finalSkippedCount,
    applications: preview.applications,
    skipped: preview.skipped,
    jobs: preview.jobs
  };
}

async function getEventOrThrow(client: SupabaseClient, eventId: string): Promise<LoadedLumaEvent> {
  let row: Record<string, unknown> | undefined;

  for (const filters of supabaseEventLookupFilters(eventId)) {
    const rows = await client.select<Array<Record<string, unknown>>[number]>("luma_events", {
      select: "id,luma_event_id,title,url,starts_at,location_text,capacity,luma_event_applications(count),synced_at,raw_payload",
      filters,
      limit: 1
    });
    row = rows[0];
    if (row) break;
  }

  if (!row) throw new EventApprovalsRepositoryError("event_not_found", `No Lu.ma event found for ${eventId}.`, 404);

  return mapEventRow(row);
}

export function supabaseEventLookupFilters(eventId: string) {
  const filters: Array<Array<{ column: string; value: string }>> = [];
  if (isUuid(eventId)) filters.push([{ column: "id", value: eventId }]);
  filters.push([{ column: "luma_event_id", value: eventId }]);
  filters.push([{ column: "raw_payload->>seed_id", value: eventId }]);
  return filters;
}

export function mapEventRow(row: Record<string, unknown>): LoadedLumaEvent {
  const rawPayload = objectValue(row.raw_payload);

  return {
    id: String(row.id),
    lumaApiId: stringValue(row.luma_event_id),
    title: String(row.title),
    startsAt: stringValue(row.starts_at) ?? "Unscheduled",
    location: stringValue(row.location_text) ?? "TBD",
    seats: numberValue(row.capacity) ?? 0,
    applicationCount: countFromRelation(row.luma_event_applications),
    seedId: stringValue(rawPayload.seed_id),
    source: "Lu.ma",
    syncedAt: stringValue(row.synced_at) ?? "",
    url: stringValue(row.url)
  };
}

async function listApplicationsForEvent(
  client: SupabaseClient,
  eventId: string,
  options: { includeSourceComparisons?: boolean } = {}
) {
  const rows = await client.select<Array<Record<string, unknown>>[number]>("luma_event_applications", {
    select: "*",
    filters: [{ column: "luma_event_id", value: eventId }],
    order: "submitted_at.desc.nullslast,created_at.desc"
  });
  const applicationIds = rows.map((row) => String(row.id));
  const sidecars = await listApprovalEmailSidecars(client, applicationIds, {
    applicationRows: rows,
    includeSourceComparisons: options.includeSourceComparisons ?? false
  });

  return rows.map((row) => mapApplicationRow(row, sidecars));
}

async function listSourceComparisonsForEvent(client: SupabaseClient, applicationIds: string[]) {
  const comparisonsByApplication = new Map<string, SourceComparisonRow[]>();
  if (applicationIds.length === 0) return comparisonsByApplication;

  const rows = (
    await Promise.all(
      chunkSupabaseInFilterValues(applicationIds).map((applicationIdChunk) =>
        client.select<Array<Record<string, unknown>>[number]>("applicant_source_comparisons", {
          select: "*",
          filters: [{ column: "application_id", operator: "in", value: applicationIdChunk }]
        })
      )
    )
  ).flat();

  for (const row of rows) {
    const applicationId = String(row.application_id);
    const comparisons = comparisonsByApplication.get(applicationId) ?? [];
    comparisons.push(mapSourceComparisonRow(row));
    comparisonsByApplication.set(applicationId, comparisons);
  }

  return comparisonsByApplication;
}

async function listSourceComparisons(client: SupabaseClient, applicationId: string) {
  const rows = await client.select<Array<Record<string, unknown>>[number]>("applicant_source_comparisons", {
    select: "*",
    filters: [{ column: "application_id", value: applicationId }]
  });
  return rows.map(mapSourceComparisonRow);
}

async function listApprovalEmailSidecars(
  client: SupabaseClient,
  applicationIds: string[],
  options: { applicationRows?: Record<string, unknown>[]; includeSourceComparisons: boolean }
): Promise<ApprovalEmailSidecars> {
  const [
    sourceComparisons,
    clarificationJobs,
    writebackJobs,
    replies,
    aiReviews,
    ycFounderProfiles
  ] = await Promise.all([
    options.includeSourceComparisons
      ? listSourceComparisonsForEvent(client, applicationIds)
      : Promise.resolve(new Map<string, SourceComparisonRow[]>()),
    listLatestRowsByApplication(client, "clarification_email_jobs", applicationIds, {
      select: "application_id,from_email,subject,body_preview,status,sent_at,scheduled_at,created_at,resend_email_id"
    }),
    listLatestRowsByApplication(client, "luma_writeback_jobs", applicationIds, {
      select: "application_id,status,target_status,completed_at,scheduled_at,created_at,last_error,response_payload"
    }),
    listLatestRowsByApplication(client, "applicant_replies", applicationIds, {
      select: "application_id,from_email,received_at,subject,parsed_fields,status,created_at,ai_review_id,provider_message_id"
    }),
    listLatestRowsByApplication(client, "applicant_ai_reviews", applicationIds, {
      select: "id,application_id,model,prompt_version,decision,confidence,reasoning,signals,input_summary,output_payload,is_authoritative,created_at"
    }),
    listYcFounderProfileFallbacksForApplications(client, options.applicationRows ?? [])
  ]);

  return {
    sourceComparisons,
    clarificationJobs,
    writebackJobs,
    replies,
    aiReviews,
    ycFounderProfiles
  };
}

export async function listYcFounderProfileFallbacksForApplications(
  client: SupabaseClient,
  applicationRows: Record<string, unknown>[]
) {
  const profilesByApplication = new Map<string, YcFounderProfile>();
  if (applicationRows.length === 0) return profilesByApplication;

  const founderRows = await client.select<Record<string, unknown>>("yc_founders", {
    select: "id,name,image_paths",
    limit: 5000
  });
  const profilesByName = uniqueFounderProfilesByName(founderRows);

  for (const row of applicationRows) {
    const applicationId = stringValue(row.id);
    const matchName = normalizedProfileMatchName(row.applicant_name);
    const profile = matchName ? profilesByName.get(matchName) : undefined;
    if (applicationId && profile) profilesByApplication.set(applicationId, profile);
  }

  return profilesByApplication;
}

async function listLatestRowsByApplication(
  client: SupabaseClient,
  table: string,
  applicationIds: string[],
  options: { select: string }
) {
  const latestRows = new Map<string, Record<string, unknown>>();
  if (applicationIds.length === 0) return latestRows;

  const rows = (
    await Promise.all(
      chunkSupabaseInFilterValues(applicationIds).map((applicationIdChunk) =>
        client.select<Array<Record<string, unknown>>[number]>(table, {
          select: options.select,
          filters: [{ column: "application_id", operator: "in", value: applicationIdChunk }],
          order: "created_at.desc"
        })
      )
    )
  ).flat();

  for (const row of rows) {
    const applicationId = stringValue(row.application_id);
    if (!applicationId || latestRows.has(applicationId)) continue;
    latestRows.set(applicationId, row);
  }

  return latestRows;
}

export function mapApplicationRow(
  row: Record<string, unknown>,
  sidecars: Partial<ApprovalEmailSidecars> | SourceComparisonRow[] = {}
): EventApprovalApplication {
  const lumaFields = objectValue(row.luma_fields);
  const lumaPayload = objectValue(row.luma_payload);
  const registrationAnswers = objectValue(lumaFields.registration_answers);
  const status = DB_STATUS_TO_UI[String(row.approval_status)] ?? "manual";
  const applicationId = String(row.id);
  const normalizedSidecars = Array.isArray(sidecars)
    ? normalizeSidecars({ sourceComparisons: new Map([[applicationId, sidecars]]) })
    : normalizeSidecars(sidecars);
  const ycFounderProfile = normalizedSidecars.ycFounderProfiles.get(applicationId);
  const photoUrl = approvalPhotoUrlFor(lumaFields, lumaPayload) ?? ycFounderProfile?.photoUrl;
  const sourceComparisons = normalizedSidecars.sourceComparisons.get(applicationId) ?? [];
  const clarificationJob = normalizedSidecars.clarificationJobs.get(applicationId);
  const writebackJob = normalizedSidecars.writebackJobs.get(applicationId);
  const reply = normalizedSidecars.replies.get(applicationId);
  const aiReview = normalizedSidecars.aiReviews.get(applicationId);
  const replyAiReview = reviewForReply(reply, aiReview);
  const aiRecommendation = mapAiRecommendation(objectValue(row.ai_recommendation), aiReview);

  return {
    id: applicationId,
    eventId: String(row.luma_event_id),
    lumaId: String(row.luma_guest_id),
    founderId: "",
    name: String(row.applicant_name),
    email: stringValue(row.applicant_email) ?? "",
    phone: stringValue(row.applicant_phone) ?? "",
    companyName: stringValue(registrationAnswers.Company) ?? stringValue(registrationAnswers.company) ?? "Unknown company",
    companyLine: stringValue(row.relation) ?? "Unmapped applicant",
    photoUrl,
    submittedAt: stringValue(row.submitted_at) ?? "",
    status,
    matchConfidence: numberValue(row.match_confidence) ?? 0,
    relation: stringValue(row.relation) ?? "Unmapped Lu.ma applicant",
    recommendation: stringValue(row.recommendation) ?? "Manual review required.",
    rule: ruleForSupabase(row, status, writebackJob),
    lumaStatus: lumaStatusForSupabase(row, status, writebackJob),
    primaryAction: primaryActionToUi(String(row.primary_action)),
    selectedDefault: Boolean(row.selected_default),
    lumaPayload: {
      guestId: String(row.luma_guest_id),
      eventApiId: stringValue(lumaFields.event_api_id) ?? "",
      approvalStatus: String(row.luma_status),
      registeredAt: stringValue(row.submitted_at) ?? "",
      name: String(row.applicant_name),
      email: stringValue(row.applicant_email) ?? "",
      phone: stringValue(row.applicant_phone) ?? "",
      registrationAnswers: stringRecord(registrationAnswers),
      rawFields: stringRecord(lumaFields),
      ...lumaPayload
    },
    sourceComparisons,
    aiRecommendation,
    evidence: evidenceForSupabase(row, status, clarificationJob, writebackJob, reply, aiReview),
    audit: auditForSupabase(row, clarificationJob, writebackJob, reply, aiReview),
    clarificationRequest: mapClarificationRequest(clarificationJob),
    parsedReply: mapParsedReply(reply, replyAiReview)
  };
}

function approvalPhotoUrlFor(
  lumaFields: Record<string, unknown>,
  lumaPayload: Record<string, unknown>
) {
  const candidates = [
    lumaFields.photo_url,
    lumaFields.avatar_url,
    lumaFields.profile_image_url,
    lumaFields.image_url,
    lumaFields.user_photo_url,
    lumaFields.user_avatar_url,
    lumaFields.user_image_url,
    lumaPayload.photo_url,
    lumaPayload.avatar_url,
    lumaPayload.profile_image_url,
    lumaPayload.image_url,
    lumaPayload.user_photo_url,
    lumaPayload.user_avatar_url,
    lumaPayload.user_image_url,
    objectValue(lumaPayload.user).photo_url,
    objectValue(lumaPayload.user).avatar_url,
    objectValue(lumaPayload.user).profile_image_url,
    objectValue(lumaPayload.user).image_url,
    objectValue(lumaPayload.guest).photo_url,
    objectValue(lumaPayload.guest).avatar_url,
    objectValue(lumaPayload.guest).profile_image_url,
    objectValue(lumaPayload.guest).image_url
  ];

  return candidates.map(stringValue).find(Boolean);
}

function uniqueFounderProfilesByName(founderRows: Record<string, unknown>[]) {
  const profilesByName = new Map<string, YcFounderProfile | null>();

  for (const row of founderRows) {
    const name = normalizedProfileMatchName(row.name);
    if (!name) continue;
    if (profilesByName.has(name)) {
      profilesByName.set(name, null);
      continue;
    }

    profilesByName.set(name, {
      id: String(row.id),
      photoUrl: stringValue(objectValue(row.image_paths).photo)
    });
  }

  return new Map(
    [...profilesByName].filter((entry): entry is [string, YcFounderProfile] =>
      Boolean(entry[1])
    )
  );
}

function normalizedProfileMatchName(value: unknown) {
  return stringValue(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function chunkSupabaseInFilterValues<T>(values: T[], chunkSize = SUPABASE_IN_FILTER_CHUNK_SIZE): T[][] {
  if (chunkSize < 1) throw new Error("Supabase in-filter chunk size must be at least 1.");

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

async function callApprovalActionRpc(
  client: SupabaseClient,
  payload: Record<string, unknown>,
  clarificationEmail?: NormalizedClarificationEmail
) {
  try {
    return await client.rpc<Record<string, unknown>>("queue_luma_approval_action", payload);
  } catch (error) {
    if (!clarificationEmail?.isCustom && isLegacyApprovalActionRpcMismatch(error)) {
      const { p_email_payload: _pEmailPayload, ...legacyPayload } = payload;
      return client.rpc<Record<string, unknown>>("queue_luma_approval_action", legacyPayload);
    }

    throw error;
  }
}

export function isLegacyApprovalActionRpcMismatch(error: unknown) {
  if (!(error instanceof SupabaseRestError) || error.status !== 404) return false;
  if (!isRecord(error.payload)) return false;
  const code = typeof error.payload.code === "string" ? error.payload.code : "";
  const details = typeof error.payload.details === "string" ? error.payload.details : "";
  const hint = typeof error.payload.hint === "string" ? error.payload.hint : "";
  const message = typeof error.payload.message === "string" ? error.payload.message : "";
  const text = `${details} ${hint} ${message}`;

  return code === "PGRST202"
    && text.includes("queue_luma_approval_action")
    && text.includes("p_email_payload");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewBulkApprovalResult(
  action: BulkApprovalAction,
  targets: EventApprovalApplication[],
  request: BulkApprovalRequest,
  clarificationEmail: NormalizedClarificationEmail | undefined,
  rpcCounts: { appliedCount: number; skippedCount: number; hasLiveLumaDestination: boolean }
) {
  const applications: EventApprovalApplication[] = [];
  const skipped: Array<{ applicationId: string; reason: string }> = [];
  const jobs: BulkOperationJob[] = [];
  const auditMessage = bulkAuditMessage(action, request.actorName, request.reason);

  for (const application of targets) {
    if (!isEligibleForBulkAction(application, action)) {
      skipped.push({
        applicationId: application.id,
        reason: ineligibleReasonFor(application, action)
      });
      continue;
    }

    const transitioned = transitionApplication(application, statusForBulkAction(action), auditMessage);
    applications.push(transitioned);
    const job = rpcCounts.hasLiveLumaDestination ? jobForBulkAction(action, transitioned, clarificationEmail) : null;
    if (job) jobs.push(job);
  }

  if (applications.length === rpcCounts.appliedCount && skipped.length === rpcCounts.skippedCount) {
    return { applications, skipped, jobs };
  }

  if (rpcCounts.appliedCount === 0 && rpcCounts.skippedCount === targets.length) {
    return {
      applications: [],
      skipped: targets.map((application) => ({
        applicationId: application.id,
        reason: `Supabase skipped this ${action} action.`
      })),
      jobs: []
    };
  }

  return {
    applications: applications.slice(0, rpcCounts.appliedCount),
    skipped: skipped.slice(0, rpcCounts.skippedCount),
    jobs: jobs.slice(0, rpcCounts.appliedCount)
  };
}

function bulkPreviewCounts(targets: EventApprovalApplication[], action: BulkApprovalAction) {
  const appliedCount = targets.filter((target) => isEligibleForBulkAction(target, action)).length;
  return {
    appliedCount,
    skippedCount: targets.length - appliedCount
  };
}

function shouldFallbackFromLegacyApprovalRpc(
  action: BulkApprovalAction,
  targets: EventApprovalApplication[],
  localPreviewCounts: { appliedCount: number; skippedCount: number },
  appliedCount: number,
  skippedCount: number
) {
  return (action === "approve" || action === "reject")
    && targets.length > 0
    && localPreviewCounts.appliedCount > 0
    && appliedCount === 0
    && skippedCount === targets.length;
}

async function createBulkApprovalOperationDirectly(
  client: SupabaseClient,
  input: {
    action: BulkApprovalAction;
    event: LoadedLumaEvent;
    request: BulkApprovalRequest;
    targets: EventApprovalApplication[];
  }
) {
  const operationRows = await client.insert<Array<Record<string, unknown>>[number]>("approval_bulk_operations", [{
    luma_event_id: input.event.id,
    actor_id: input.request.actorId ?? null,
    actor_name: input.request.actorName ?? null,
    action: input.action,
    filter_payload: input.request.query ?? {},
    requested_count: input.targets.length,
    status: "running"
  }], {
    select: "id"
  });
  const operationId = stringValue(operationRows[0]?.id);
  if (!operationId) {
    throw new EventApprovalsRepositoryError(
      "approval_operation_failed",
      "Supabase did not return an approval operation id.",
      503
    );
  }

  let appliedCount = 0;
  let skippedCount = 0;
  for (const target of input.targets) {
    if (!isEligibleForBulkAction(target, input.action)) {
      skippedCount += 1;
      await insertBulkOperationItem(client, operationId, target.id, "skipped", ineligibleReasonFor(target, input.action));
      continue;
    }

    const nextStatus = statusForBulkAction(input.action);
    const updatedRows = await client.update<Array<Record<string, unknown>>[number]>("luma_event_applications", {
      approval_status: nextStatus,
      primary_action: nextStatus === "approved" || nextStatus === "rejected" || nextStatus === "waitlist"
        ? "none"
        : "manual_review",
      updated_at: new Date().toISOString()
    }, {
      filters: [
        { column: "id", value: target.id },
        { column: "approval_status", value: dbStatusForApplication(target.status) }
      ],
      select: "id"
    });

    if (updatedRows.length === 0) {
      skippedCount += 1;
      await insertBulkOperationItem(
        client,
        operationId,
        target.id,
        "skipped",
        "approval status changed before action could be applied"
      );
      continue;
    }

    appliedCount += 1;
    const decisionRows = await client.insert<Array<Record<string, unknown>>[number]>("approval_decisions", [{
      application_id: target.id,
      actor_id: input.request.actorId ?? null,
      actor_name: input.request.actorName ?? null,
      decision: input.action,
      prior_status: dbStatusForApplication(target.status),
      next_status: nextStatus,
      reason: input.request.reason ?? null,
      metadata: { bulk_operation_id: operationId }
    }], {
      select: "id"
    });
    const decisionId = stringValue(decisionRows[0]?.id);

    await insertBulkOperationItem(client, operationId, target.id, "applied", input.request.reason ?? null);
    if (input.action === "approve" || input.action === "reject") {
      await insertProviderWritebackJob(client, {
        action: input.action,
        application: target,
        decisionId,
        operationId
      });
    }
  }

  await client.update("approval_bulk_operations", {
    applied_count: appliedCount,
    skipped_count: skippedCount,
    status: "completed",
    completed_at: new Date().toISOString()
  }, {
    filters: [{ column: "id", value: operationId }],
    returning: "minimal"
  });

  return {
    operation_id: operationId,
    dry_run: false,
    requested_count: input.targets.length,
    applied_count: appliedCount,
    skipped_count: skippedCount
  };
}

async function insertBulkOperationItem(
  client: SupabaseClient,
  operationId: string,
  applicationId: string,
  status: "applied" | "skipped",
  reason: string | null
) {
  await client.insert("approval_bulk_operation_items", [{
    bulk_operation_id: operationId,
    application_id: applicationId,
    status,
    reason
  }], {
    returning: "minimal"
  });
}

async function insertProviderWritebackJob(
  client: SupabaseClient,
  input: {
    action: "approve" | "reject";
    application: EventApprovalApplication;
    decisionId?: string;
    operationId: string;
  }
) {
  const targetStatus = input.action === "approve" ? "approved" : "declined";
  const row = {
    application_id: input.application.id,
    bulk_operation_id: input.operationId,
    decision_id: input.decisionId ?? null,
    target_status: targetStatus,
    payload: {
      event_api_id: input.application.lumaPayload.eventApiId,
      guest: input.application.lumaPayload.guestId
        ? { type: "api_id", api_id: input.application.lumaPayload.guestId }
        : { type: "email", email: input.application.email },
      status: targetStatus,
      send_email: false
    },
    idempotency_key: writebackIdempotencyKey(input.operationId, input.application.id, input.action)
  };

  try {
    await client.insert("luma_writeback_jobs", [row], {
      onConflict: "idempotency_key",
      ignoreDuplicates: true,
      returning: "minimal"
    });
  } catch (error) {
    if (!isRetryableWritebackJobInsertError(error)) throw error;
    const { decision_id: _decisionId, idempotency_key: _idempotencyKey, ...legacyRow } = row;
    await client.insert("luma_writeback_jobs", [legacyRow], {
      returning: "minimal"
    });
  }
}

function writebackIdempotencyKey(operationId: string, applicationId: string, action: BulkApprovalAction) {
  return createHash("md5").update(`${operationId}:${applicationId}:${action}`).digest("hex");
}

function isRetryableWritebackJobInsertError(error: unknown) {
  if (!(error instanceof SupabaseRestError)) return false;
  const payload = isRecord(error.payload) ? error.payload : {};
  const message = `${stringValue(payload.message) ?? ""} ${stringValue(payload.details) ?? ""}`;
  return message.includes("decision_id")
    || message.includes("idempotency_key")
    || message.includes("no unique or exclusion constraint matching the ON CONFLICT specification");
}

function dbStatusForApplication(status: ApprovalStatus) {
  if (status === "needsInfo") return "needs_info";
  if (status === "awaitingReply") return "awaiting_reply";
  return status;
}

export function isLiveLumaEventApiId(value?: string) {
  return /^evt[-_][A-Za-z0-9]+$/.test(value ?? "");
}

async function markNonProviderWritebacksSucceeded(client: SupabaseClient, operationId?: string) {
  if (!operationId) return;

  await client.update("luma_writeback_jobs", {
    status: "succeeded",
    response_payload: {
      skipped_provider: true,
      reason: "non_luma_example_event"
    },
    completed_at: new Date().toISOString(),
    last_error: null,
    locked_at: null,
    locked_by: null
  }, {
    filters: [
      { column: "bulk_operation_id", value: operationId },
      { column: "status", value: "queued" }
    ],
    returning: "minimal"
  });
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

function bulkAuditMessage(action: BulkApprovalAction, actorName?: string, reason?: string) {
  const actor = actorName?.trim() || "ops";
  const suffix = reason?.trim() ? ` Reason: ${reason.trim()}` : "";
  if (action === "approve") return `Bulk approved by ${actor} from YC OS.${suffix}`;
  if (action === "reject") return `Bulk rejected by ${actor} from YC OS.${suffix}`;
  return `Clarification email queued by ${actor} from events.ycombinator.com.${suffix}`;
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

function normalizeSidecars(sidecars: Partial<ApprovalEmailSidecars> | SourceComparisonRow[]): ApprovalEmailSidecars {
  if (Array.isArray(sidecars)) {
    return {
      sourceComparisons: new Map([["", sidecars]]),
      clarificationJobs: new Map(),
      writebackJobs: new Map(),
      replies: new Map(),
      aiReviews: new Map(),
      ycFounderProfiles: new Map()
    };
  }

  return {
    sourceComparisons: sidecars.sourceComparisons ?? new Map(),
    clarificationJobs: sidecars.clarificationJobs ?? new Map(),
    writebackJobs: sidecars.writebackJobs ?? new Map(),
    replies: sidecars.replies ?? new Map(),
    aiReviews: sidecars.aiReviews ?? new Map(),
    ycFounderProfiles: sidecars.ycFounderProfiles ?? new Map()
  };
}

function mapAiRecommendation(
  storedRecommendation: Record<string, unknown>,
  aiReview?: Record<string, unknown>
): AiApprovalRecommendation {
  const output = objectValue(aiReview?.output_payload);
  const storedSignals = arrayOfStrings(storedRecommendation.signals);
  const reviewSignals = arrayOfStrings(aiReview?.signals);

  return {
    decision: aiDecision(aiReview?.decision ?? storedRecommendation.decision),
    confidence: numberValue(aiReview?.confidence) ?? numberValue(storedRecommendation.confidence) ?? 0,
    model: stringValue(aiReview?.model) ?? stringValue(storedRecommendation.model) ?? "none",
    promptVersion:
      stringValue(aiReview?.prompt_version) ??
      stringValue(storedRecommendation.promptVersion) ??
      stringValue(storedRecommendation.prompt_version) ??
      "none",
    reviewedAt:
      stringValue(aiReview?.created_at) ??
      stringValue(storedRecommendation.reviewedAt) ??
      stringValue(storedRecommendation.reviewed_at) ??
      "",
    reason:
      stringValue(aiReview?.reasoning) ??
      stringValue(output.reason) ??
      stringValue(storedRecommendation.reason) ??
      "No AI review yet.",
    signals: reviewSignals.length > 0 ? reviewSignals : storedSignals
  };
}

function reviewForReply(
  reply?: Record<string, unknown>,
  aiReview?: Record<string, unknown>
) {
  if (!reply || !aiReview) return undefined;
  const linkedReviewId = stringValue(reply.ai_review_id);
  if (!linkedReviewId) return aiReview;
  return stringValue(aiReview.id) === linkedReviewId ? aiReview : undefined;
}

function mapClarificationRequest(row?: Record<string, unknown>): ClarificationRequest | undefined {
  if (!row) return undefined;

  return {
    sentFrom: stringValue(row.from_email) ?? "yc@events.matchbookhq.com",
    subject: stringValue(row.subject) ?? "Confirming your YC event details",
    preview: stringValue(row.body_preview) ?? "Please reply with your YC company, batch, role, and mapped YC email."
  };
}

function mapParsedReply(
  reply?: Record<string, unknown>,
  aiReview?: Record<string, unknown>
): ParsedReply | undefined {
  if (!reply) return undefined;

  const parsedFields = objectValue(reply.parsed_fields);
  const output = objectValue(aiReview?.output_payload);

  return {
    receivedAt: stringValue(reply.received_at) ?? stringValue(reply.created_at) ?? "",
    summary:
      stringValue(output.summary) ??
      stringValue(parsedFields.summary) ??
      stringValue(reply.subject) ??
      "Applicant reply received.",
    extracted: extractedReplyFields(output, parsedFields, reply),
    aiDecision: parsedReplyDecision(reply, aiReview),
    reason:
      stringValue(output.reason) ??
      stringValue(aiReview?.reasoning) ??
      stringValue(parsedFields.reason) ??
      reasonForReplyStatus(stringValue(reply.status))
  };
}

function extractedReplyFields(
  output: Record<string, unknown>,
  parsedFields: Record<string, unknown>,
  reply: Record<string, unknown>
) {
  const extracted = objectValue(output.extracted);
  const fields: Array<[string, unknown]> = [
    ["Company", extracted.company ?? parsedFields.company ?? parsedFields.extracted_company],
    ["Batch", extracted.batch ?? parsedFields.batch ?? parsedFields.extracted_batch],
    ["YC email", extracted.yc_email ?? parsedFields.yc_email ?? parsedFields.extracted_yc_email],
    ["Role", extracted.role ?? parsedFields.role ?? parsedFields.extracted_role],
    ["Relationship", extracted.relationship ?? parsedFields.relationship ?? parsedFields.relationship_summary]
  ];
  const values = fields.flatMap(([label, value]) => {
    const normalized = stringValue(value);
    return normalized ? [`${label}: ${normalized}`] : [];
  });

  return values.length > 0 ? values : [`Reply status: ${stringValue(reply.status) ?? "pending_review"}`];
}

function parsedReplyDecision(reply: Record<string, unknown>, aiReview?: Record<string, unknown>): ParsedReply["aiDecision"] {
  const decision = aiDecision(aiReview?.decision);
  if (decision === "approve") return "approve";
  if (stringValue(reply.status) === "auto_ready") return "approve";
  return "manual";
}

function reasonForReplyStatus(status?: string) {
  if (status === "auto_ready") return "Reply has enough evidence for ops to review as ready.";
  if (status === "ignored") return "Reply was ignored for approval routing.";
  if (status === "manual") return "Reply needs manual review before any writeback.";
  return "Reply is stored and waiting for AI review.";
}

function evidenceForSupabase(
  row: Record<string, unknown>,
  status: ApprovalStatus,
  clarificationJob?: Record<string, unknown>,
  writebackJob?: Record<string, unknown>,
  reply?: Record<string, unknown>,
  aiReview?: Record<string, unknown>
): EventApprovalApplication["evidence"] {
  const evidence: EventApprovalApplication["evidence"] = [
    {
      label: "Lu.ma status",
      value: lumaStatusForSupabase(row, status, writebackJob),
      tone: status === "approved" ? "ok" : status === "rejected" ? "warn" : "neutral"
    }
  ];

  if (writebackJob) {
    const sync = writebackSyncStatus(writebackJob);
    evidence.push({
      label: "Lu.ma sync",
      value: sync.evidence,
      tone: sync.tone
    });
  }

  if (clarificationJob) {
    const jobStatus = stringValue(clarificationJob.status) ?? "queued";
    evidence.push({
      label: "Email",
      value: `Clarification ${jobStatus}`,
      tone: jobStatus === "succeeded" ? "ok" : jobStatus === "failed" ? "warn" : "neutral"
    });
  }

  if (reply) {
    const replyStatus = stringValue(reply.status) ?? "pending_review";
    evidence.push({
      label: "Reply",
      value: `Applicant reply ${replyStatus}`,
      tone: replyStatus === "auto_ready" ? "ok" : replyStatus === "ignored" ? "warn" : "neutral"
    });
  }

  if (aiReview) {
    const decision = aiDecision(aiReview.decision);
    const confidence = numberValue(aiReview.confidence);
    evidence.push({
      label: "AI review",
      value: `${decision}${confidence === undefined ? "" : ` (${Math.round(confidence)}%)`}`,
      tone: decision === "approve" || decision === "waitlist" ? "ok" : "warn"
    });
  }

  return evidence;
}

function auditForSupabase(
  row: Record<string, unknown>,
  clarificationJob?: Record<string, unknown>,
  writebackJob?: Record<string, unknown>,
  reply?: Record<string, unknown>,
  aiReview?: Record<string, unknown>
) {
  const audit = [
    `Last synced from Lu.ma at ${stringValue(row.synced_at) ?? stringValue(row.updated_at) ?? "unknown time"}.`
  ];

  if (clarificationJob) {
    audit.push(
      `Clarification email ${stringValue(clarificationJob.status) ?? "queued"} at ${
        stringValue(clarificationJob.sent_at) ??
        stringValue(clarificationJob.scheduled_at) ??
        stringValue(clarificationJob.created_at) ??
        "unknown time"
      }.`
    );
  }

  if (writebackJob) {
    const sync = writebackSyncStatus(writebackJob);
    audit.push(`${sync.audit} at ${syncTime(writebackJob)}.`);
  }

  if (reply) {
    audit.push(`Applicant reply linked at ${stringValue(reply.received_at) ?? stringValue(reply.created_at) ?? "unknown time"}.`);
  }

  if (aiReview) {
    audit.push(
      `AI reply review suggested ${aiDecision(aiReview.decision)} at ${stringValue(aiReview.created_at) ?? "unknown time"}; user decision remains authoritative.`
    );
  }

  return audit;
}

function ruleForSupabase(
  row: Record<string, unknown>,
  status: ApprovalStatus,
  writebackJob?: Record<string, unknown>
) {
  const sync = writebackJob ? writebackSyncStatus(writebackJob).rule : "synced";
  const destination = writebackJob && isSkippedProviderWriteback(writebackJob) ? "YC OS only" : "Lu.ma";
  if (status === "approved") return `A1 user approved and ${sync} ${destination}`;
  if (status === "rejected") return `J1 user rejected and ${sync} ${destination}`;
  return stringValue(row.rule_code) ?? "LUMA_SYNC_UNMAPPED";
}

function lumaStatusForSupabase(
  row: Record<string, unknown>,
  status: ApprovalStatus,
  writebackJob?: Record<string, unknown>
) {
  const importedStatus = String(row.luma_status);
  if (status !== "approved" && status !== "rejected") return importedStatus;

  if (!writebackJob) return status === "approved" ? "Approved in Lu.ma" : "Declined in Lu.ma";

  const sync = writebackSyncStatus(writebackJob);
  if (isSkippedProviderWriteback(writebackJob)) {
    return status === "approved" ? "Approved in YC OS only" : "Rejected in YC OS only";
  }
  if (sync.status === "succeeded") return status === "approved" ? "Approved in Lu.ma" : "Declined in Lu.ma";
  if (sync.status === "failed") return status === "approved" ? "Approved in YC OS, retrying Lu.ma sync" : "Rejected in YC OS, retrying Lu.ma sync";
  return status === "approved" ? "Approved in Lu.ma" : "Declined in Lu.ma";
}

function writebackSyncStatus(writebackJob: Record<string, unknown>) {
  const status = stringValue(writebackJob.status) ?? "queued";
  if (isSkippedProviderWriteback(writebackJob)) {
    return {
      status,
      rule: "kept in",
      evidence: "Supabase only",
      audit: "Provider sync skipped for non-Lu.ma example event",
      tone: "neutral" as const
    };
  }
  if (status === "succeeded") {
    return {
      status,
      rule: "synced to",
      evidence: "Synced",
      audit: "Lu.ma sync completed",
      tone: "ok" as const
    };
  }
  if (status === "failed") {
    return {
      status,
      rule: "retrying",
      evidence: "Retrying sync",
      audit: "Lu.ma sync is retrying",
      tone: "warn" as const
    };
  }
  return {
    status,
    rule: "synced to",
    evidence: "Synced",
    audit: "Lu.ma sync completed",
    tone: "ok" as const
  };
}

function isSkippedProviderWriteback(writebackJob: Record<string, unknown>) {
  return objectValue(writebackJob.response_payload).skipped_provider === true;
}

function syncTime(writebackJob: Record<string, unknown>) {
  return stringValue(writebackJob.completed_at)
    ?? stringValue(writebackJob.scheduled_at)
    ?? stringValue(writebackJob.created_at)
    ?? "unknown time";
}

function mapSourceComparisonRow(row: Record<string, unknown>) {
  return {
    field: row.field_name as EventApprovalApplication["sourceComparisons"][number]["field"],
    source: row.source_kind as EventApprovalApplication["sourceComparisons"][number]["source"],
    lumaValue: stringValue(row.luma_value) ?? "",
    ycValue: stringValue(row.yc_value),
    result: row.result as EventApprovalApplication["sourceComparisons"][number]["result"],
    weight: numberValue(row.weight) ?? 0,
    notes: stringValue(row.notes) ?? ""
  };
}

function selectTargets(applications: EventApprovalApplication[], request: BulkApprovalRequest) {
  if (request.applicationIds?.length) {
    const ids = new Set(request.applicationIds);
    return applications.filter((application) => ids.has(application.id));
  }

  if (!request.query) {
    throw new EventApprovalsRepositoryError("missing_bulk_scope", "Bulk operations require applicationIds or a query scope.");
  }

  const normalized = normalizeQuery({
    eventId: request.eventId,
    ...request.query,
    page: 1,
    pageSize: Number.MAX_SAFE_INTEGER
  });
  return filterByAiDecision(
    filterApprovalApplications(
      applications,
      QUEUE_TO_LENS[normalized.queue],
      segmentToUi(normalized.segment),
      normalized.search
    ),
    normalized.aiDecision
  );
}

function normalizeQuery(query: {
  eventId: string;
  queue?: ApprovalQueue;
  segment?: ApprovalSegment;
  aiDecision?: AiDecisionFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
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

function queueCountsFor(applications: EventApprovalApplication[]) {
  return {
    all: applications.length,
    ready: countStatus(applications, "ready"),
    needs_info: countStatus(applications, "needsInfo"),
    awaiting_reply: countStatus(applications, "awaitingReply"),
    manual: countStatus(applications, "manual"),
    waitlist: countStatus(applications, "waitlist"),
    approved: countStatus(applications, "approved"),
    rejected: countStatus(applications, "rejected")
  };
}

function segmentCountsFor(applications: EventApprovalApplication[]) {
  const counts = summarizeApprovalSegments(applications);
  return {
    all: counts.all,
    yc_founders: counts.ycFounders,
    possible_yc: counts.possibleYc,
    investors: counts.investors,
    network: counts.network,
    unmapped: counts.unmapped,
    capacity: counts.capacity
  };
}

function countStatus(applications: EventApprovalApplication[], status: ApprovalStatus) {
  return applications.filter((application) => application.status === status).length;
}

function filterByAiDecision(applications: EventApprovalApplication[], aiDecision: AiDecisionFilter) {
  if (aiDecision === "all") return applications;
  return applications.filter((application) => application.aiRecommendation.decision === aiDecision);
}

function runtimeEventsFor(rows: {
  aiReviews: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  emailJobs: Record<string, unknown>[];
  operationItems: Record<string, unknown>[];
  replies: Record<string, unknown>[];
  writebacks: Record<string, unknown>[];
}): ApprovalGuestRuntimeEvent[] {
  return [
    ...rows.decisions.map((row) => ({
      at: stringValue(row.created_at),
      kind: "approval_decision",
      status: stringValue(row.decision),
      summary: `${stringValue(row.prior_status) ?? "unknown"} -> ${stringValue(row.next_status) ?? "unknown"}${stringValue(row.actor_name) ? ` by ${stringValue(row.actor_name)}` : ""}`
    })),
    ...rows.operationItems.map((row) => ({
      at: stringValue(row.created_at),
      kind: "bulk_operation_item",
      status: stringValue(row.status),
      summary: stringValue(row.reason) ?? "Bulk operation item recorded."
    })),
    ...rows.writebacks.map((row) => ({
      at: stringValue(row.completed_at) ?? stringValue(row.created_at),
      kind: "luma_writeback",
      status: stringValue(row.status),
      summary: stringValue(row.last_error) ?? `Lu.ma target ${stringValue(row.target_status) ?? "unknown"}`
    })),
    ...rows.emailJobs.map((row) => ({
      at: stringValue(row.sent_at) ?? stringValue(row.created_at),
      kind: "clarification_email",
      status: stringValue(row.status),
      summary: stringValue(row.last_error) ?? stringValue(row.subject) ?? "Clarification email job recorded."
    })),
    ...rows.replies.map((row) => ({
      at: stringValue(row.received_at) ?? stringValue(row.created_at),
      kind: "applicant_reply",
      status: stringValue(row.status),
      summary: replySummary(row)
    })),
    ...rows.aiReviews.map((row) => ({
      at: stringValue(row.created_at),
      kind: "ai_review",
      status: stringValue(row.decision),
      summary: stringValue(row.reasoning) ?? `AI confidence ${numberValue(row.confidence) ?? 0}`
    }))
  ].sort((left, right) => (right.at ?? "").localeCompare(left.at ?? ""));
}

function replySummary(row: Record<string, unknown>) {
  const parsedFields = objectValue(row.parsed_fields);
  return stringValue(parsedFields.summary) ?? stringValue(row.subject) ?? "Applicant reply received.";
}

function segmentToUi(segment: ApprovalSegment) {
  if (segment === "yc_founders") return "ycFounders";
  if (segment === "possible_yc") return "possibleYc";
  return segment;
}

function primaryActionToUi(value: string) {
  if (value === "send_info") return "sendInfo";
  if (value === "manual_review") return "manualReview";
  if (value === "approve" || value === "waitlist" || value === "none") return value;
  return "manualReview";
}

function aiDecision(value: unknown) {
  if (value === "approve" || value === "send_info" || value === "manual" || value === "waitlist" || value === "reject") return value;
  return "manual";
}

function countFromRelation(value: unknown) {
  if (!Array.isArray(value)) return 0;
  const first = value[0];
  if (!first || typeof first !== "object") return 0;
  return numberValue((first as Record<string, unknown>).count) ?? 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? "")]));
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
