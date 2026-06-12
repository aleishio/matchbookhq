const DEFAULT_LUMA_BASE_URL = "https://public-api.luma.com";

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type LumaApprovalStatus =
  | "approved"
  | "session"
  | "pending_approval"
  | "invited"
  | "declined"
  | "waitlist";

export type LumaWritableGuestStatus = "approved" | "declined" | "pending_approval" | "waitlist";
export type LumaCreateGuestApprovalStatus = "approved" | "pending_approval" | "waitlist";
export type LumaCalendarStatus = "approved" | "pending";
export type LumaPlatform = "luma" | "external";

export type LumaClientConfig = {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: FetchFn;
  retry?: LumaRetryConfig;
};

export type LumaRetryConfig = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepFn?: (milliseconds: number) => Promise<void>;
};

export type LumaListEventsParams = {
  before?: string;
  after?: string;
  paginationCursor?: string;
  paginationLimit?: number;
  platforms?: LumaPlatform[];
  status?: LumaCalendarStatus;
  sortColumn?: "start_at";
  sortDirection?: "asc" | "desc" | "asc nulls last" | "desc nulls last";
};

export type LumaListGuestsParams = {
  eventId: string;
  approvalStatus?: LumaApprovalStatus;
  paginationCursor?: string;
  paginationLimit?: number;
  sortColumn?: "name" | "email" | "created_at" | "registered_at" | "checked_in_at";
  sortDirection?: "asc" | "desc" | "asc nulls last" | "desc nulls last";
};

export type LumaUpdateGuestStatusInput = {
  eventId: string;
  guest:
    | { type: "api_id"; apiId: string }
    | { type: "email"; email: string };
  status: LumaWritableGuestStatus;
  shouldRefund?: boolean;
  sendEmail?: boolean;
};

export type LumaAddGuestInput = {
  email: string;
  name?: string;
  phoneNumber?: string;
};

export type LumaAddGuestsInput = {
  eventId: string;
  guests: LumaAddGuestInput[];
  approvalStatus?: LumaCreateGuestApprovalStatus;
  sendEmail?: boolean;
};

export type LumaEventEntry = {
  id: string;
  api_id?: string;
  platform?: LumaPlatform;
  name: string;
  url?: string;
  start_at?: string;
  end_at?: string;
  timezone?: string;
  registration_questions?: unknown[];
  [key: string]: unknown;
};

export type LumaGuestEntry = {
  id: string;
  api_id?: string;
  user_id?: string;
  user_email: string;
  user_name?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
  phone_number?: string | null;
  approval_status: LumaApprovalStatus;
  registered_at?: string | null;
  registration_answers?: unknown[] | null;
  [key: string]: unknown;
};

export type LumaPaginatedResponse<T> = {
  entries: T[];
  next_cursor?: string | null;
  [key: string]: unknown;
};

export type LumaAddGuestsResponse = Record<string, unknown>;

export class LumaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LumaConfigurationError";
  }
}

export class LumaApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "LumaApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function createLumaClientFromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: FetchFn) {
  return createLumaClient({
    apiKey: readRequiredEnv(env, "LUMA_API_KEY"),
    baseUrl: env.LUMA_API_BASE_URL,
    fetchFn
  });
}

