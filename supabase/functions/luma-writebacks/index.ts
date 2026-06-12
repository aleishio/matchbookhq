type LumaWritebackJob = {
  id: string;
  application_id: string;
  target_status: "approved" | "declined" | string;
  attempt_count: number;
  event_api_id: string;
  guest_api_id?: string | null;
  guest_email?: string | null;
  should_refund?: boolean | null;
  send_email?: boolean | null;
};

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

type LumaWritebackSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ jobId: string; message: string }>;
};

type RequestBody = {
  batchSize?: number;
  workerId?: string;
  scope?: {
    operationId?: string;
    jobIds?: string[];
  };
  background?: boolean;
};

const DEFAULT_LUMA_BASE_URL = "https://public-api.luma.com";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BASE_RETRY_DELAY_MS = 60_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30 * 60_000;

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readBody(request);
    const run = processWritebacks(body);

    if (body.background === true) {
      EdgeRuntime.waitUntil(run);
      return jsonResponse({ accepted: true }, 202);
    }

    const summary = await run;
    return jsonResponse(summary, summary.failed > 0 ? 207 : 200);
  } catch (error) {
    return jsonResponse(
      { error: "luma_writeback_worker_error", message: errorMessage(error) },
      configurationError(error) ? 500 : 400
    );
  }
});

async function processWritebacks(body: RequestBody): Promise<LumaWritebackSummary> {
  const batchSize = boundedInteger(body.batchSize, DEFAULT_BATCH_SIZE, 1, 100);
  const workerId = body.workerId || "yc-os-supabase-edge";
  const jobs = await claimJobs(batchSize, workerId, body.scope);
  const summary: LumaWritebackSummary = {
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const job of jobs) {
    if (job.target_status !== "approved" && job.target_status !== "declined") {
      summary.skipped += 1;
      const message = `Unsupported Lu.ma writeback status ${job.target_status}.`;
      await markJobFailed(job.id, message, retryAtFor(job).toISOString());
      summary.errors.push({ jobId: job.id, message });
      continue;
    }

    try {
      await updateLumaGuestStatus(job);
      await markJobSucceeded(job.id, { ok: true }, new Date().toISOString());
      summary.succeeded += 1;
    } catch (error) {
      const message = sanitizeWritebackError(error);
      await markJobFailed(job.id, message, retryAtFor(job).toISOString());
      summary.failed += 1;
      summary.errors.push({ jobId: job.id, message });
    }
  }

  return summary;
}

async function claimJobs(
  limit: number,
  workerId: string,
  scope?: RequestBody["scope"]
): Promise<LumaWritebackJob[]> {
  return supabaseRpc<LumaWritebackJob[]>("claim_luma_writeback_jobs", {
    p_limit: limit,
    p_worker_id: workerId,
    p_bulk_operation_id: scope?.operationId ?? null,
    p_job_ids: scope?.jobIds?.length ? scope.jobIds : null
  });
}

async function markJobSucceeded(jobId: string, responsePayload: Record<string, unknown>, completedAt: string) {
  await supabaseTablePatch("luma_writeback_jobs", jobId, {
    status: "succeeded",
    response_payload: responsePayload,
    completed_at: completedAt,
    last_error: null,
    locked_at: null,
    locked_by: null
  });
}

async function markJobFailed(jobId: string, error: string, scheduledAt: string) {
  await supabaseTablePatch("luma_writeback_jobs", jobId, {
    status: "failed",
    last_error: error,
    scheduled_at: scheduledAt,
    locked_at: null,
    locked_by: null
  });
}

async function updateLumaGuestStatus(job: LumaWritebackJob) {
  const baseUrl = normalizeUrl(Deno.env.get("LUMA_API_BASE_URL") || DEFAULT_LUMA_BASE_URL);
  const url = new URL("/v1/event/update-guest-status", baseUrl);
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-luma-api-key": requiredEnv("LUMA_API_KEY")
    },
    body: JSON.stringify({
      event_id: job.event_api_id,
      guest: guestPayloadFor(job),
      status: job.target_status,
      ...(typeof job.should_refund === "boolean" ? { should_refund: job.should_refund } : {}),
      ...(typeof job.send_email === "boolean" ? { send_email: job.send_email } : {})
    })
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new ProviderApiError(response.status, payload);
  }
}

function guestPayloadFor(job: LumaWritebackJob) {
  if (job.guest_api_id) return { api_id: job.guest_api_id };
  if (job.guest_email) return { email: job.guest_email };
  throw new Error("Lu.ma writeback job is missing guest api id and email.");
}

async function fetchWithRetry(url: URL, init: RequestInit) {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    const response = await fetch(url, init);
    if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 3) return response;

    await sleep(retryDelayMs(response, attempt));
  }

  throw new Error("unreachable");
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000);
  }

  return Math.min(500 * 2 ** attempt, 10_000);
}

function retryAtFor(job: LumaWritebackJob) {
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

function sanitizeWritebackError(error: unknown) {
  if (error instanceof ProviderApiError) return `Lu.ma API status ${error.status}`;
  if (error instanceof SupabaseApiError) return `Supabase API status ${error.status}`;
  return errorMessage(error).slice(0, 500);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Lu.ma writeback worker failure.";
}

function configurationError(error: unknown) {
  return error instanceof ConfigurationError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
