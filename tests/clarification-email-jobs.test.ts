import assert from "node:assert/strict";
import test from "node:test";

import {
  processClarificationEmails,
  type ClarificationEmailStore,
  type ClaimedClarificationEmailJob
} from "../app/lib/resend/clarification-emails.ts";
import {
  invokeSupabaseClarificationEmailWorkerFromEnv,
  processImmediateClarificationEmailsForOperationFromEnv
} from "../app/lib/resend/clarification-email-worker.ts";
import { EmailDeliveryError, type SendEmailInput } from "../lib/email/resend.ts";

test("sends queued example clarification emails through Resend with receiving reply-to", async () => {
  const sent: SendEmailInput[] = [];
  const succeeded: Array<{ jobId: string; resendEmailId: string; sentAt: string }> = [];
  const job: ClaimedClarificationEmailJob = {
    id: "clarification-job-aleix",
    applicationId: "test-aleix-application",
    attemptCount: 1,
    toEmail: "manual-review@example.com",
    fromEmail: "yc@events.matchbookhq.com",
    subject: "Confirming your YC event details",
    bodyPreview: "Could you confirm your YC company, batch, role, and YC-connected email?",
    payload: {
      body: "Could you confirm your YC company, batch, role, and YC-connected email?",
      event_api_id: "evt_123",
      template: "event_approval_clarification"
    }
  };

  const summary = await processClarificationEmails({
    store: storeWithJobs([job], { succeeded }),
    emailClient: {
      async send(input) {
        sent.push(input);
        return { provider: "resend", id: "resend-email-aleix" };
      }
    },
    options: {
      now: () => new Date("2026-06-10T12:00:00.000Z")
    }
  });

  assert.equal(summary.claimed, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(sent[0], {
    to: "manual-review@example.com",
    subject: "Confirming your YC event details",
    text: "Could you confirm your YC company, batch, role, and YC-connected email?",
    replyTo: "yc@events.matchbookhq.com",
    tags: [
      { name: "workflow", value: "event-approvals" },
      { name: "kind", value: "clarification-email" }
    ],
    idempotencyKey: "clarification-job-aleix"
  });
  assert.deepEqual(succeeded[0], {
    jobId: "clarification-job-aleix",
    resendEmailId: "resend-email-aleix",
    sentAt: "2026-06-10T12:00:00.000Z"
  });
});

test("retries failed clarification emails with sanitized Resend errors", async () => {
  const failed: Array<{ jobId: string; message: string; scheduledAt: string }> = [];
  const job: ClaimedClarificationEmailJob = {
    id: "clarification-job-failed",
    applicationId: "application-1",
    attemptCount: 2,
    toEmail: "founder@example.com",
    fromEmail: "yc@events.matchbookhq.com",
    subject: "Confirming your YC event details",
    bodyPreview: "Please confirm your YC details.",
    payload: {}
  };

  const summary = await processClarificationEmails({
    store: storeWithJobs([job], { failed }),
    emailClient: {
      async send() {
        throw new EmailDeliveryError({
          message: "Resend email delivery failed: invalid key re_secret_should_not_leak",
          providerCode: "invalid_api_key",
          providerStatusCode: 401
        });
      }
    },
    options: {
      now: () => new Date("2026-06-10T12:00:00.000Z"),
      baseRetryDelayMs: 1_000,
      maxRetryDelayMs: 10_000
    }
  });

  assert.equal(summary.failed, 1);
  assert.equal(failed[0].jobId, "clarification-job-failed");
  assert.equal(failed[0].message, "Resend API 401: invalid_api_key");
  assert.equal(failed[0].message.includes("re_secret"), false);
  assert.equal(failed[0].scheduledAt, "2026-06-10T12:00:02.000Z");
});

test("invokes Supabase clarification email worker with operation scope", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const summary = await invokeSupabaseClarificationEmailWorkerFromEnv({
    NODE_ENV: "test",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret"
  } as NodeJS.ProcessEnv, {
    batchSize: 2,
    operationId: "00000000-0000-4000-8000-000000000222",
    workerId: "yc-os-agent-clarification",
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ claimed: 1, succeeded: 1, failed: 0, skipped: 0, errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(summary, { claimed: 1, succeeded: 1, failed: 0, skipped: 0, errors: [] });
  assert.equal(calls[0].url, "https://project.supabase.co/functions/v1/clarification-emails");
  assert.equal((calls[0].init.headers as Record<string, string>)["x-cron-secret"], "sync-secret");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    batchSize: 2,
    operationId: "00000000-0000-4000-8000-000000000222",
    workerId: "yc-os-agent-clarification"
  });
});

test("immediate clarification emails fall back to the Next worker when the Edge Function is missing", async () => {
  const calls: string[] = [];
  const summary = await processImmediateClarificationEmailsForOperationFromEnv(
    "00000000-0000-4000-8000-000000000222",
    {
      NODE_ENV: "test",
      RESEND_API_KEY: "resend-key",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      LUMA_SYNC_SECRET: "sync-secret"
    } as NodeJS.ProcessEnv,
    {
      fetchFn: async (url) => {
        calls.push(String(url));
        if (String(url).includes("/functions/v1/clarification-emails")) {
          return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
        }
        if (String(url).includes("/rest/v1/rpc/claim_clarification_email_jobs_for_operation")) {
          return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`Unexpected fetch ${String(url)}`);
      }
    }
  );

  assert.equal(summary.claimed, 0);
  assert.equal(calls.some((url) => url.includes("/functions/v1/clarification-emails")), true);
});

test("explicit clarification email worker URLs do not fall back when unavailable", async () => {
  await assert.rejects(processImmediateClarificationEmailsForOperationFromEnv(
    "00000000-0000-4000-8000-000000000222",
    {
      CLARIFICATION_EMAIL_WORKER_URL: "https://workers.example.test/clarification-emails",
      NODE_ENV: "production",
      RESEND_API_KEY: "resend-key",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      LUMA_SYNC_SECRET: "sync-secret"
    } as NodeJS.ProcessEnv,
    {
      fetchFn: async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
    }
  ), /Supabase clarification email worker failed with status 404/);
});

function storeWithJobs(
  jobs: ClaimedClarificationEmailJob[],
  calls: {
    succeeded?: Array<{ jobId: string; resendEmailId: string; sentAt: string }>;
    failed?: Array<{ jobId: string; message: string; scheduledAt: string }>;
  } = {}
): ClarificationEmailStore {
  return {
    async claimQueuedClarificationEmailJobs() {
      return jobs;
    },
    async markClarificationEmailSucceeded(jobId, resendEmailId, _responsePayload, sentAt) {
      calls.succeeded?.push({ jobId, resendEmailId, sentAt });
    },
    async markClarificationEmailFailed(jobId, message, scheduledAt) {
      calls.failed?.push({ jobId, message, scheduledAt });
    }
  };
}
