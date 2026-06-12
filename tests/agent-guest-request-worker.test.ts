import assert from "node:assert/strict";
import test from "node:test";

import {
  invokeSupabaseAgentGuestRequestWorkerFromEnv,
  processAgentGuestRequests,
  processImmediateAgentGuestRequestFromEnv,
  type AgentGuestRequestWorkerStore,
  type ClaimedAgentGuestRequest
} from "../app/lib/agent-guest-request-worker.ts";
import { LumaApiError } from "../app/lib/luma/client.ts";

test("processes queued agent guest requests through the backend worker", async () => {
  const calls: unknown[] = [];
  const succeeded: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const store: AgentGuestRequestWorkerStore = {
    async claimGuestRequests() {
      return [{
        approvalStatus: "approved",
        attemptCount: 1,
        eventId: "dogpatch-founder-breakfast",
        guests: [{ email: "operator@example.com", name: "Operator" }],
        id: "request-1",
        lumaEventId: "evt-real",
        sendEmail: false
      }];
    },
    async markGuestRequestSucceeded(id, payload) {
      succeeded.push({ id, payload });
    },
    async markGuestRequestFailed() {
      throw new Error("should not fail");
    }
  };

  const summary = await processAgentGuestRequests({
    lumaClient: {
      async addGuests(input) {
        calls.push(input);
        return { operation_id: "op_123" };
      }
    },
    store
  });

  assert.equal(summary.claimed, 1);
  assert.equal(summary.succeeded, 1);
  assert.deepEqual(calls, [{
    approvalStatus: "approved",
    eventId: "evt-real",
    guests: [{ email: "operator@example.com", name: "Operator" }],
    sendEmail: false
  }]);
  assert.deepEqual(succeeded, [{
    id: "request-1",
    payload: { response_keys: ["operation_id"] }
  }]);
});

test("reschedules failed agent guest requests with sanitized provider errors", async () => {
  const failed: Array<{ id: string; message: string; scheduledAt: string }> = [];
  const request: ClaimedAgentGuestRequest = {
    approvalStatus: "waitlist",
    attemptCount: 2,
    eventId: "dogpatch-founder-breakfast",
    guests: [{ email: "operator@example.com" }],
    id: "request-1",
    lumaEventId: "evt-real",
    sendEmail: false
  };
  const store: AgentGuestRequestWorkerStore = {
    async claimGuestRequests() {
      return [request];
    },
    async markGuestRequestSucceeded() {
      throw new Error("should not succeed");
    },
    async markGuestRequestFailed(id, message, scheduledAt) {
      failed.push({ id, message, scheduledAt });
    }
  };

  const summary = await processAgentGuestRequests({
    lumaClient: {
      async addGuests() {
        throw new LumaApiError("Lu.ma API request failed with status 429.", 429, { error: "rate_limited" });
      }
    },
    options: {
      baseRetryDelayMs: 1_000,
      maxRetryDelayMs: 10_000,
      now: () => new Date("2026-06-10T00:00:00.000Z")
    },
    store
  });

  assert.equal(summary.failed, 1);
  assert.equal(failed[0].message, "Lu.ma API status 429");
  assert.equal(failed[0].scheduledAt, "2026-06-10T00:00:02.000Z");
});

test("invokes Supabase agent guest request worker with request scope", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const summary = await invokeSupabaseAgentGuestRequestWorkerFromEnv({
    NODE_ENV: "test",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret"
  } as NodeJS.ProcessEnv, {
    batchSize: 1,
    requestId: "00000000-0000-4000-8000-000000000123",
    workerId: "yc-os-agent-guest-request",
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ claimed: 1, succeeded: 1, failed: 0, errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(summary, { claimed: 1, succeeded: 1, failed: 0, errors: [] });
  assert.equal(calls[0].url, "https://project.supabase.co/functions/v1/agent-guest-requests");
  assert.equal((calls[0].init.headers as Record<string, string>)["x-cron-secret"], "sync-secret");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    batchSize: 1,
    requestId: "00000000-0000-4000-8000-000000000123",
    workerId: "yc-os-agent-guest-request"
  });
});

test("falls back to the Next guest request worker when the Edge Function is missing", async () => {
  const calls: string[] = [];
  const summary = await processImmediateAgentGuestRequestFromEnv("agent_guest_request_00000000-0000-4000-8000-000000000123", {
    AGENT_GUEST_REQUEST_WORKER_STRATEGY: "supabase",
    NODE_ENV: "production",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret",
    LUMA_API_KEY: "luma-key"
  } as NodeJS.ProcessEnv, {
    fetchFn: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/functions/v1/agent-guest-requests")) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (String(url).includes("/rest/v1/rpc/claim_agent_guest_requests")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${String(url)}`);
    }
  });

  assert.equal(summary.claimed, 0);
  assert.equal(calls.some((url) => url.includes("/functions/v1/agent-guest-requests")), true);
  assert.equal(calls.some((url) => url.includes("/rest/v1/rpc/claim_agent_guest_requests")), true);
});

test("explicit guest request worker URLs do not fall back when unavailable", async () => {
  await assert.rejects(processImmediateAgentGuestRequestFromEnv("agent_guest_request_00000000-0000-4000-8000-000000000123", {
    AGENT_GUEST_REQUEST_WORKER_STRATEGY: "supabase",
    AGENT_GUEST_REQUEST_WORKER_URL: "https://workers.example.test/agent-guest-requests",
    NODE_ENV: "production",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret",
    LUMA_API_KEY: "luma-key"
  } as NodeJS.ProcessEnv, {
    fetchFn: async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
  }), /Supabase agent guest request worker failed with status 404/);
});

test("allows explicit local immediate guest request worker", async () => {
  const scopes: unknown[] = [];
  const store: AgentGuestRequestWorkerStore = {
    async claimGuestRequests(_limit, _workerId, scope) {
      scopes.push(scope);
      return [];
    },
    async markGuestRequestSucceeded() {
      throw new Error("should not succeed");
    },
    async markGuestRequestFailed() {
      throw new Error("should not fail");
    }
  };

  const summary = await processAgentGuestRequests({
    lumaClient: {
      async addGuests() {
        throw new Error("should not call Lu.ma without claimed requests");
      }
    },
    options: {
      requestId: "request-1"
    },
    store
  });

  assert.equal(summary.claimed, 0);
  assert.deepEqual(scopes, [{ requestId: "request-1" }]);

  const calls: string[] = [];
  await processImmediateAgentGuestRequestFromEnv("agent_guest_request_request-1", {
    NODE_ENV: "test",
    AGENT_GUEST_REQUEST_WORKER_STRATEGY: "next",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    LUMA_SYNC_SECRET: "sync-secret",
    LUMA_API_KEY: "luma-key"
  } as NodeJS.ProcessEnv, {
    fetchFn: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/rest/v1/rpc/claim_agent_guest_requests")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${String(url)}`);
    }
  });

  assert.equal(calls.some((url) => url.includes("/functions/v1/agent-guest-requests")), false);
  assert.equal(calls.some((url) => url.includes("/rest/v1/rpc/claim_agent_guest_requests")), true);
});
