import assert from "node:assert/strict";
import test from "node:test";

import { POST as unlock } from "../app/api/unlock/route.ts";
import { POST as createSession } from "../app/api/agent/sessions/route.ts";
import {
  getSiteAccessToken,
  isOpenPath,
  isSiteAccessAllowed,
  safeRedirectPath
} from "../app/lib/site-access.ts";
import {
  resetUnlockRateLimitForTests,
  UNLOCK_RATE_LIMIT_MAX_ATTEMPTS
} from "../app/lib/unlock-rate-limit.ts";
import { withSiteEnv, withTestEnv } from "./helpers/env.ts";
import { bearerHeaders, jsonPostRequest, testRequest } from "./helpers/requests.ts";

test("site access uses the shared YC password only for local dev and test", () => {
  assert.equal(getSiteAccessToken(testEnv({ NODE_ENV: "development" })), "ycombinator");
  assert.equal(getSiteAccessToken(testEnv({ NODE_ENV: "test" })), "ycombinator");
  assert.equal(getSiteAccessToken(testEnv({ VERCEL_ENV: "development" })), "ycombinator");
  assert.equal(getSiteAccessToken(testEnv({ NODE_ENV: "production" })), "");
  assert.equal(getSiteAccessToken(testEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "preview"
  })), "");
  assert.equal(getSiteAccessToken(testEnv({
    AGENT_ACCESS_TOKEN: "agent-token",
    NODE_ENV: "production"
  })), "agent-token");
});

test("site access allows open paths, the unlock cookie, or bearer auth", () => {
  assert.equal(isSiteAccessAllowed({
    pathname: "/unlock",
    token: "shared-test-token"
  }), true);
  assert.equal(isSiteAccessAllowed({
    pathname: "/u",
    token: "shared-test-token"
  }), true);
  assert.equal(isSiteAccessAllowed({
    cookieValue: "shared-test-token",
    pathname: "/approvals",
    token: "shared-test-token"
  }), true);
  assert.equal(isSiteAccessAllowed({
    authorization: bearerHeaders().authorization,
    pathname: "/api/mcp",
    token: "shared-test-token"
  }), true);
  assert.equal(isSiteAccessAllowed({
    cookieValue: "wrong",
    pathname: "/approvals",
    token: "shared-test-token"
  }), false);
  assert.equal(isSiteAccessAllowed({
    cookieValue: "",
    pathname: "/approvals",
    token: ""
  }), false);
});

test("site access opens signed machine routes and the PostHog relay", () => {
  for (const pathname of [
    "/api/luma/sync",
    "/api/luma/webhook",
    "/api/luma/writebacks",
    "/api/agent/actions/luma-guests",
    "/api/agent/capabilities",
    "/api/agent/guest-requests/process",
    "/api/agent/sessions",
    "/api/agent/tools/call",
    "/api/mcp",
    "/api/resend/clarification-emails",
    "/api/resend/webhook",
    "/matchbook-relay/i/v0/e/",
    "/matchbook-relay/static/array.js"
  ]) {
    assert.equal(isOpenPath(pathname), true);
    assert.equal(isSiteAccessAllowed({ pathname, token: "shared-test-token" }), true);
  }

  for (const pathname of [
    "/api/luma",
    "/api/resend",
    "/api/resend/webhook/debug",
    "/matchbook-relay-debug"
  ]) {
    assert.equal(isOpenPath(pathname), false);
    assert.equal(isSiteAccessAllowed({ pathname, token: "shared-test-token" }), false);
  }
});

test("signed machine routes still reject requests without their route-level secrets", async () => {
  const resendWebhook = await import("../app/api/resend/webhook/route.ts");
  const resendSender = await import("../app/api/resend/clarification-emails/route.ts");
  const agentGuestWorker = await import("../app/api/agent/guest-requests/process/route.ts");

  const webhookResponse = await resendWebhook.POST(jsonPostRequest("/api/resend/webhook", {}));
  const senderResponse = await resendSender.POST(jsonPostRequest("/api/resend/clarification-emails", {}));
  const guestWorkerResponse = await agentGuestWorker.POST(jsonPostRequest("/api/agent/guest-requests/process", {}));

  assert.notEqual(webhookResponse.status, 200);
  assert.notEqual(senderResponse.status, 200);
  assert.notEqual(guestWorkerResponse.status, 200);
});

