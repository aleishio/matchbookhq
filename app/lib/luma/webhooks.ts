import { createHmac, timingSafeEqual } from "node:crypto";

import { createSupabaseServiceClientFromEnv } from "../supabase/service-client";

export type LumaWebhookVerificationInput = {
  rawBody: string;
  secret: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  toleranceSeconds?: number;
  now?: () => Date;
};

export type LumaWebhookStore = {
  recordProviderWebhookEvent(input: {
    eventType: string;
    providerEventId?: string;
    payload: Record<string, unknown>;
  }): Promise<{ inserted: boolean }>;
};

export type LumaWebhookResult = {
  verified: boolean;
  eventType: string;
  providerEventId?: string;
  inserted: boolean;
  shouldSync: boolean;
  lumaEventId?: string;
};

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export class LumaWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LumaWebhookSignatureError";
  }
}

export async function handleLumaWebhook({
  rawBody,
  headers,
  store,
  secret,
  now
}: {
  rawBody: string;
  headers: Headers;
  store: LumaWebhookStore;
  secret: string;
  now?: () => Date;
}): Promise<LumaWebhookResult> {
  verifyLumaWebhookSignature({
    rawBody,
    secret,
    signatureHeader: headers.get("webhook-signature"),
    timestampHeader: headers.get("webhook-timestamp"),
    now
  });

  const payload = parseWebhookPayload(rawBody);
  const eventType = typeof payload.type === "string" ? payload.type : "unknown";
  const providerEventId = headers.get("webhook-id") ?? stringField(payload.id);
  const stored = await store.recordProviderWebhookEvent({
    eventType,
    providerEventId,
    payload
  });
  const lumaEventId = extractLumaEventId(payload);

  return {
    verified: true,
    eventType,
    providerEventId,
    inserted: stored.inserted,
    shouldSync: shouldSyncForEventType(eventType),
    lumaEventId
  };
}

export function verifyLumaWebhookSignature({
  rawBody,
  secret,
  signatureHeader,
  timestampHeader,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  now = () => new Date()
}: LumaWebhookVerificationInput) {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) throw new LumaWebhookSignatureError("Lu.ma webhook secret is required.");
  if (!signatureHeader) throw new LumaWebhookSignatureError("Missing Lu.ma webhook signature.");

  const parsed = parseSignatureHeader(signatureHeader);
  const timestamp = parsed.timestamp ?? timestampHeader;
  const signature = parsed.signature;
  if (!timestamp || !signature) throw new LumaWebhookSignatureError("Malformed Lu.ma webhook signature.");

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) throw new LumaWebhookSignatureError("Invalid Lu.ma webhook timestamp.");

  const ageSeconds = Math.abs(now().getTime() / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) throw new LumaWebhookSignatureError("Expired Lu.ma webhook timestamp.");

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", normalizedSecret).update(signedPayload).digest("hex");
  if (!safeEqualHex(expected, signature)) throw new LumaWebhookSignatureError("Invalid Lu.ma webhook signature.");
}

function parseSignatureHeader(value: string) {
  const fields = new Map<string, string>();
  for (const part of value.split(",")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key || rest.length === 0) continue;
    fields.set(key, rest.join("="));
  }

  return {
    timestamp: fields.get("t"),
    signature: fields.get("v1")
  };
}

function safeEqualHex(expected: string, actual: string) {
  try {
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(actual, "hex");
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}

function parseWebhookPayload(rawBody: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function shouldSyncForEventType(eventType: string) {
  return [
    "guest.registered",
    "guest.updated",
    "event.created",
    "event.updated",
    "event.canceled"
  ].includes(eventType);
}

function extractLumaEventId(payload: Record<string, unknown>) {
  const data = payload.data;
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const event = record.event && typeof record.event === "object"
    ? record.event as Record<string, unknown>
    : undefined;
  return stringField(record.event_api_id)
    ?? stringField(record.event_id)
    ?? stringField(event?.api_id)
    ?? stringField(event?.id)
    ?? stringField(record.id);
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createSupabaseLumaWebhookStoreFromEnv(env: NodeJS.ProcessEnv = process.env): LumaWebhookStore {
  const client = createSupabaseServiceClientFromEnv(env);

  return {
    async recordProviderWebhookEvent(input) {
      const rows = await client.upsert<Array<Record<string, unknown>>[number]>("provider_webhook_events", [{
        provider: "luma",
        event_type: input.eventType,
        provider_event_id: input.providerEventId ?? null,
        payload: input.payload
      }], {
        onConflict: "provider,provider_event_id",
        ignoreDuplicates: true,
        returning: "representation",
        select: "id"
      });

      return { inserted: rows.length > 0 };
    }
  };
}
