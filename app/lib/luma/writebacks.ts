import { createLumaClientFromEnv, LumaApiError, type FetchFn, type LumaWritableGuestStatus } from "./client";
import { createSupabaseServiceClientFromEnv, SupabaseRestError } from "../supabase/service-client";

export type ClaimedLumaWritebackJob = {
  id: string;
  applicationId: string;
  targetStatus: LumaWritableGuestStatus;
  attemptCount: number;
  eventApiId: string;
  guestApiId?: string;
  guestEmail?: string;
  shouldRefund?: boolean;
  sendEmail?: boolean;
};

export type LumaWritebackStore = {
  claimQueuedWritebackJobs(limit: number, workerId: string, scope?: LumaWritebackScope): Promise<ClaimedLumaWritebackJob[]>;
  markWritebackSucceeded(jobId: string, responsePayload: Record<string, unknown>, completedAt: string): Promise<void>;
  markWritebackFailed(jobId: string, errorMessage: string, scheduledAt: string): Promise<void>;
};

export type LumaWritebackClient = {
  updateGuestStatus(input: {
    eventId: string;
    guest: { type: "api_id"; apiId: string } | { type: "email"; email: string };
    status: LumaWritableGuestStatus;
    shouldRefund?: boolean;
    sendEmail?: boolean;
  }): Promise<Record<string, never>>;
};

export type LumaWritebackOptions = {
  batchSize?: number;
  fetchFn?: FetchFn;
  workerId?: string;
  now?: () => Date;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  scope?: LumaWritebackScope;
};

export type LumaWritebackScope = {
  operationId?: string;
  jobIds?: string[];
};

export type LumaWritebackSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ jobId: string; message: string }>;
};

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BASE_RETRY_DELAY_MS = 60_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30 * 60_000;

export async function processLumaWritebacksFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: LumaWritebackOptions = {}
) {
  return processLumaWritebacks({
    lumaClient: createLumaClientFromEnv(env, options.fetchFn),
    store: createSupabaseLumaWritebackStoreFromEnv(env, options.fetchFn),
    options: {
      ...options,
      batchSize: options.batchSize ?? numberFromEnv(env.LUMA_WRITEBACK_BATCH_SIZE, DEFAULT_BATCH_SIZE)
    }
  });
}

export async function processLumaWritebacks({
  lumaClient,
  store,
  options = {}
}: {
  lumaClient: LumaWritebackClient;
  store: LumaWritebackStore;
  options?: LumaWritebackOptions;
}): Promise<LumaWritebackSummary> {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const workerId = options.workerId ?? `yc-os-${process.pid}`;
  const jobs = await store.claimQueuedWritebackJobs(batchSize, workerId, options.scope);
  const summary: LumaWritebackSummary = {
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const job of jobs) {
    if (job.targetStatus !== "approved" && job.targetStatus !== "declined") {
      summary.skipped += 1;
      const message = `Unsupported Lu.ma writeback status ${job.targetStatus}.`;
      await store.markWritebackFailed(job.id, message, retryAtFor(job, now, options).toISOString());
      summary.errors.push({ jobId: job.id, message });
      continue;
    }

    try {
      await lumaClient.updateGuestStatus({
        eventId: job.eventApiId,
        guest: guestSelectorFor(job),
        status: job.targetStatus,
        shouldRefund: job.shouldRefund,
        sendEmail: job.sendEmail
      });
      await store.markWritebackSucceeded(job.id, { ok: true }, now().toISOString());
      summary.succeeded += 1;
    } catch (error) {
      const message = sanitizeWritebackError(error);
      await store.markWritebackFailed(job.id, message, retryAtFor(job, now, options).toISOString());
      summary.failed += 1;
      summary.errors.push({ jobId: job.id, message });
    }
  }

  return summary;
}

function guestSelectorFor(job: ClaimedLumaWritebackJob) {
  if (job.guestApiId) return { type: "api_id" as const, apiId: job.guestApiId };
  if (job.guestEmail) return { type: "email" as const, email: job.guestEmail };
  throw new Error("Lu.ma writeback job is missing guest api id and email.");
}

function retryAtFor(
  job: ClaimedLumaWritebackJob,
  now: () => Date,
  options: LumaWritebackOptions
) {
  const base = options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
  const max = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const delay = Math.min(base * 2 ** Math.max(0, job.attemptCount - 1), max);
  return new Date(now().getTime() + delay);
}

function sanitizeWritebackError(error: unknown) {
  const message = error instanceof LumaApiError
    ? `Lu.ma API status ${error.status}`
    : error instanceof Error
      ? error.message
      : "Unknown Lu.ma writeback failure";
  return message.slice(0, 500);
}

