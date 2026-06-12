import assert from "node:assert/strict";
import test from "node:test";
import posthog from "posthog-js";

import {
  captureAnalyticsEvent,
  confidenceBucket,
  countBucket,
  isAnalyticsEnabled,
  sanitizeAnalyticsProperties,
  textLengthBucket,
} from "../lib/analytics.ts";
import {
  captureServerAnalyticsEvent,
  sanitizeServerAnalyticsProperties,
} from "../app/lib/server-analytics.ts";
import type { FetchFn } from "../app/lib/luma/client.ts";

test("analytics sanitizer removes private-looking properties", () => {
  const result = sanitizeAnalyticsProperties({
    action: "approve",
    email: "founder@example.com",
    founder_name: "Private Founder",
    note_body: "private note",
    result_count: 12,
  });

  assert.deepEqual(result, {
    action: "approve",
    result_count: 12,
  });
});

test("analytics sanitizer keeps safe categorical note metadata", () => {
  const result = sanitizeAnalyticsProperties({
    note_body: "private note",
    note_type: "local",
    visible_note_count: 3,
  });

  assert.deepEqual(result, {
    note_type: "local",
    visible_note_count: 3,
  });
});

test("analytics sanitizer keeps agent access categories but drops copied text", () => {
  const result = sanitizeAnalyticsProperties({
    authorization_header: "Bearer shared-test-token",
    close_method: "escape",
    content_type: "external_checklist",
    lane: "cowork",
    packet_text: "YC OS website: https://yc-os.vercel.app",
    result: "manual_fallback",
    token: "shared-test-token",
  });

  assert.deepEqual(result, {
    close_method: "escape",
    content_type: "external_checklist",
    lane: "cowork",
    result: "manual_fallback",
  });
});

test("agent access analytics captures categorical PostHog events when enabled", () => {
  const previousCapture = posthog.capture;
  const previousEnabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED;
  const previousToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const globalWithWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
  const previousWindow = globalWithWindow.window;
  let captured:
    | {
        event: string;
        properties: unknown;
      }
    | undefined;

  posthog.capture = ((event: string, properties: unknown) => {
    captured = { event, properties };
  }) as typeof posthog.capture;
  process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "true";
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "test-token";
  globalWithWindow.window = globalThis as Window & typeof globalThis;

  try {
    captureAnalyticsEvent("agent handoff copied", {
      content_type: "external_checklist",
      lane: "cowork",
      result: "manual_fallback",
    });

    assert.deepEqual(captured, {
      event: "agent handoff copied",
      properties: {
        content_type: "external_checklist",
        lane: "cowork",
        result: "manual_fallback",
      },
    });
  } finally {
    posthog.capture = previousCapture;
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = previousEnabled;
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = previousToken;
    globalWithWindow.window = previousWindow;
  }
});

test("placeholder PostHog token disables browser analytics", () => {
  const previousCapture = posthog.capture;
  const previousEnabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED;
  const previousToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const globalWithWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
  const previousWindow = globalWithWindow.window;
  let captured = false;

  posthog.capture = (() => {
    captured = true;
  }) as typeof posthog.capture;
  process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "true";
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "ph_test";
  globalWithWindow.window = globalThis as Window & typeof globalThis;

  try {
    assert.equal(isAnalyticsEnabled(), false);

    captureAnalyticsEvent("agent handoff copied", {
      content_type: "external_checklist",
      lane: "cowork",
      result: "manual_fallback",
    });

    assert.equal(captured, false);
  } finally {
    posthog.capture = previousCapture;
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = previousEnabled;
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = previousToken;
    globalWithWindow.window = previousWindow;
  }
});

test("agent action server analytics posts safe categorical properties only", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ input, init });
    return new Response("{}", { status: 200 });
  };

  await captureServerAnalyticsEvent(
    "agent event guests action requested",
    {
      approval_status: "approved",
      email: "founder@example.com",
      event_id: "evt-agent-test",
      guest_count_bucket: "1",
      mode: "dry_run",
      reason: "private operator note",
      result: "dry_run",
      status_code: 200,
      token: "shared-test-token"
    },
    {
      NODE_ENV: "test",
      NEXT_PUBLIC_POSTHOG_ENABLED: "true",
      NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "ph_test"
    } as NodeJS.ProcessEnv,
    fetchFn
  );

  const url = new URL(String(calls[0].input));
  const body = JSON.parse(String(calls[0].init?.body));

  assert.equal(url.href, "https://us.i.posthog.com/i/v0/e/");
  assert.equal(body.api_key, "ph_test");
  assert.equal(body.distinct_id, "yc-os-agent-actions");
  assert.equal(body.event, "agent event guests action requested");
  assert.deepEqual(body.properties, {
    "$process_person_profile": false,
    approval_status: "approved",
    event_id: "evt-agent-test",
    guest_count_bucket: "1",
    mode: "dry_run",
    result: "dry_run",
    status_code: 200
  });
});

test("agent action server analytics still posts to PostHog when browser uses proxy path", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response("{}", { status: 200 });
  };

  await captureServerAnalyticsEvent(
    "agent event guests action requested",
    {
      event_id: "evt-agent-test",
      mode: "dry_run",
      result: "dry_run",
      status_code: 200,
    },
    {
      NODE_ENV: "test",
      NEXT_PUBLIC_POSTHOG_ENABLED: "true",
      NEXT_PUBLIC_POSTHOG_HOST: "/matchbook-relay",
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "ph_test"
    } as NodeJS.ProcessEnv,
    fetchFn
  );

  const url = new URL(String(calls[0].input));

  assert.equal(url.href, "https://us.i.posthog.com/i/v0/e/");
});

test("server analytics sanitizer removes private-looking action properties", () => {
  assert.deepEqual(sanitizeServerAnalyticsProperties({
    email: "founder@example.com",
    event_id: "evt-agent-test",
    name: "Private Founder",
    reason: "private operator note",
    result: "executed",
    token: "shared-test-token"
  }), {
    event_id: "evt-agent-test",
    result: "executed"
  });
});

test("analytics buckets keep dashboards useful without raw values", () => {
  assert.equal(countBucket(0), "0");
  assert.equal(countBucket(4), "2-5");
  assert.equal(countBucket(415), "100+");

  assert.equal(textLengthBucket(""), "0");
  assert.equal(textLengthBucket("warm intro"), "1-10");
  assert.equal(textLengthBucket("x".repeat(80)), "41-120");

  assert.equal(confidenceBucket(35), "0-39");
  assert.equal(confidenceBucket(70), "70-89");
  assert.equal(confidenceBucket(95), "90-100");
});