test("safe redirect paths stay local to the app", () => {
  assert.equal(safeRedirectPath("/approvals?queue=ready"), "/approvals?queue=ready");
  assert.equal(safeRedirectPath("https://example.com"), "/");
  assert.equal(safeRedirectPath("//example.com"), "/");
  assert.equal(safeRedirectPath(undefined), "/");
});

test("unlock route sets the shared cookie and enables agent session creation", async () => {
  const env = withSiteEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token",
    YC_OS_UNLOCK_COOKIE_NAME: "yc_os_access_token"
  });

  try {
    const denied = await unlock(jsonPostRequest("/api/unlock", { password: "wrong" }));
    assert.equal(denied.status, 401);

    const response = await unlock(jsonPostRequest("/api/unlock", {
      next: "https://bad.example",
      password: "shared-test-token"
    }));
    const body = await response.json();
    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookiePair = setCookie.split(";")[0];

    assert.equal(response.status, 200);
    assert.deepEqual(body, { next: "/", ok: true });
    assert.match(setCookie, /yc_os_access_token=shared-test-token/);
    assert.match(setCookie, /HttpOnly/);

    const session = await createSession(testRequest("/api/agent/sessions", {
      headers: { cookie: cookiePair },
      method: "POST"
    }));
    const sessionBody = await session.json();

    assert.equal(session.status, 200);
    assert.equal(sessionBody.authorizationHeader, "Bearer shared-test-token");
    assert.equal(sessionBody.config.mcpServers["yc-os"].url, "http://yc-os.test/api/mcp");
  } finally {
    env.restore();
  }
});

test("unlock route accepts human backup passwords but stores the shared token cookie", async () => {
  const env = withSiteEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token",
    YC_OS_UNLOCK_COOKIE_NAME: "yc_os_access_token"
  });

  try {
    for (const password of ["YC", "yc", "ycombinator"]) {
      const response = await unlock(jsonPostRequest("/api/unlock", {
        next: "/aleix",
        password
      }));
      const body = await response.json();
      const setCookie = response.headers.get("set-cookie") ?? "";

      assert.equal(response.status, 200);
      assert.deepEqual(body, { next: "/aleix", ok: true });
      assert.match(setCookie, /yc_os_access_token=shared-test-token/);
      assert.doesNotMatch(setCookie, new RegExp(`yc_os_access_token=${password}`));
    }
  } finally {
    env.restore();
  }
});

test("unlock route fails closed when the shared token is missing outside local dev", async () => {
  const env = withTestEnv({
    AGENT_ACCESS_TOKEN: undefined,
    NODE_ENV: "production",
    YC_OS_ACCESS_TOKEN: undefined
  });

  try {
    const response = await unlock(jsonPostRequest("/api/unlock", { password: "anything" }));
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error, "site_access_token_missing");
  } finally {
    env.restore();
  }
});

test("unlock route rate limits repeated failed attempts per client IP", async () => {
  const env = withSiteEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token",
    YC_OS_UNLOCK_COOKIE_NAME: "yc_os_access_token"
  });
  resetUnlockRateLimitForTests();

  try {
    for (let attempt = 0; attempt < UNLOCK_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const response = await unlock(jsonPostRequest(
        "/api/unlock",
        { password: "wrong" },
        { headers: { "x-forwarded-for": "203.0.113.10" } }
      ));
      assert.equal(response.status, 401);
    }

    const blocked = await unlock(jsonPostRequest(
      "/api/unlock",
      { password: "wrong" },
      { headers: { "x-forwarded-for": "203.0.113.10" } }
    ));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.has("retry-after"), true);

    const otherClient = await unlock(jsonPostRequest(
      "/api/unlock",
      { password: "wrong" },
      { headers: { "x-forwarded-for": "203.0.113.11" } }
    ));
    assert.equal(otherClient.status, 401);
  } finally {
    resetUnlockRateLimitForTests();
    env.restore();
  }
});

function testEnv(overrides: Record<string, string | undefined>) {
  return overrides as unknown as NodeJS.ProcessEnv;
}
