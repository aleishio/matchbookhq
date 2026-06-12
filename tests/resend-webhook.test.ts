import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  handleResendWebhook,
  ResendWebhookSignatureError,
  type ResendReceivedEmail,
  type ResendReceivingClient,
  type ResendWebhookStore,
  verifyResendWebhookSignature
} from "../app/lib/resend/webhooks.ts";

const WEBHOOK_SECRET = `whsec_${Buffer.from("resend-webhook-test-secret").toString("base64")}`;

test("verifies Resend webhook signatures from svix headers", () => {
  const rawBody = JSON.stringify({
    type: "email.received",
    created_at: "2026-06-10T12:00:00.000Z",
    data: {
      email_id: "received-email-1",
      from: "Ada <ada@example.com>",
      to: ["yc@events.matchbookhq.com"],
      subject: "Re: Confirming your YC event details"
    }
  });
  const headers = signedHeaders(rawBody, "msg_resend_1");

  const payload = verifyResendWebhookSignature({
    rawBody,
    secret: WEBHOOK_SECRET,
    headers,
    apiKey: "re_test_key"
  });

  assert.equal(payload.type, "email.received");
});

test("rejects invalid Resend webhook signatures", () => {
  assert.throws(
    () => verifyResendWebhookSignature({
      rawBody: "{}",
      secret: WEBHOOK_SECRET,
      headers: new Headers({
        "svix-id": "msg_resend_bad",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,bad"
      }),
      apiKey: "re_test_key"
    }),
    ResendWebhookSignatureError
  );
});

test("stores, fetches, parses, and links Resend received emails", async () => {
  const rawBody = JSON.stringify({
    type: "email.received",
    created_at: "2026-06-10T12:00:00.000Z",
    data: {
      email_id: "received-email-1",
      from: "Ada <ada@example.com>",
      to: ["yc@events.matchbookhq.com"],
      message_id: "<reply-1@example.com>",
      subject: "Re: Confirming your YC event details",
      attachments: []
    }
  });
  const store = createMemoryStore();
  const receivingClient: ResendReceivingClient = {
    async getReceivedEmail(emailId) {
      assert.equal(emailId, "received-email-1");
      return {
        id: emailId,
        from: "Ada Founder <ada@example.com>",
        to: ["yc@events.matchbookhq.com"],
        created_at: "2026-06-10T12:00:01.000Z",
        subject: "Re: Confirming your YC event details",
        message_id: "<reply-1@example.com>",
        text: [
          "Company: ExampleCo",
          "Batch: W24",
          "Role: Founder",
          "YC email: ada@example.com"
        ].join("\n"),
        headers: {
          "in-reply-to": "<outbound@example.com>"
        },
        attachments: []
      };
    }
  };

  const result = await handleResendWebhook({
    rawBody,
    headers: signedHeaders(rawBody, "msg_resend_2"),
    secret: WEBHOOK_SECRET,
    apiKey: "re_test_key",
    store,
    receivingClient
  });

  assert.equal(result.verified, true);
  assert.equal(result.inserted, true);
  assert.equal(result.processed, true);
  assert.equal(result.receivedEmailId, "received-email-1");
  assert.equal(result.applicationId, "application-1");
  assert.equal(store.events.length, 1);
  assert.equal(store.replies.length, 1);
  assert.equal(store.replies[0].applicationId, "application-1");
  assert.equal(store.replies[0].clarificationEmailJobId, "job-1");
  assert.equal(store.replies[0].fromEmail, "ada@example.com");
  assert.equal(store.replies[0].status, "auto_ready");
  assert.equal(store.replies[0].parsedFields.company, "ExampleCo");
  assert.equal(store.replies[0].parsedFields.batch, "W24");
  assert.equal(store.replies[0].parsedFields.yc_email, "ada@example.com");
  assert.equal(store.processed[0].providerEventId, "msg_resend_2");
});

