type ClarificationEmailJob = {
  id: string;
  application_id: string;
  attempt_count: number;
  to_email: string;
  from_email: string;
  subject: string;
  body_preview: string;
  payload: Record<string, unknown>;
};

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ jobId: string; message: string }>;
};

type RequestBody = {
  batchSize?: number;
  workerId?: string;
  operationId?: string;
  background?: boolean;
};

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BASE_RETRY_DELAY_MS = 60_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30 * 60_000;
const RESEND_API_URL = "https://api.resend.com/emails";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readBody(request);
    const run = processEmails(body);

    if (body.background === true) {
      EdgeRuntime.waitUntil(run);
      return jsonResponse({ accepted: true }, 202);
    }

    const summary = await run;
    return jsonResponse(summary, summary.failed > 0 ? 207 : 200);
  } catch (error) {
    return jsonResponse(
      { error: "clarification_email_worker_error", message: errorMessage(error) },
      configurationError(error) ? 500 : 400
    );
  }
});

async function processEmails(body: RequestBody): Promise<WorkerSummary> {
  const batchSize = boundedInteger(body.batchSize, DEFAULT_BATCH_SIZE, 1, 100);
  const workerId = body.workerId || "yc-os-clarification-edge";
  const jobs = await claimJobs(batchSize, workerId, body.operationId);
  const summary: WorkerSummary = {
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const job of jobs) {
    const bodyText = emailBodyFor(job);
    if (!bodyText) {
      const message = "Clarification email job is missing a body.";
      await markJobFailed(job.id, message, retryAtFor(job).toISOString());
      summary.skipped += 1;
      summary.errors.push({ jobId: job.id, message });
      continue;
    }

    try {
      const result = await sendResendEmail(job, bodyText);
      await markJobSucceeded(job.id, result.id, { provider: "resend" }, new Date().toISOString());
      summary.succeeded += 1;
    } catch (error) {
      const message = sanitizeWorkerError(error);
      await markJobFailed(job.id, message, retryAtFor(job).toISOString());
      summary.failed += 1;
      summary.errors.push({ jobId: job.id, message });
    }
  }

  return summary;
}

async function claimJobs(limit: number, workerId: string, operationId?: string): Promise<ClarificationEmailJob[]> {
  if (operationId) {
    return supabaseRpc<ClarificationEmailJob[]>("claim_clarification_email_jobs_for_operation", {
      p_limit: limit,
      p_operation_id: operationId,
      p_worker_id: workerId
    });
  }

  return supabaseRpc<ClarificationEmailJob[]>("claim_clarification_email_jobs", {
    p_limit: limit,
    p_worker_id: workerId
  });
}

async function markJobSucceeded(jobId: string, resendEmailId: string, responsePayload: Record<string, unknown>, sentAt: string) {
  await supabaseTablePatch("clarification_email_jobs", jobId, {
    status: "succeeded",
    resend_email_id: resendEmailId,
    response_payload: responsePayload,
    sent_at: sentAt,
    last_error: null,
    locked_at: null,
    locked_by: null
  });
}

async function markJobFailed(jobId: string, error: string, scheduledAt: string) {
  await supabaseTablePatch("clarification_email_jobs", jobId, {
    status: "failed",
    last_error: error,
    scheduled_at: scheduledAt,
    locked_at: null,
    locked_by: null
  });
}

async function sendResendEmail(job: ClarificationEmailJob, text: string): Promise<{ id: string }> {
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "content-type": "application/json",
      "idempotency-key": job.id
    },
    body: JSON.stringify({
      from: resendFrom(),
      to: [job.to_email],
      subject: job.subject,
      text,
      reply_to: [job.from_email || requiredEnv("RESEND_REPLY_TO_EMAIL")],
      tags: [
        { name: "workflow", value: "event-approvals" },
        { name: "kind", value: "clarification-email" }
      ]
    })
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new ProviderApiError(response.status, payload);
  }

  if (!isRecord(payload) || typeof payload.id !== "string") {
    throw new Error("Resend response did not include an email id.");
  }

  return { id: payload.id };
}

function resendFrom() {
  const fromEmail = requiredEnv("RESEND_FROM_EMAIL");
  const fromName = Deno.env.get("RESEND_FROM_NAME")?.trim() || "YC OS";
  return `${fromName} <${fromEmail}>`;
}

function emailBodyFor(job: ClarificationEmailJob) {
  return stringValue(job.payload.body) ?? stringValue(job.payload.body_preview) ?? job.body_preview?.trim();
}

function retryAtFor(job: ClarificationEmailJob) {
  const delay = Math.min(
    DEFAULT_BASE_RETRY_DELAY_MS * 2 ** Math.max(0, Number(job.attempt_count ?? 1) - 1),
    DEFAULT_MAX_RETRY_DELAY_MS
  );
  return new Date(Date.now() + delay);
}

async function supabaseRpc<T>(functionName: string, body: unknown): Promise<T> {
  const url = new URL(`/rest/v1/rpc/${functionName}`, supabaseUrl());
  const response = await fetch(url, supabaseRequestInit("POST", body, "return=representation"));
  const payload = await readJson(response);

  if (!response.ok) {
    throw new SupabaseApiError(response.status, payload);
  }

  return payload as T;
}

async function supabaseTablePatch(table: string, id: string, patch: unknown) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl());
  url.searchParams.set("id", `eq.${id}`);
  const response = await fetch(url, supabaseRequestInit("PATCH", patch, "return=minimal"));
  const payload = await readJson(response);

  if (!response.ok) {
    throw new SupabaseApiError(response.status, payload);
  }
}

function supabaseRequestInit(method: "POST" | "PATCH", body: unknown, prefer: string): RequestInit {
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    method,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      accept: "application/json",
      "content-type": "application/json",
      prefer
    },
    body: JSON.stringify(body)
  };
}

function authorize(request: Request) {
  const expected = Deno.env.get("LUMA_SYNC_SECRET") || Deno.env.get("CRON_SECRET") || Deno.env.get("WEBHOOK_SECRET");
  if (!expected) {
    return jsonResponse({ error: "server_action_secret_missing" }, 500);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const cronSecret = request.headers.get("x-cron-secret") ?? "";

  if (cronSecret === expected || bearer === expected || bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return null;
  return jsonResponse({ error: "unauthorized" }, 401);
}

async function readBody(request: Request): Promise<RequestBody> {
  const payload = await readJson(request);
  return isRecord(payload) ? payload : {};
}

async function readJson(input: Request | Response): Promise<unknown> {
  const text = await input.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new ConfigurationError(`${name} is required.`);
  return value;
}

function supabaseUrl() {
  return normalizeUrl(Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") || "");
}

function normalizeUrl(value: string) {
  try {
    return new URL(value).toString();
  } catch {
    throw new ConfigurationError("URL configuration is invalid.");
  }
}

function sanitizeWorkerError(error: unknown) {
  if (error instanceof ProviderApiError) return `Resend API status ${error.status}`;
  if (error instanceof SupabaseApiError) return `Supabase API status ${error.status}`;
  return errorMessage(error).slice(0, 500);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown clarification email worker failure.";
}

function configurationError(error: unknown) {
  return error instanceof ConfigurationError;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ConfigurationError extends Error {}

class ProviderApiError extends Error {
  constructor(readonly status: number, readonly payload: unknown) {
    super(`Provider API request failed with status ${status}.`);
  }
}

class SupabaseApiError extends Error {
  constructor(readonly status: number, readonly payload: unknown) {
    super(`Supabase API request failed with status ${status}.`);
  }
}
