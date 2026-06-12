import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  handleLumaWebhook,
  LumaWebhookSignatureError,
  verifyLumaWebhookSignature,
  type LumaWebhookStore
} from "../app/lib/luma/webhooks.ts";

test("verifies Lu.ma webhook signatures using raw body and timestamp", () => {
  const rawBody = JSON.stringify({ type: "guest.updated", data: { event_api_id: "evt-api-1" } });
  const timestamp = "1780963200";
  const secret = "whsec_test";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  assert.doesNotThrow(() => verifyLumaWebhookSignature({
    rawBody,
    secret,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    timestampHeader: timestamp,
    now: () => new Date("2026-06-09T00:00:00.000Z")
  }));
});

test("rejects invalid Lu.ma webhook signatures", () => {
  assert.throws(
    () => verifyLumaWebhookSignature({
      rawBody: "{}",
      secret: "whsec_test",
      signatureHeader: "t=1780963200,v1=bad",
      timestampHeader: "1780963200",
      now: () => new Date("2026-06-09T00:00:00.000Z")
    }),
    LumaWebhookSignatureError
  );
});

test("stores verified Lu.ma webhooks idempotently", async () => {
  const rawBody = JSON.stringify({ type: "guest.registered", data: { event_api_id: "evt-api-1" } });
  const timestamp = "1780963200";
  const secret = "whsec_test";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const stored: unknown[] = [];
  const store: LumaWebhookStore = {
    async recordProviderWebhookEvent(input) {
      stored.push(input);
      return { inserted: true };
    }
  };

  const result = await handleLumaWebhook({
    rawBody,
    secret,
    store,
    headers: new Headers({
      "webhook-signature": `t=${timestamp},v1=${signature}`,
      "webhook-timestamp": timestamp,
      "webhook-id": "evt-hook-1"
    }),
    now: () => new Date("2026-06-09T00:00:00.000Z")
  });

  assert.equal(result.verified, true);
  assert.equal(result.shouldSync, true);
  assert.equal(result.lumaEventId, "evt-api-1");
  assert.equal(stored.length, 1);
});
