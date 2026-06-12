import { processLumaWritebacksFromEnv, type LumaWritebackOptions, type LumaWritebackSummary } from "./writebacks";
import type { FetchFn } from "./client";

export type ImmediateLumaWritebackWorkerOptions = LumaWritebackOptions & {
  fetchFn?: FetchFn;
};

export class LumaWritebackWorkerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LumaWritebackWorkerConfigurationError";
  }
}

export class LumaWritebackWorkerInvocationError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "LumaWritebackWorkerInvocationError";
    this.status = status;
    this.payload = payload;
  }
}

export async function processImmediateLumaWritebacksFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ImmediateLumaWritebackWorkerOptions = {}
): Promise<LumaWritebackSummary> {
  if (useLocalImmediateWorker(env)) {
    return processLumaWritebacksFromEnv(env, options);
  }

  try {
    return await invokeSupabaseLumaWritebackWorkerFromEnv(env, options);
  } catch (error) {
    if (!shouldFallbackToLocalWritebackWorker(error, env)) throw error;
    return processLumaWritebacksFromEnv(env, options);
  }
}

export async function invokeSupabaseLumaWritebackWorkerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ImmediateLumaWritebackWorkerOptions = {}
): Promise<LumaWritebackSummary> {
  const url = supabaseWritebackWorkerUrl(env);
  const serviceRoleKey = readRequiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const actionSecret = readRequiredEnv(env, ["LUMA_SYNC_SECRET", "CRON_SECRET", "WEBHOOK_SECRET"]);
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${serviceRoleKey}`,
      "x-cron-secret": actionSecret
    },
    body: JSON.stringify({
      batchSize: options.batchSize,
      workerId: options.workerId,
      scope: options.scope
    })
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new LumaWritebackWorkerInvocationError(
      `Supabase Lu.ma writeback worker failed with status ${response.status}.`,
      response.status,
      payload
    );
  }

  return normalizeSummary(payload);
}

function useLocalImmediateWorker(env: NodeJS.ProcessEnv) {
  const strategy = env.LUMA_WRITEBACK_WORKER_STRATEGY?.trim().toLowerCase();
  if (strategy === "next") return true;
  if (strategy === "supabase") return false;
  return env.NODE_ENV !== "production" && !env.LUMA_WRITEBACK_WORKER_URL?.trim();
}

function shouldFallbackToLocalWritebackWorker(error: unknown, env: NodeJS.ProcessEnv) {
  return error instanceof LumaWritebackWorkerInvocationError
    && error.status === 404
    && !env.LUMA_WRITEBACK_WORKER_URL?.trim();
}

function supabaseWritebackWorkerUrl(env: NodeJS.ProcessEnv) {
  const configured = env.LUMA_WRITEBACK_WORKER_URL?.trim();
  if (configured) return configured;

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new LumaWritebackWorkerConfigurationError("SUPABASE_URL or LUMA_WRITEBACK_WORKER_URL is required.");
  }

  return new URL("/functions/v1/luma-writebacks", supabaseUrl).toString();
}

function readRequiredEnv(env: NodeJS.ProcessEnv, keyOrKeys: string | string[]) {
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  throw new LumaWritebackWorkerConfigurationError(`${keys.join(" or ")} is required.`);
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function normalizeSummary(payload: unknown): LumaWritebackSummary {
  if (!isRecord(payload)) {
    return { claimed: 0, succeeded: 0, failed: 1, skipped: 0, errors: [{ jobId: "unknown", message: "Invalid worker response." }] };
  }

  return {
    claimed: numberValue(payload.claimed),
    succeeded: numberValue(payload.succeeded),
    failed: numberValue(payload.failed),
    skipped: numberValue(payload.skipped),
    errors: Array.isArray(payload.errors)
      ? payload.errors.filter(isRecord).map((error) => ({
        jobId: stringValue(error.jobId) ?? "unknown",
        message: stringValue(error.message) ?? "Unknown Lu.ma writeback worker error."
      }))
      : []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
