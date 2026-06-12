import type { FetchFn } from "../luma/client";

export type SupabaseServiceClientConfig = {
  url: string;
  serviceRoleKey: string;
  fetchFn?: FetchFn;
};

export type SupabaseFilter = {
  column: string;
  operator?: "eq" | "neq" | "lte" | "gte" | "lt" | "gt" | "in" | "is";
  value: string | number | boolean | null | Array<string | number>;
};

export type SupabaseSelectOptions = {
  select?: string;
  filters?: SupabaseFilter[];
  order?: string;
  limit?: number;
  offset?: number;
  extraParams?: Record<string, string>;
};

export type SupabaseMutationOptions = {
  onConflict?: string;
  returning?: "minimal" | "representation";
  ignoreDuplicates?: boolean;
  select?: string;
};

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export class SupabaseRestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "SupabaseRestError";
    this.status = status;
    this.payload = payload;
  }
}

export function createSupabaseServiceClientFromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: FetchFn) {
  return createSupabaseServiceClient({
    url: readRequiredEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    serviceRoleKey: readRequiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
    fetchFn
  });
}

export function createSupabaseServiceClient(config: SupabaseServiceClientConfig) {
  const baseUrl = normalizeSupabaseUrl(config.url);
  const serviceRoleKey = readValue(config.serviceRoleKey, "Supabase service role key is required.");
  const fetchFn = config.fetchFn ?? fetch;

  return {
    select<T>(table: string, options: SupabaseSelectOptions = {}) {
      const url = tableUrl(baseUrl, table);
      applySelectOptions(url, options);
      return supabaseRequest<T[]>({
        fetchFn,
        serviceRoleKey,
        method: "GET",
        url
      });
    },

    insert<T>(table: string, rows: unknown, options: SupabaseMutationOptions = {}) {
      return mutate<T>(baseUrl, fetchFn, serviceRoleKey, "POST", table, rows, options);
    },

    upsert<T>(table: string, rows: unknown, options: SupabaseMutationOptions = {}) {
      return mutate<T>(baseUrl, fetchFn, serviceRoleKey, "POST", table, rows, {
        ...options,
        ignoreDuplicates: options.ignoreDuplicates ?? false
      });
    },

    update<T>(table: string, patch: unknown, options: SupabaseSelectOptions & SupabaseMutationOptions = {}) {
      const url = tableUrl(baseUrl, table);
      applySelectOptions(url, options);
      return supabaseRequest<T[]>({
        fetchFn,
        serviceRoleKey,
        method: "PATCH",
        url,
        body: patch,
        prefer: preferHeader(options)
      });
    },

    rpc<T>(functionName: string, body: unknown) {
      const url = new URL(`/rest/v1/rpc/${functionName}`, baseUrl);
      return supabaseRequest<T>({
        fetchFn,
        serviceRoleKey,
        method: "POST",
        url,
        body,
        prefer: "return=representation"
      });
    }
  };
}

function mutate<T>(
  baseUrl: string,
  fetchFn: FetchFn,
  serviceRoleKey: string,
  method: "POST",
  table: string,
  rows: unknown,
  options: SupabaseMutationOptions
) {
  const url = tableUrl(baseUrl, table);
  if (options.onConflict) url.searchParams.set("on_conflict", options.onConflict);
  if (options.select) url.searchParams.set("select", options.select);

  return supabaseRequest<T[]>({
    fetchFn,
    serviceRoleKey,
    method,
    url,
    body: rows,
    prefer: preferHeader(options)
  });
}

async function supabaseRequest<T>({
  fetchFn,
  serviceRoleKey,
  method,
  url,
  body,
  prefer
}: {
  fetchFn: FetchFn;
  serviceRoleKey: string;
  method: "GET" | "POST" | "PATCH";
  url: URL;
  body?: unknown;
  prefer?: string;
}): Promise<T> {
  const response = await fetchFn(url, {
    method,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      accept: "application/json",
      "content-type": "application/json",
      ...(prefer ? { prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await readPayload(response);

  if (!response.ok) {
    throw new SupabaseRestError(`Supabase REST request failed with status ${response.status}.`, response.status, payload);
  }

  return payload as T;
}

function tableUrl(baseUrl: string, table: string) {
  return new URL(`/rest/v1/${table}`, baseUrl);
}

function applySelectOptions(url: URL, options: SupabaseSelectOptions) {
  url.searchParams.set("select", options.select ?? "*");
  for (const filter of options.filters ?? []) {
    url.searchParams.set(filter.column, filterValue(filter));
  }
  if (options.order) url.searchParams.set("order", options.order);
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  if (options.offset !== undefined) url.searchParams.set("offset", String(options.offset));
  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    url.searchParams.set(key, value);
  }
}

function filterValue(filter: SupabaseFilter) {
  const operator = filter.operator ?? "eq";
  if (operator === "in") {
    if (!Array.isArray(filter.value)) throw new SupabaseConfigurationError("Supabase in filter requires an array value.");
    return `in.(${filter.value.map((item) => String(item)).join(",")})`;
  }
  if (operator === "is") return `is.${filter.value === null ? "null" : String(filter.value)}`;
  return `${operator}.${String(filter.value)}`;
}

function preferHeader(options: SupabaseMutationOptions) {
  const parts = [`return=${options.returning ?? "representation"}`];
  if (options.onConflict) {
    parts.push(options.ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates");
  }
  return parts.join(",");
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function readRequiredEnv(env: NodeJS.ProcessEnv, keyOrKeys: string | string[]) {
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  throw new SupabaseConfigurationError(`${keys.join(" or ")} is required for Supabase server-side access.`);
}

function readValue(value: string | undefined, message: string) {
  const normalized = value?.trim();
  if (!normalized) throw new SupabaseConfigurationError(message);
  return normalized;
}

function normalizeSupabaseUrl(url: string) {
  try {
    return new URL(url).toString();
  } catch {
    throw new SupabaseConfigurationError("Supabase URL must be a valid URL.");
  }
}
