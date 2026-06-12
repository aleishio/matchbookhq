import { createLumaClientFromEnv, LumaApiError, type FetchFn, type LumaAddGuestsInput, type LumaAddGuestsResponse } from "./luma/client";
import { createSupabaseServiceClientFromEnv } from "./supabase/service-client";

export type ClaimedAgentGuestRequest = {
  approvalStatus: LumaAddGuestsInput["approvalStatus"];
  attemptCount: number;
  eventId: string;
  guests: LumaAddGuestsInput["guests"];
  id: string;
  lumaEventId: string;
  sendEmail: boolean;
};

export type AgentGuestRequestWorkerStore = {
  claimGuestRequests(limit: number, workerId: string, scope?: { requestId?: string }): Promise<ClaimedAgentGuestRequest[]>;
  markGuestRequestSucceeded(requestId: string, responsePayload: Record<string, unknown>, completedAt: string): Promise<void>;
  markGuestRequestFailed(requestId: string, errorMessage: string, scheduledAt: string): Promise<void>;
};

export type AgentGuestRequestWorkerClient = {
  addGuests(input: LumaAddGuestsInput): Promise<LumaAddGuestsResponse>;
};

export type AgentGuestRequestWorkerOptions = {
  baseRetryDelayMs?: number;
  batchSize?: number;
  fetchFn?: FetchFn;
  maxRetryDelayMs?: number;
  now?: () => Date;
  requestId?: string;
  workerId?: string;
};

export type AgentGuestRequestWorkerSummary = {
  claimed: number;
  errors: Array<{ message: string; requestId: string }>;
  failed: number;
  succeeded: number;
};

export class AgentGuestRequestWorkerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGuestRequestWorkerConfigurationError";
  }
}

export class AgentGuestRequestWorkerInvocationError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "AgentGuestRequestWorkerInvocationError";
    this.status = status;
    this.payload = payload;
  }
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_BASE_RETRY_DELAY_MS = 60_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30 * 60_000;

export async function processAgentGuestRequestsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return processAgentGuestRequests({
    lumaClient: createLumaClientFromEnv(env),
    options: {
      batchSize: numberFromEnv(env.AGENT_GUEST_REQUEST_BATCH_SIZE, DEFAULT_BATCH_SIZE)
    },
    store: createSupabaseAgentGuestRequestWorkerStoreFromEnv(env)
  });
}

export async function processImmediateAgentGuestRequestFromEnv(
  requestId: string,
  env: NodeJS.ProcessEnv = process.env,
  options: AgentGuestRequestWorkerOptions = {}
) {
  if (useLocalImmediateGuestWorker(env)) {
    return processAgentGuestRequests({
      lumaClient: createLumaClientFromEnv(env, options.fetchFn),
      options: {
        ...options,
        batchSize: options.batchSize ?? 1,
        requestId: normalizeAgentGuestRequestId(requestId),
        workerId: options.workerId ?? `yc-os-agent-guest-${normalizeAgentGuestRequestId(requestId)}`
      },
      store: createSupabaseAgentGuestRequestWorkerStoreFromEnv(env, options.fetchFn)
    });
  }

  const workerOptions = {
    ...options,
    batchSize: options.batchSize ?? 1,
    requestId: normalizeAgentGuestRequestId(requestId),
    workerId: options.workerId ?? `yc-os-agent-guest-${normalizeAgentGuestRequestId(requestId)}`
  };

  try {
    return await invokeSupabaseAgentGuestRequestWorkerFromEnv(env, workerOptions);
  } catch (error) {
    if (!shouldFallbackToLocalGuestWorker(error, env)) throw error;
    return processAgentGuestRequests({
      lumaClient: createLumaClientFromEnv(env, options.fetchFn),
      options: workerOptions,
      store: createSupabaseAgentGuestRequestWorkerStoreFromEnv(env, options.fetchFn)
    });
  }
}

export async function invokeSupabaseAgentGuestRequestWorkerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: AgentGuestRequestWorkerOptions = {}
): Promise<AgentGuestRequestWorkerSummary> {
  const url = supabaseAgentGuestWorkerUrl(env);
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
      requestId: options.requestId
    })
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new AgentGuestRequestWorkerInvocationError(
      `Supabase agent guest request worker failed with status ${response.status}.`,
      response.status,
      payload
    );
  }

  return normalizeSummary(payload);
}

export async function processAgentGuestRequests({
  lumaClient,
  options = {},
  store
}: {
  lumaClient: AgentGuestRequestWorkerClient;
  options?: AgentGuestRequestWorkerOptions;
  store: AgentGuestRequestWorkerStore;
}): Promise<AgentGuestRequestWorkerSummary> {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const workerId = options.workerId ?? `yc-os-agent-guests-${process.pid}`;
  const requests = await store.claimGuestRequests(batchSize, workerId, options.requestId ? { requestId: options.requestId } : undefined);
  const summary: AgentGuestRequestWorkerSummary = {
    claimed: requests.length,
    errors: [],
    failed: 0,
    succeeded: 0
  };

  for (const request of requests) {
    try {
      const response = await lumaClient.addGuests({
        approvalStatus: request.approvalStatus,
        eventId: request.lumaEventId,
        guests: request.guests,
        sendEmail: request.sendEmail
      });
      await store.markGuestRequestSucceeded(request.id, {
        response_keys: Object.keys(response).slice(0, 12)
      }, now().toISOString());
      summary.succeeded += 1;
    } catch (error) {
      const message = sanitizeGuestRequestError(error);
      await store.markGuestRequestFailed(request.id, message, retryAtFor(request, now, options).toISOString());
      summary.failed += 1;
      summary.errors.push({ message, requestId: request.id });
    }
  }

  return summary;
}

