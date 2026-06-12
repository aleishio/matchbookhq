import assert from "node:assert/strict";
import test from "node:test";

import {
  createLumaClient,
  createLumaClientFromEnv,
  LumaApiError,
  LumaConfigurationError,
  type FetchFn
} from "../app/lib/luma/client.ts";

test("lists Lu.ma guests with current public API auth and query params", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ entries: [], next_cursor: null }), { status: 200 });
  };
  const client = createLumaClient({ apiKey: "luma_test_key", fetchFn });

  const response = await client.listEventGuests({
    eventId: "evt-123",
    approvalStatus: "pending_approval",
    paginationLimit: 50
  });

  const url = new URL(String(calls[0].input));
  assert.deepEqual(response, { entries: [], next_cursor: null });
  assert.equal(url.origin, "https://public-api.luma.com");
  assert.equal(url.pathname, "/v1/event/get-guests");
  assert.equal(url.searchParams.get("event_id"), "evt-123");
  assert.equal(url.searchParams.get("approval_status"), "pending_approval");
  assert.equal(url.searchParams.get("pagination_limit"), "50");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-luma-api-key"], "luma_test_key");
});

test("updates Lu.ma guest status using declined for rejected YC OS rows", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ input, init });
    return new Response("{}", { status: 200 });
  };
  const client = createLumaClient({ apiKey: "luma_test_key", fetchFn });

  await client.updateGuestStatus({
    eventId: "evt-123",
    guest: { type: "api_id", apiId: "gst-123" },
    status: "declined",
    sendEmail: false
  });

  const url = new URL(String(calls[0].input));
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(url.pathname, "/v1/event/update-guest-status");
  assert.deepEqual(body, {
    event_id: "evt-123",
    guest: {
      type: "api_id",
      api_id: "gst-123"
    },
    status: "declined",
    send_email: false
  });
});

test("adds Lu.ma guests with approval status and email controls", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ inserted: 1 }), { status: 200 });
  };
  const client = createLumaClient({ apiKey: "luma_test_key", fetchFn });

  const response = await client.addGuests({
    approvalStatus: "approved",
    eventId: "evt-123",
    guests: [
      {
        email: "founder@example.com",
        name: "Example Founder",
        phoneNumber: "+14155550123"
      }
    ],
    sendEmail: false
  });

  const url = new URL(String(calls[0].input));
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(response, { inserted: 1 });
  assert.equal(url.pathname, "/v1/event/add-guests");
  assert.deepEqual(body, {
    approval_status: "approved",
    event_id: "evt-123",
    guests: [
      {
        email: "founder@example.com",
        name: "Example Founder",
        phone_number: "+14155550123"
      }
    ],
    send_email: false
  });
});

test("builds Lu.ma config from server env only", () => {
  const client = createLumaClientFromEnv({
    NODE_ENV: "test",
    LUMA_API_KEY: "luma_env_key",
    LUMA_API_BASE_URL: "https://public-api.luma.com"
  } as NodeJS.ProcessEnv);

  assert.equal(typeof client.listCalendarEvents, "function");
});

test("surfaces Lu.ma API failures without exposing the API key", async () => {
  const fetchFn: FetchFn = async () =>
    new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
  const client = createLumaClient({
    apiKey: "secret_luma_key",
    fetchFn,
    retry: { maxRetries: 0 }
  });

  await assert.rejects(
    () => client.listCalendarEvents(),
    (error) => {
      assert.ok(error instanceof LumaApiError);
      assert.equal(error.status, 429);
      assert.equal(error.message.includes("secret_luma_key"), false);
      return true;
    }
  );
});

test("retries transient Lu.ma API failures with Retry-After pacing", async () => {
  const delays: number[] = [];
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ input, init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "retry-after": "0.25" }
      });
    }
    return new Response(JSON.stringify({ entries: [], next_cursor: null }), { status: 200 });
  };
  const client = createLumaClient({
    apiKey: "luma_test_key",
    fetchFn,
    retry: {
      maxRetries: 1,
      baseDelayMs: 100,
      sleepFn: async (milliseconds) => {
        delays.push(milliseconds);
      }
    }
  });

  const response = await client.listCalendarEvents({ paginationLimit: 1 });

  assert.deepEqual(response, { entries: [], next_cursor: null });
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [250]);
});

test("requires a Lu.ma API key", () => {
  assert.throws(
    () => createLumaClient({ apiKey: "" }),
    LumaConfigurationError
  );
});
