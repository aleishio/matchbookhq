import type { FetchFn } from "../luma/client";
import {
  processClarificationEmailsForOperationFromEnv,
  type ClarificationEmailProcessingOptions,
  type ClarificationEmailProcessingSummary
} from "./clarification-emails";

export type ImmediateClarificationEmailWorkerOptions = ClarificationEmailProcessingOptions & {
  fetchFn?: FetchFn;
  operationId?: string;
};

export class ClarificationEmailWorkerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarificationEmailWorkerConfigurationError";
  }
}

export class ClarificationEmailWorkerInvocationError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ClarificationEmailWorkerInvocationError";
    this.status = status;
    this.payload = payload;
  }
}

export async function processImmediateClarificationEmailsForOperationFromEnv(
  operationId: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ImmediateClarificationEmailWorkerOptions = {}
): Promise<ClarificationEmailProcessingSummary> {
  if (useLocalImmediateEmailWorker(env)) {
    return processClarificationEmailsForOperationFromEnv(operationId, env, options);
  }

  const workerOptions = {
    ...options,
    operationId,
    workerId: options.workerId ?? `yc-os-agent-clarification-${operationId}`
  };

  try {
    return await invokeSupabaseClarificationEmailWorkerFromEnv(env, workerOptions);
  } catch (error) {
    if (!shouldFallbackToLocalEmailWorker(error, env)) throw error;
    return processClarificationEmailsForOperationFromEnv(operationId, env, workerOptions);
  }
}

export async function invokeSupabaseClarificationEmailWorkerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ImmediateClarificationEmailWorkerOptions = {}
): Promise<ClarificationEmailProcessingSummary> {
  const url = supabaseClarificationEmailWorkerUrl(env);
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
      operationId: options.operationId,
      workerId: options.workerId
    })
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new ClarificationEmailWorkerInvocationError(
      `Supabase clarification email worker failed with status ${response.status}.`,
      response.status,
      payload
    );
  }

  return normalizeSummary(payload);
}

function useLocalImmediateEmailWorker(env: NodeJS.ProcessEnv) {
  const strategy = env.CLARIFICATION_EMAIL_WORKER_STRATEGY?.trim().toLowerCase();
  return strategy === "next";
}

function shouldFallbackToLocalEmailWorker(error: unknown, env: NodeJS.ProcessEnv) {
  return error instanceof ClarificationEmailWorkerInvocationError
    && error.status === 404
    && !env.CLARIFICATION_EMAIL_WORKER_URL?.trim();
}

function supabaseClarificationEmailWorkerUrl(env: NodeJS.ProcessEnv) {
  const configured = env.CLARIFICATION_EMAIL_WORKER_URL?.trim();
  if (configured) return configured;

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new ClarificationEmailWorkerConfigurationError("SUPABASE_URL or CLARIFICATION_EMAIL_WORKER_URL is required.");
  }

  return new URL("/functions/v1/clarification-emails", supabaseUrl).toString();
}

function readRequiredEnv(env: NodeJS.ProcessEnv, keyOrKeys: string | string[]) {
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  throw new ClarificationEmailWorkerConfigurationError(`${keys.join(" or ")} is required.`);
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

function normalizeSummary(payload: unknown): ClarificationEmailProcessingSummary {
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
        message: stringValue(error.message) ?? "Unknown clarification email worker error."
      }))
      : []
  };
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