test("ignores quoted original clarification email text while parsing replies", async () => {
  const rawBody = JSON.stringify({
    type: "email.received",
    created_at: "2026-06-10T12:00:00.000Z",
    data: {
      email_id: "received-email-quoted",
      from: "Founder <founder@gmail.example>",
      to: ["yc@events.matchbookhq.com"],
      message_id: "<reply-quoted@example.com>",
      subject: "Re: Confirming your YC event details",
      attachments: []
    }
  });
  const store = createMemoryStore();

  await handleResendWebhook({
    rawBody,
    headers: signedHeaders(rawBody, "msg_resend_quoted"),
    secret: WEBHOOK_SECRET,
    apiKey: "re_test_key",
    store,
    receivingClient: {
      async getReceivedEmail(emailId): Promise<ResendReceivedEmail> {
        assert.equal(emailId, "received-email-quoted");
        return {
          id: emailId,
          from: "Founder <founder@gmail.example>",
          to: ["yc@events.matchbookhq.com"],
          created_at: "2026-06-10T12:00:01.000Z",
          subject: "Re: Confirming your YC event details",
          message_id: "<reply-quoted@example.com>",
          text: [
            "I'm founding team at S24",
            "",
            "El mie, 10 jun 2026 a las 0:00, YC OS <yc@events.matchbookhq.com> escribio:",
            "> Company: ExampleCo",
            "> Batch: S24",
            "> Role: Founder",
            "> YC email: founder@example.com"
          ].join("\n"),
          attachments: []
        };
      }
    }
  });

  assert.equal(store.replies[0].status, "manual");
  assert.equal(store.replies[0].parsedFields.company, undefined);
  assert.equal(store.replies[0].parsedFields.batch, "S24");
  assert.equal(store.replies[0].parsedFields.role, "founder");
  assert.equal(store.replies[0].parsedFields.yc_email, undefined);
  assert.deepEqual(store.replies[0].parsedFields.missing, ["company", "yc_email"]);
});

test("processes duplicate Resend webhook deliveries through the idempotent reply path", async () => {
  const rawBody = JSON.stringify({
    type: "email.received",
    data: { email_id: "received-email-duplicate" }
  });
  let fetched = false;
  const store = createMemoryStore({ inserted: false });

  const result = await handleResendWebhook({
    rawBody,
    headers: signedHeaders(rawBody, "msg_resend_duplicate"),
    secret: WEBHOOK_SECRET,
    apiKey: "re_test_key",
    store,
    receivingClient: {
      async getReceivedEmail(): Promise<ResendReceivedEmail> {
        fetched = true;
        return {
          id: "received-email-duplicate",
          from: "Ada <ada@example.com>",
          to: ["yc@events.matchbookhq.com"],
          created_at: "2026-06-10T12:00:01.000Z",
          subject: "Re: Confirming your YC event details",
          text: "Company: ExampleCo\nBatch: W24\nRole: Founder\nYC email: ada@example.com"
        };
      }
    }
  });

  assert.equal(result.inserted, false);
  assert.equal(result.processed, true);
  assert.equal(result.applicationId, "application-1");
  assert.equal(fetched, true);
});

test("stores unlinked inbound replies without inserting applicant reply rows", async () => {
  const rawBody = JSON.stringify({
    type: "email.received",
    data: { email_id: "received-email-unlinked" }
  });
  const store = createMemoryStore({ target: null });

  const result = await handleResendWebhook({
    rawBody,
    headers: signedHeaders(rawBody, "msg_resend_unlinked"),
    secret: WEBHOOK_SECRET,
    apiKey: "re_test_key",
    store,
    receivingClient: {
      async getReceivedEmail(emailId): Promise<ResendReceivedEmail> {
        return {
          id: emailId,
          from: "Unknown <unknown@example.com>",
          to: ["yc@events.matchbookhq.com"],
          created_at: "2026-06-10T12:00:01.000Z",
          subject: "Re: Details",
          text: "I know one of the founders."
        };
      }
    }
  });

  assert.equal(result.processed, true);
  assert.equal(result.reason, "unlinked_reply");
  assert.equal(store.replies.length, 0);
  assert.equal(store.processed[0].processingError, "No approval application matched the inbound reply.");
});

function signedHeaders(rawBody: string, id: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Headers({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signPayload(WEBHOOK_SECRET, id, timestamp, rawBody)
  });
}

function signPayload(secret: string, id: string, timestamp: string, rawBody: string) {
  const rawSecret = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", rawSecret).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`;
}

function createMemoryStore(options: {
  inserted?: boolean;
  target?: { applicationId: string; clarificationEmailJobId?: string } | null;
} = {}) {
  const events: Array<Record<string, unknown>> = [];
  const replies: Array<Parameters<ResendWebhookStore["recordApplicantReply"]>[0]> = [];
  const processed: Array<Parameters<ResendWebhookStore["markProviderWebhookEventProcessed"]>[0]> = [];
  const store: ResendWebhookStore = {
    async recordProviderWebhookEvent(input) {
      events.push(input);
      return { inserted: options.inserted ?? true };
    },
    async findApprovalReplyTarget() {
      if ("target" in options) return options.target ?? null;
      return { applicationId: "application-1", clarificationEmailJobId: "job-1" };
    },
    async recordApplicantReply(input) {
      replies.push(input);
      return { inserted: true, replyId: `reply-${replies.length}` };
    },
    async markProviderWebhookEventProcessed(input) {
      processed.push(input);
    }
  };

  return Object.assign(store, { events, replies, processed });
}