function retryAtFor(
  request: ClaimedAgentGuestRequest,
  now: () => Date,
  options: AgentGuestRequestWorkerOptions
) {
  const base = options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
  const max = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const delay = Math.min(base * 2 ** Math.max(0, request.attemptCount - 1), max);
  return new Date(now().getTime() + delay);
}

function sanitizeGuestRequestError(error: unknown) {
  const message = error instanceof LumaApiError
    ? `Lu.ma API status ${error.status}`
    : error instanceof Error
      ? error.message
      : "Unknown agent guest request failure";
  return message.slice(0, 500);
}

function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createSupabaseAgentGuestRequestWorkerStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn?: FetchFn
): AgentGuestRequestWorkerStore {
  const client = createSupabaseServiceClientFromEnv(env, fetchFn);

  return {
    async claimGuestRequests(limit, workerId, scope) {
      const rows = await client.rpc<Array<Record<string, unknown>>>("claim_agent_guest_requests", {
        p_limit: limit,
        p_request_id: scope?.requestId ?? null,
        p_worker_id: workerId
      });

      return rows.map((row) => ({
        approvalStatus: stringValue(row.approval_status) as LumaAddGuestsInput["approvalStatus"],
        attemptCount: numberValue(row.attempt_count) ?? 0,
        eventId: String(row.event_id),
        guests: guestsValue(row.guests),
        id: String(row.id),
        lumaEventId: String(row.luma_event_id),
        sendEmail: Boolean(row.send_email)
      }));
    },

    async markGuestRequestSucceeded(requestId, responsePayload, completedAt) {
      await client.update("agent_guest_requests", {
        completed_at: completedAt,
        error_message: null,
        locked_at: null,
        locked_by: null,
        result_payload: responsePayload,
        status: "sent_to_luma",
        updated_at: completedAt
      }, {
        filters: [{ column: "id", value: requestId }],
        returning: "minimal"
      });
    },

    async markGuestRequestFailed(requestId, errorMessage, scheduledAt) {
      await client.update("agent_guest_requests", {
        error_message: errorMessage,
        locked_at: null,
        locked_by: null,
        scheduled_at: scheduledAt,
        status: "failed",
        updated_at: new Date().toISOString()
      }, {
        filters: [{ column: "id", value: requestId }],
        returning: "minimal"
      });
    }
  };
}

function useLocalImmediateGuestWorker(env: NodeJS.ProcessEnv) {
  const strategy = env.AGENT_GUEST_REQUEST_WORKER_STRATEGY?.trim().toLowerCase();
  return strategy === "next";
}

function shouldFallbackToLocalGuestWorker(error: unknown, env: NodeJS.ProcessEnv) {
  return error instanceof AgentGuestRequestWorkerInvocationError
    && error.status === 404
    && !env.AGENT_GUEST_REQUEST_WORKER_URL?.trim();
}

function supabaseAgentGuestWorkerUrl(env: NodeJS.ProcessEnv) {
  const configured = env.AGENT_GUEST_REQUEST_WORKER_URL?.trim();
  if (configured) return configured;

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new AgentGuestRequestWorkerConfigurationError("SUPABASE_URL or AGENT_GUEST_REQUEST_WORKER_URL is required.");
  }

  return new URL("/functions/v1/agent-guest-requests", supabaseUrl).toString();
}

function readRequiredEnv(env: NodeJS.ProcessEnv, keyOrKeys: string | string[]) {
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  throw new AgentGuestRequestWorkerConfigurationError(`${keys.join(" or ")} is required.`);
}

function normalizeAgentGuestRequestId(requestId: string) {
  return requestId.replace(/^agent_guest_request_/, "");
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

function normalizeSummary(payload: unknown): AgentGuestRequestWorkerSummary {
  if (!isRecord(payload)) {
    return { claimed: 0, succeeded: 0, failed: 1, errors: [{ requestId: "unknown", message: "Invalid worker response." }] };
  }

  return {
    claimed: numberValue(payload.claimed) ?? 0,
    succeeded: numberValue(payload.succeeded) ?? 0,
    failed: numberValue(payload.failed) ?? 0,
    errors: Array.isArray(payload.errors)
      ? payload.errors.filter(isRecord).map((error) => ({
        requestId: stringValue(error.requestId) ?? "unknown",
        message: stringValue(error.message) ?? "Unknown agent guest request worker error."
      }))
      : []
  };
}

function guestsValue(value: unknown): LumaAddGuestsInput["guests"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((guest): guest is Record<string, unknown> => typeof guest === "object" && guest !== null && !Array.isArray(guest))
    .map((guest) => ({
      email: String(guest.email ?? ""),
      ...(typeof guest.name === "string" ? { name: guest.name } : {}),
      ...(typeof guest.phoneNumber === "string" ? { phoneNumber: guest.phoneNumber } : {})
    }))
    .filter((guest) => guest.email);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
