import {
  EmailDeliveryError,
  sendEmail,
  type SendEmailInput,
  type SendEmailResult
} from "@/lib/email/resend";

import { createSupabaseServiceClientFromEnv } from "../supabase/service-client";

export type ClaimedClarificationEmailJob = {
  id: string;
  applicationId: string;
  attemptCount: number;
  toEmail: string;
  fromEmail: string;
  subject: string;
  bodyPreview: string;
  payload: Record<string, unknown>;
};

export type ClarificationEmailStore = {
  claimQueuedClarificationEmailJobs(limit: number, workerId: string): Promise<ClaimedClarificationEmailJob[]>;
  markClarificationEmailSucceeded(jobId: string, resendEmailId: string, responsePayload: Record<string, unknown>, sentAt: string): Promise<void>;
  markClarificationEmailFailed(jobId: string, errorMessage: string, scheduledAt: string): Promise<void>;
};

export type ClarificationEmailClient = {
  send(input: SendEmailInput): Promise<SendEmailResult>;
};

export type ClarificationEmailProcessingOptions = {
  batchSize?: number;
  workerId?: string;
  now?: () => Date;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
};

export type ClarificationEmailProcessingSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ jobId: string; message: string }>;
};

export type ClarificationEmailProcessingFromEnvOptions = ClarificationEmailProcessingOptions & {
  fetchFn?: typeof fetch;
};

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BASE_RETRY_DELAY_MS = 60_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30 * 60_000;

export async function processClarificationEmailsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return processClarificationEmails({
    emailClient: {
      send(input) {
        return sendEmail(input, { env });
      }
    },
    store: createSupabaseClarificationEmailStoreFromEnv(env),
    options: {
      batchSize: numberFromEnv(env.RESEND_CLARIFICATION_EMAIL_BATCH_SIZE, DEFAULT_BATCH_SIZE)
    }
  });
}

export async function processClarificationEmailsForOperationFromEnv(
  operationId: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ClarificationEmailProcessingFromEnvOptions = {}
) {
  return processClarificationEmails({
    emailClient: {
      send(input) {
        return sendEmail(input, { env });
      }
    },
    store: createSupabaseClarificationEmailStoreForOperationFromEnv(operationId, env, options.fetchFn),
    options: {
      ...options,
      batchSize: options.batchSize ?? numberFromEnv(env.RESEND_CLARIFICATION_EMAIL_BATCH_SIZE, DEFAULT_BATCH_SIZE),
      workerId: options.workerId ?? `yc-os-agent-clarification-${operationId}`
    }
  });
}

export async function processClarificationEmails({
  emailClient,
  store,
  options = {}
}: {
  emailClient: ClarificationEmailClient;
  store: ClarificationEmailStore;
  options?: ClarificationEmailProcessingOptions;
}): Promise<ClarificationEmailProcessingSummary> {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const workerId = options.workerId ?? `yc-os-${process.pid}`;
  const jobs = await store.claimQueuedClarificationEmailJobs(batchSize, workerId);
  const summary: ClarificationEmailProcessingSummary = {
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const job of jobs) {
    const body = emailBodyFor(job);
    if (!body) {
      summary.skipped += 1;
      const message = "Clarification email job is missing a body.";
      await store.markClarificationEmailFailed(job.id, message, retryAtFor(job, now, options).toISOString());
      summary.errors.push({ jobId: job.id, message });
      continue;
    }

    try {
      const result = await emailClient.send({
        to: job.toEmail,
        subject: job.subject,
        text: body,
        replyTo: job.fromEmail,
        tags: [
          { name: "workflow", value: "event-approvals" },
          { name: "kind", value: "clarification-email" }
        ],
        idempotencyKey: job.id
      });
      await store.markClarificationEmailSucceeded(job.id, result.id, { provider: result.provider }, now().toISOString());
      summary.succeeded += 1;
    } catch (error) {
      const message = sanitizeClarificationEmailError(error);
      await store.markClarificationEmailFailed(job.id, message, retryAtFor(job, now, options).toISOString());
      summary.failed += 1;
      summary.errors.push({ jobId: job.id, message });
    }
  }

  return summary;
}

export function createSupabaseClarificationEmailStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn?: typeof fetch
): ClarificationEmailStore {
  const client = createSupabaseServiceClientFromEnv(env, fetchFn);

  return {
    async claimQueuedClarificationEmailJobs(limit, workerId) {
      const rows = await client.rpc<Array<Record<string, unknown>>>("claim_clarification_email_jobs", {
        p_limit: limit,
        p_worker_id: workerId
      });

      return rows.map((row) => ({
        id: String(row.id),
        applicationId: String(row.application_id),
        attemptCount: numberValue(row.attempt_count) ?? 0,
        toEmail: String(row.to_email),
        fromEmail: String(row.from_email),
        subject: String(row.subject),
        bodyPreview: String(row.body_preview),
        payload: recordValue(row.payload)
      }));
    },

    async markClarificationEmailSucceeded(jobId, resendEmailId, responsePayload, sentAt) {
      await client.update("clarification_email_jobs", {
        status: "succeeded",
        resend_email_id: resendEmailId,
        response_payload: responsePayload,
        sent_at: sentAt,
        last_error: null,
        locked_at: null,
        locked_by: null
      }, {
        filters: [{ column: "id", value: jobId }],
        returning: "minimal"
      });
    },

    async markClarificationEmailFailed(jobId, errorMessage, scheduledAt) {
      await client.update("clarification_email_jobs", {
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

function createSupabaseClarificationEmailStoreForOperationFromEnv(
  operationId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn?: typeof fetch
): ClarificationEmailStore {
  const baseStore = createSupabaseClarificationEmailStoreFromEnv(env, fetchFn);
  const client = createSupabaseServiceClientFromEnv(env, fetchFn);

  return {
    ...baseStore,
    async claimQueuedClarificationEmailJobs(limit, workerId) {
      const rows = await client.rpc<Array<Record<string, unknown>>>("claim_clarification_email_jobs_for_operation", {
        p_limit: limit,
        p_operation_id: operationId,
        p_worker_id: workerId
      });

      return rows.map((row) => ({
        id: String(row.id),
        applicationId: String(row.application_id),
        attemptCount: numberValue(row.attempt_count) ?? 0,
        toEmail: String(row.to_email),
        fromEmail: String(row.from_email),
        subject: String(row.subject),
        bodyPreview: String(row.body_preview),
        payload: recordValue(row.payload)
      }));
    }
  };
}

function emailBodyFor(job: ClaimedClarificationEmailJob) {
  const payloadBody = stringValue(job.payload.body);
  return payloadBody ?? stringValue(job.payload.body_preview) ?? job.bodyPreview.trim();
}

function retryAtFor(
  job: ClaimedClarificationEmailJob,
  now: () => Date,
  options: ClarificationEmailProcessingOptions
) {
  const base = options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
  const max = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const delay = Math.min(base * 2 ** Math.max(0, job.attemptCount - 1), max);
  return new Date(now().getTime() + delay);
}

function sanitizeClarificationEmailError(error: unknown) {
  const message = error instanceof EmailDeliveryError
    ? `Resend API ${error.providerStatusCode ?? "error"}: ${error.providerCode ?? "delivery_error"}`
    : error instanceof Error
      ? error.message
      : "Unknown Resend clarification email failure";
  return message.slice(0, 500);
}

function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
