import assert from "node:assert/strict";
import test from "node:test";

import {
  processLumaWritebacks,
  type ClaimedLumaWritebackJob,
  type LumaWritebackStore
} from "../app/lib/luma/writebacks.ts";
import {
  invokeSupabaseLumaWritebackWorkerFromEnv,
  processImmediateLumaWritebacksFromEnv
} from "../app/lib/luma/writeback-worker.ts";
import { LumaApiError } from "../app/lib/luma/client.ts";

test("processes claimed Lu.ma writeback jobs and marks success", async () => {
  const calls: unknown[] = [];
  const succeeded: string[] = [];
  const store: LumaWritebackStore = {
    async claimQueuedWritebackJobs() {
      return [{
        id: "job-1",
        applicationId: "app-1",
        targetStatus: "approved",
        attemptCount: 1,
        eventApiId: "evt-api-1",
        guestApiId: "guest-api-1",
        sendEmail: false
      }];
    },
    async markWritebackSucceeded(jobId) {
      succeeded.push(jobId);
    },
    async markWritebackFailed() {
      throw new Error("should not fail");
    }
  };

  const summary = await processLumaWritebacks({
    store,
    lumaClient: {
      async updateGuestStatus(input) {
        calls.push(input);
        return {};
      }
    }
  });

  assert.equal(summary.claimed, 1);
  assert.equal(summary.succeeded, 1);
  assert.deepEqual(succeeded, ["job-1"]);
  assert.deepEqual(calls[0], {
    eventId: "evt-api-1",
    guest: { type: "api_id", apiId: "guest-api-1" },
    status: "approved",
    shouldRefund: undefined,
    sendEmail: false
  });
});

test("reschedules failed Lu.ma writebacks with sanitized errors", async () => {
  const failed: Array<{ jobId: string; message: string; scheduledAt: string }> = [];
  const job: ClaimedLumaWritebackJob = {
    id: "job-1",
    applicationId: "app-1",
    targetStatus: "declined",
    attemptCount: 2,
    eventApiId: "evt-api-1",
    guestEmail: "founder@example.com"
  };
  const store: LumaWritebackStore = {
    async claimQueuedWritebackJobs() {
      return [job];
    },
    async markWritebackSucceeded() {
      throw new Error("should not succeed");
    },
    async markWritebackFailed(jobId, message, scheduledAt) {
      failed.push({ jobId, message, scheduledAt });
    }
  };

  const summary = await processLumaWritebacks({
    store,
    lumaClient: {
      async updateGuestStatus() {
        throw new LumaApiError("Lu.ma API request failed with status 429.", 429, { error: "rate_limited" });
      }
    },
    options: {
      now: () => new Date("2026-06-09T00:00:00.000Z"),
      baseRetryDelayMs: 1_000,
      maxRetryDelayMs: 10_000
    }
  });

  assert.equal(summary.failed, 1);
  assert.equal(failed[0].message, "Lu.ma API status 429");
  assert.equal(failed[0].scheduledAt, "2026-06-09T00:00:02.000Z");
});

test("passes operation scope when claiming immediate writeback jobs", async () => {
  const scopes: unknown[] = [];
  const store: LumaWritebackStore = {
    async claimQueuedWritebackJobs(_limit, _workerId, scope) {
      scopes.push(scope);
      return [];
    },
    async markWritebackSucceeded() {
      throw new Error("should not succeed");
    },
    async markWritebackFailed() {
      throw new Error("should not fail");
    }
  };

  const summary = await processLumaWritebacks({
    store,
    lumaClient: {
      async updateGuestStatus() {
        throw new Error("should not call Lu.ma without claimed jobs");
      }
    },
    options: {
      scope: { operationId: "operation-1" }
    }
  });

  assert.equal(summary.claimed, 0);
  assert.deepEqual(scopes, [{ operationId: "operation-1" }]);
});

test("invokes Supabase Lu.ma writeback worker with operation scope", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const summary = await invokeSupabaseLumaWritebackWorkerFromEnv({
    NODE_ENV: "test",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret"
  } as NodeJS.ProcessEnv, {
    batchSize: 3,
    workerId: "yc-os-immediate-operation-1",
    scope: { operationId: "00000000-0000-4000-8000-000000000001" },
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ claimed: 1, succeeded: 1, failed: 0, skipped: 0, errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(summary, { claimed: 1, succeeded: 1, failed: 0, skipped: 0, errors: [] });
  assert.equal(calls[0].url, "https://project.supabase.co/functions/v1/luma-writebacks");
  assert.equal((calls[0].init.headers as Record<string, string>)["x-cron-secret"], "sync-secret");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer service-role");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    batchSize: 3,
    workerId: "yc-os-immediate-operation-1",
    scope: { operationId: "00000000-0000-4000-8000-000000000001" }
  });
});

test("default Supabase immediate writebacks fall back to the Next worker when the Edge Function is missing", async () => {
  const calls: string[] = [];
  const summary = await processImmediateLumaWritebacksFromEnv({
    NODE_ENV: "test",
    LUMA_WRITEBACK_WORKER_STRATEGY: "supabase",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret",
    LUMA_API_KEY: "luma-key"
  } as NodeJS.ProcessEnv, {
    fetchFn: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/functions/v1/luma-writebacks")) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (String(url).includes("/rest/v1/rpc/claim_luma_writeback_jobs")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${String(url)}`);
    }
  });

  assert.equal(summary.claimed, 0);
  assert.equal(calls.some((url) => url.includes("/functions/v1/luma-writebacks")), true);
  assert.equal(calls.some((url) => url.includes("/rest/v1/rpc/claim_luma_writeback_jobs")), true);
});

test("explicit Supabase writeback worker URLs do not fall back when unavailable", async () => {
  await assert.rejects(processImmediateLumaWritebacksFromEnv({
    NODE_ENV: "production",
    LUMA_WRITEBACK_WORKER_STRATEGY: "supabase",
    LUMA_WRITEBACK_WORKER_URL: "https://workers.example.test/luma-writebacks",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret",
    LUMA_API_KEY: "luma-key"
  } as NodeJS.ProcessEnv, {
    fetchFn: async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
  }), /Supabase Lu\.ma writeback worker failed with status 404/);
});

test("allows explicit non-production local immediate writeback worker", async () => {
  const calls: string[] = [];
  const summary = await processImmediateLumaWritebacksFromEnv({
    NODE_ENV: "test",
    LUMA_WRITEBACK_WORKER_STRATEGY: "next",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret",
    LUMA_API_KEY: "luma-key"
  } as NodeJS.ProcessEnv, {
    fetchFn: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/rest/v1/rpc/claim_luma_writeback_jobs")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${String(url)}`);
    }
  });

  assert.equal(summary.claimed, 0);
  assert.equal(calls.some((url) => url.includes("/functions/v1/luma-writebacks")), false);
  assert.equal(calls.some((url) => url.includes("/rest/v1/rpc/claim_luma_writeback_jobs")), true);
});