function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createSupabaseLumaWritebackStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn?: FetchFn
): LumaWritebackStore {
  const client = createSupabaseServiceClientFromEnv(env, fetchFn);

  return {
    async claimQueuedWritebackJobs(limit, workerId, scope) {
      try {
        const rows = await client.rpc<Array<Record<string, unknown>>>("claim_luma_writeback_jobs", {
          p_limit: limit,
          p_worker_id: workerId,
          p_bulk_operation_id: scope?.operationId ?? null,
          p_job_ids: scope?.jobIds?.length ? scope.jobIds : null
        });

        return rows.map(mapClaimedWritebackRow);
      } catch (error) {
        if (!scope || !isScopedClaimFunctionMissing(error)) throw error;
        return claimScopedWritebackJobsDirectly(client, limit, workerId, scope);
      }
    },

    async markWritebackSucceeded(jobId, responsePayload, completedAt) {
      await client.update("luma_writeback_jobs", {
        status: "succeeded",
        response_payload: responsePayload,
        completed_at: completedAt,
        last_error: null,
        locked_at: null,
        locked_by: null
      }, {
        filters: [{ column: "id", value: jobId }],
        returning: "minimal"
      });
    },

    async markWritebackFailed(jobId, errorMessage, scheduledAt) {
      await client.update("luma_writeback_jobs", {
        status: "failed",
        last_error: errorMessage,
        scheduled_at: scheduledAt,
        locked_at: null,
        locked_by: null
      }, {
        filters: [{ column: "id", value: jobId }],
        returning: "minimal"
      });
    }
  };
}

async function claimScopedWritebackJobsDirectly(
  client: ReturnType<typeof createSupabaseServiceClientFromEnv>,
  limit: number,
  workerId: string,
  scope: LumaWritebackScope
) {
  const filters: Array<{ column: string; operator?: "eq" | "in"; value: string | string[] }> = [
    { column: "status", value: "queued" }
  ];
  if (scope.operationId) filters.push({ column: "bulk_operation_id", value: scope.operationId });
  if (scope.jobIds?.length) filters.push({ column: "id", operator: "in", value: scope.jobIds });

  const rows = await client.select<Array<Record<string, unknown>>[number]>("luma_writeback_jobs", {
    select: "id,application_id,target_status,attempt_count,payload",
    filters,
    order: "created_at.asc",
    limit
  });
  const claimedAt = new Date().toISOString();
  const claimed: ClaimedLumaWritebackJob[] = [];

  for (const row of rows) {
    const jobId = stringValue(row.id);
    if (!jobId) continue;
    const attemptCount = Number(row.attempt_count ?? 0) + 1;
    const updatedRows = await client.update<Array<Record<string, unknown>>[number]>("luma_writeback_jobs", {
      attempt_count: attemptCount,
      locked_at: claimedAt,
      locked_by: workerId
    }, {
      filters: [
        { column: "id", value: jobId },
        { column: "status", value: "queued" }
      ],
      select: "id,application_id,target_status,attempt_count,payload"
    });
    if (updatedRows[0]) claimed.push(mapClaimedWritebackRow(updatedRows[0]));
  }

  return claimed;
}

function mapClaimedWritebackRow(row: Record<string, unknown>): ClaimedLumaWritebackJob {
  const payload = recordValue(row.payload);
  const guest = recordValue(payload.guest);
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    targetStatus: row.target_status as LumaWritableGuestStatus,
    attemptCount: Number(row.attempt_count ?? 0),
    eventApiId: stringValue(row.event_api_id) ?? stringValue(payload.event_api_id) ?? "",
    guestApiId: typeof row.guest_api_id === "string" ? row.guest_api_id : stringValue(guest.api_id),
    guestEmail: typeof row.guest_email === "string" ? row.guest_email : stringValue(guest.email),
    shouldRefund: typeof row.should_refund === "boolean" ? row.should_refund : booleanValue(payload.should_refund),
    sendEmail: typeof row.send_email === "boolean" ? row.send_email : booleanValue(payload.send_email)
  };
}

function isScopedClaimFunctionMissing(error: unknown) {
  if (!(error instanceof SupabaseRestError) || error.status !== 404) return false;
  const payload = recordValue(error.payload);
  const code = stringValue(payload.code);
  const message = `${stringValue(payload.message) ?? ""} ${stringValue(payload.details) ?? ""}`;
  return code === "PGRST202" && message.includes("claim_luma_writeback_jobs");
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}