export function createLumaClient(config: LumaClientConfig) {
  const apiKey = normalizeApiKey(config.apiKey);
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_LUMA_BASE_URL);
  const fetchFn = config.fetchFn ?? fetch;
  const retry = normalizeRetryConfig(config.retry);

  return {
    listCalendarEvents(params: LumaListEventsParams = {}) {
      const query = new URLSearchParams();
      appendOptional(query, "before", params.before);
      appendOptional(query, "after", params.after);
      appendOptional(query, "pagination_cursor", params.paginationCursor);
      appendOptional(query, "pagination_limit", params.paginationLimit);
      appendOptional(query, "status", params.status);
      appendOptional(query, "sort_column", params.sortColumn);
      appendOptional(query, "sort_direction", params.sortDirection);
      for (const platform of params.platforms ?? []) query.append("platforms", platform);

      return lumaRequest<LumaPaginatedResponse<LumaEventEntry>>({
        apiKey,
        baseUrl,
        fetchFn,
        method: "GET",
        path: "/v1/calendar/list-events",
        query,
        retry
      });
    },

    listEventGuests(params: LumaListGuestsParams) {
      const query = new URLSearchParams();
      appendOptional(query, "event_id", params.eventId);
      appendOptional(query, "approval_status", params.approvalStatus);
      appendOptional(query, "pagination_cursor", params.paginationCursor);
      appendOptional(query, "pagination_limit", params.paginationLimit);
      appendOptional(query, "sort_column", params.sortColumn);
      appendOptional(query, "sort_direction", params.sortDirection);

      return lumaRequest<LumaPaginatedResponse<LumaGuestEntry>>({
        apiKey,
        baseUrl,
        fetchFn,
        method: "GET",
        path: "/v1/event/get-guests",
        query,
        retry
      });
    },

    updateGuestStatus(input: LumaUpdateGuestStatusInput) {
      return lumaRequest<Record<string, never>>({
        apiKey,
        baseUrl,
        fetchFn,
        method: "POST",
        path: "/v1/event/update-guest-status",
        body: {
          event_id: input.eventId,
          guest: guestPayloadFor(input.guest),
          status: input.status,
          ...(input.shouldRefund === undefined ? {} : { should_refund: input.shouldRefund }),
          ...(input.sendEmail === undefined ? {} : { send_email: input.sendEmail })
        },
        retry
      });
    },

    addGuests(input: LumaAddGuestsInput) {
      return lumaRequest<LumaAddGuestsResponse>({
        apiKey,
        baseUrl,
        fetchFn,
        method: "POST",
        path: "/v1/event/add-guests",
        body: {
          event_id: input.eventId,
          guests: input.guests.map(addGuestPayloadFor),
          ...(input.approvalStatus === undefined ? {} : { approval_status: input.approvalStatus }),
          ...(input.sendEmail === undefined ? {} : { send_email: input.sendEmail })
        },
        retry
      });
    }
  };
}

async function lumaRequest<T>({
  apiKey,
  baseUrl,
  fetchFn,
  method,
  path,
  query,
  body,
  retry
}: {
  apiKey: string;
  baseUrl: string;
  fetchFn: FetchFn;
  method: "GET" | "POST";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
  retry: Required<LumaRetryConfig>;
}): Promise<T> {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of query) url.searchParams.append(key, value);
  }

  for (let attempt = 0; attempt <= retry.maxRetries; attempt += 1) {
    const response = await fetchFn(url, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-luma-api-key": apiKey
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    const payload = await readJsonResponse(response);

    if (response.ok) {
      return payload as T;
    }

    if (attempt < retry.maxRetries && isRetryableResponse(response)) {
      await retry.sleepFn(delayForRetry(response, attempt, retry));
      continue;
    }

    throw new LumaApiError(`Lu.ma API request failed with status ${response.status}.`, response.status, payload);
  }

  throw new LumaApiError("Lu.ma API request failed after retry exhaustion.", 0, {});
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function guestPayloadFor(guest: LumaUpdateGuestStatusInput["guest"]) {
  if (guest.type === "api_id") {
    return {
      type: "api_id",
      api_id: guest.apiId
    };
  }

  return guest;
}

function addGuestPayloadFor(guest: LumaAddGuestInput) {
  return {
    email: guest.email,
    ...(guest.name === undefined ? {} : { name: guest.name }),
    ...(guest.phoneNumber === undefined ? {} : { phone_number: guest.phoneNumber })
  };
}

function appendOptional(query: URLSearchParams, key: string, value: string | number | undefined) {
  if (value === undefined || value === "") return;
  query.set(key, String(value));
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new LumaConfigurationError(`${key} is required for Lu.ma integration.`);
  return value;
}

function normalizeApiKey(apiKey: string) {
  const value = apiKey.trim();
  if (!value) throw new LumaConfigurationError("Lu.ma API key is required.");
  return value;
}

function normalizeBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).toString();
  } catch {
    throw new LumaConfigurationError("Lu.ma API base URL must be a valid URL.");
  }
}

function normalizeRetryConfig(retry: LumaRetryConfig | undefined): Required<LumaRetryConfig> {
  return {
    maxRetries: retry?.maxRetries ?? 2,
    baseDelayMs: retry?.baseDelayMs ?? 1_000,
    maxDelayMs: retry?.maxDelayMs ?? 10_000,
    sleepFn: retry?.sleepFn ?? sleep
  };
}

function isRetryableResponse(response: Response) {
  return response.status === 429 || response.status >= 500;
}

function delayForRetry(response: Response, attempt: number, retry: Required<LumaRetryConfig>) {
  const retryAfter = retryAfterDelayMs(response.headers.get("retry-after"));
  if (retryAfter !== undefined) return Math.min(retryAfter, retry.maxDelayMs);
  const exponentialDelay = retry.baseDelayMs * 2 ** attempt;
  return Math.min(exponentialDelay, retry.maxDelayMs);
}

function retryAfterDelayMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());

  return undefined;
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
