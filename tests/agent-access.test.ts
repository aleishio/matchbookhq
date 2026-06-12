import assert from "node:assert/strict";
import test from "node:test";

import {
  assertUnlockedForAgentAccess,
  createAgentAccessConfig,
  verifyAgentBearerToken
} from "../app/lib/agent-session.ts";
import { AGENT_TOOL_DEFINITIONS, AgentToolError, callAgentTool } from "../app/lib/agent-tools.ts";
import { GET as getCapabilities } from "../app/api/agent/capabilities/route.ts";
import { POST as createSession } from "../app/api/agent/sessions/route.ts";
import { POST as callToolRoute } from "../app/api/agent/tools/call/route.ts";
import { GET as getMcpRoute, POST as callMcpRoute } from "../app/api/mcp/route.ts";
import { formatAgentHandoffText } from "../lib/agent-handoff.ts";
import { withAgentEnv, withTestEnv } from "./helpers/env.ts";
import {
  MCP_ACCEPT_HEADER,
  MCP_PROTOCOL_VERSION,
  agentToolRequest,
  bearerHeaders,
  jsonPostRequest,
  mcpHeaders,
  mcpToolCallRequest,
  mcpToolsListRequest,
  testRequest,
  unlockedRequest
} from "./helpers/requests.ts";

test("agent endpoints use the same token that unlocks the site", () => {
  const env = withAgentEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token",
    YC_OS_UNLOCK_COOKIE_NAME: "yc_os_access_token"
  });

  try {
    const request = unlockedRequest("/api/agent/sessions");
    const config = createAgentAccessConfig(request);
    const verified = verifyAgentBearerToken(config.authorizationHeader);

    assert.deepEqual(verified.scope, ["mcp:tools", "read:event_prep", "read:approvals", "write:events", "write:event_guests", "write:approvals"]);
    assert.equal(config.authorizationHeader, "Bearer shared-test-token");
    assert.equal(config.config.mcpServers["yc-os"].headers.Authorization, "Bearer shared-test-token");
    assert.equal(config.config.mcpServers["yc-os"].headers.Accept, MCP_ACCEPT_HEADER);
    assert.equal(config.config.mcpServers["yc-os"].headers["MCP-Protocol-Version"], MCP_PROTOCOL_VERSION);
    assert.throws(() => verifyAgentBearerToken("Bearer wrong-token"), /invalid/);
  } finally {
    env.restore();
  }
});

test("agent config copy requires the browser unlock cookie", () => {
  const env = withAgentEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token",
    YC_OS_UNLOCK_COOKIE_NAME: "yc_os_access_token"
  });

  try {
    assert.throws(
      () => assertUnlockedForAgentAccess(testRequest("/api/agent/sessions")),
      /Unlock YC OS/
    );
    assert.doesNotThrow(() =>
      assertUnlockedForAgentAccess(unlockedRequest("/api/agent/sessions"))
    );
  } finally {
    env.restore();
  }
});

test("agent session route returns MCP config from an unlocked request", async () => {
  const env = withAgentEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token",
    YC_OS_UNLOCK_COOKIE_NAME: "yc_os_access_token"
  });

  try {
    const locked = await createSession(testRequest("/api/agent/sessions", {
      method: "POST"
    }));
    assert.equal(locked.status, 401);

    const response = await createSession(unlockedRequest("/api/agent/sessions", {
      method: "POST"
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.mcpUrl, "http://yc-os.test/api/mcp");
    assert.equal("legacyGuestsActionUrl" in body, false);
    assert.equal(body.authorizationHeader, "Bearer shared-test-token");
    assert.equal(body.config.mcpServers["yc-os"].url, "http://yc-os.test/api/mcp");
    assert.equal(body.tokenLabel, "site_access_token");
    assert.equal(body.guide.smokeTest.title, "Safest real test: operator-email live guest add");
    assert.equal(body.guide.dataLabels.some((item: string) => item.includes("Real case")), true);
    assert.equal(body.guide.capacityLimit.safeguards.some((item: string) => item.includes("Never remove real attendees")), true);
    assert.equal(body.actions.some((action: { name: string }) => action.name === "create_event"), true);
    assert.equal(body.actions.some((action: { name: string }) => action.name === "add_event_attendees"), true);
    assert.equal(body.actions.some((action: { name: string }) => action.name === "enrich_event_context"), true);
    assert.equal(body.actions.some((action: { name: string }) => action.name === "add_event_guests"), true);
    assert.equal(body.actions.some((action: { name: string }) => action.name === "approve_applications"), true);
    assert.equal(body.tools.some((tool: { name: string }) => tool.name === "get_agent_guide"), true);
    assert.equal(body.tools.some((tool: { name: string }) => tool.name === "list_approval_queue"), true);
    assert.equal(body.tools.some((tool: { name: string }) => tool.name === "get_guest_context"), true);
  } finally {
    env.restore();
  }
});

test("agent config uses the requested host instead of the server bind address", () => {
  const env = withAgentEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token",
    YC_OS_UNLOCK_COOKIE_NAME: "yc_os_access_token"
  });

  try {
    const config = createAgentAccessConfig(unlockedRequest("http://0.0.0.0:3300/api/agent/sessions", {
      headers: {
        host: "localhost:3300"
      }
    }));

    assert.equal(config.mcpUrl, "http://localhost:3300/api/mcp");
    assert.equal("legacyGuestsActionUrl" in config, false);
  } finally {
    env.restore();
  }
});

test("agent handoff copy gives an MCP-first task without sending agents to the UI", () => {
  const env = withAgentEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token",
    YC_OS_UNLOCK_COOKIE_NAME: "yc_os_access_token"
  });

  try {
    const access = createAgentAccessConfig(unlockedRequest("/api/agent/sessions"));
    const text = formatAgentHandoffText({
      ...access,
      tools: AGENT_TOOL_DEFINITIONS.map((tool) => ({
        description: tool.description,
        name: tool.name
      }))
    });

    assert.match(text, /^YC OS MCP agent handoff/);
    assert.match(text, /Authorization header: Bearer shared-test-token/);
    assert.match(text, /Assignment for the receiving agent/);
    assert.match(text, /Do not ask the operator what to do first/);
    assert.match(text, /Use MCP\/API tools only; do not open or browse the YC OS website/);
    assert.match(text, /First task:/);
    assert.match(text, /Call get_agent_guide/);
    assert.match(text, /Call list_approval_events/);
    assert.match(text, /Call get_event_prep_context/);
    assert.match(text, /Call list_approval_queue/);
    assert.match(text, /Operator report:/);
    assert.match(text, /Real vs fake\/test data:/);
    assert.match(text, /Real case:/);
    assert.match(text, /Demo\/fallback data:/);
    assert.match(text, /kind=real/);
    assert.match(text, /guestAdds=available/);
    assert.match(text, /guestAdds=dry_run_only/);
    assert.match(text, /not a separate live event destination/);
    assert.match(text, /Safe YC team smoke test:/);
    assert.match(text, /operator-email live guest add/);
    assert.match(text, /operator-provided email/);
    assert.match(text, /kind=real and guestAdds=available/);
    assert.match(text, /production rejects execute=false/);
    assert.match(text, /sendEmail=false/);
    assert.match(text, /Provider add limit:/);
    assert.match(text, /2-3 clearly fake\/test guests/);
    assert.match(text, /Never remove real attendees/);
    assert.match(text, /Provider development limits:/);
    assert.match(text, /rate limits/);
    assert.match(text, /live writes as the only production acceptance test/);
    assert.match(text, /Write tools are live in production when a reason is supplied/);
    assert.equal(text.includes("Locked YC OS site"), false);
    assert.equal(text.includes("Current website"), false);
    assert.equal(text.includes("YC OS action endpoint"), false);
    assert.equal(text.includes("luma_guests.add"), false);
    assert.match(text, /create_event/);
    assert.match(text, /add_event_attendees/);
    assert.match(text, /enrich_event_context/);
    assert.match(text, /add_event_guests/);
    assert.match(text, /approve_applications/);
    assert.match(text, /Treat those tools as the operating surface/);
    assert.match(text, /provider APIs, secrets, raw payloads, retries, and audit stay inside the YC OS runtime/);
  } finally {
    env.restore();
  }
});

test("agent capabilities, tool call, and MCP routes require bearer auth", async () => {
  const env = withAgentEnv({
    YC_OS_ACCESS_TOKEN: "shared-test-token"
  });

  try {
    const headers = bearerHeaders();
    const routeMcpHeaders = mcpHeaders();

    const denied = await getCapabilities(testRequest("/api/agent/capabilities"));
    assert.equal(denied.status, 401);

    const capabilities = await getCapabilities(testRequest("/api/agent/capabilities", { headers }));
    const capabilitiesBody = await capabilities.json();
    assert.equal(capabilities.status, 200);
    assert.equal(capabilitiesBody.capabilities.tools, true);
    assert.equal(capabilitiesBody.capabilities.writeActions, true);
    assert.equal(capabilitiesBody.guide.firstTask[0].includes("get_agent_guide"), true);
    assert.equal(capabilitiesBody.guide.firstTask.some((item: string) => item.includes("guestAdds")), true);
    assert.equal(capabilitiesBody.guide.firstTask.some((item: string) => item.includes("create_event")), true);
    assert.equal(capabilitiesBody.guide.dataLabels.some((item: string) => item.includes("Demo/fallback")), true);
    assert.equal(capabilitiesBody.guide.dataLabels.some((item: string) => item.includes("kind=real")), true);
    assert.equal(capabilitiesBody.guide.dataLabels.some((item: string) => item.includes("guestAdds=dry_run_only")), true);
    assert.equal(capabilitiesBody.guide.dataLabels.some((item: string) => item.includes("not a separate live event destination")), true);
    assert.equal(capabilitiesBody.guide.capacityLimit.steps.some((item: string) => item.includes("2-3 clearly fake/test guests")), true);
    assert.equal(capabilitiesBody.guide.developmentLimits.steps.some((item: string) => item.includes("429")), true);
    assert.equal(capabilitiesBody.guide.smokeTest.safeguards.some((item: string) => item.includes("live by default")), true);
    const createEventAction = capabilitiesBody.actions.find((action: { name: string }) => action.name === "create_event");
    const addAttendeesAction = capabilitiesBody.actions.find((action: { name: string }) => action.name === "add_event_attendees");
    const enrichEventAction = capabilitiesBody.actions.find((action: { name: string }) => action.name === "enrich_event_context");
    const addGuestsAction = capabilitiesBody.actions.find((action: { name: string }) => action.name === "add_event_guests");
    assert.equal(createEventAction.url, "http://yc-os.test/api/mcp");
    assert.equal(createEventAction.defaults.execute, true);
    assert.equal(createEventAction.scope, "write:events");
    assert.equal(addAttendeesAction.scope, "write:events");
    assert.equal(enrichEventAction.scope, "write:events");
    assert.equal(addGuestsAction.url, "http://yc-os.test/api/mcp");
    assert.equal(addGuestsAction.defaults.execute, true);
    assert.equal(capabilitiesBody.actions.some((action: { name: string }) => action.name === "reject_applications"), true);
    assert.equal(capabilitiesBody.session.tokenLabel, "site_access_token");

    const toolResponse = await callToolRoute(agentToolRequest("search_founders", {
      pageSize: 3,
      query: "agent"
    }, { headers }));
    const toolBody = await toolResponse.json();
    assert.equal(toolResponse.status, 200);
    assert.equal(toolBody.tool, "search_founders");
    assert.equal(toolBody.result.founders.length <= 3, true);

    const eventsResponse = await callToolRoute(agentToolRequest("list_approval_events", {}, { headers }));
    const eventsBody = await eventsResponse.json();
    const dogpatchEvent = eventsBody.result.events.find((event: { id: string }) => event.id === "dogpatch-founder-breakfast");
    assert.equal(eventsResponse.status, 200);
    assert.equal(eventsBody.tool, "list_approval_events");
    assert.equal(eventsBody.result.events.every((event: { guestAdds?: string; kind?: string; reason?: string }) =>
      typeof event.guestAdds === "string" &&
      typeof event.kind === "string" &&
      typeof event.reason === "string"
    ), true);
    assert.equal(dogpatchEvent?.kind, "real");
    assert.equal(dogpatchEvent?.guestAdds, "available");

    const mcpResponse = await callMcpRoute(mcpToolsListRequest(1));
    const mcpBody = await mcpResponse.json();
    assert.equal(mcpResponse.status, 200);
    assert.equal(mcpBody.result.tools.some((tool: { name: string }) => tool.name === "get_agent_guide"), true);
    assert.equal(mcpBody.result.tools.some((tool: { name: string }) => tool.name === "get_event_prep_context"), true);
    assert.equal(mcpBody.result.tools.some((tool: { name: string }) => tool.name === "create_event"), true);
    assert.equal(mcpBody.result.tools.some((tool: { name: string }) => tool.name === "add_event_attendees"), true);
    assert.equal(mcpBody.result.tools.some((tool: { name: string }) => tool.name === "enrich_event_context"), true);
    assert.equal(mcpBody.result.tools.some((tool: { name: string }) => tool.name === "add_event_guests"), true);
    assert.equal(mcpBody.result.tools.some((tool: { name: string }) => tool.name === "approve_applications"), true);
    assert.equal(mcpBody.result.tools.some((tool: { name: string }) => tool.name === "get_guest_context"), true);

    const guideResponse = await callMcpRoute(mcpToolCallRequest(2, "get_agent_guide", {}));
    const guideBody = await guideResponse.json();
    assert.equal(guideResponse.status, 200);
    assert.equal(guideBody.result.structuredContent.smokeTest.steps.some((step: string) => step.includes("operator-provided email")), true);
    assert.equal(guideBody.result.structuredContent.capacityLimit.safeguards.some((step: string) => step.includes("Never remove real attendees")), true);
    assert.equal(guideBody.result.structuredContent.developmentLimits.safeguards.some((step: string) => step.includes("production acceptance test")), true);

    const createEventDryRunResponse = await callMcpRoute(mcpToolCallRequest(3, "create_event", {
      execute: false,
      title: "YC Agent Test Event"
    }));
    const createEventDryRunBody = await createEventDryRunResponse.json();
    assert.equal(createEventDryRunResponse.status, 200);
    assert.equal(createEventDryRunBody.result.structuredContent.action, "events.create");
    assert.equal(createEventDryRunBody.result.structuredContent.mode, "dry_run");
    assert.equal(createEventDryRunBody.result.structuredContent.event.providerSync, "yc_os_runtime");

    const addAttendeesDryRunResponse = await callMcpRoute(mcpToolCallRequest(4, "add_event_attendees", {
      attendees: [{ founderId: "founder_1", companyId: "company_1" }],
      execute: false,
      eventId: "yc-agent-event-1"
    }));
    const addAttendeesDryRunBody = await addAttendeesDryRunResponse.json();
    assert.equal(addAttendeesDryRunResponse.status, 200);
    assert.equal(addAttendeesDryRunBody.result.structuredContent.action, "event_attendees.add");
    assert.equal(addAttendeesDryRunBody.result.structuredContent.mode, "dry_run");
    assert.equal(addAttendeesDryRunBody.result.structuredContent.checks.ycSourcesOnly, true);

    const enrichEventDryRunResponse = await callMcpRoute(mcpToolCallRequest(5, "enrich_event_context", {
      eventId: "yc-agent-event-1",
      execute: false,
      needs: [{ founderId: "founder_1", needText: "Looking for buyer intros" }],
      notes: [{ body: "Strong fit for finance operators.", founderId: "founder_1" }]
    }));
    const enrichEventDryRunBody = await enrichEventDryRunResponse.json();
    assert.equal(enrichEventDryRunResponse.status, 200);
    assert.equal(enrichEventDryRunBody.result.structuredContent.action, "event_context.enrich");
    assert.equal(enrichEventDryRunBody.result.structuredContent.mode, "dry_run");
    assert.equal(enrichEventDryRunBody.result.structuredContent.checks.ycSourcesOnly, true);

    const guestDryRunResponse = await callMcpRoute(mcpToolCallRequest(6, "add_event_guests", {
      eventId: "dogpatch-founder-breakfast",
      execute: false,
      guests: [{ email: "operator@example.com" }]
    }));
    const guestDryRunBody = await guestDryRunResponse.json();
    assert.equal(guestDryRunResponse.status, 200);
    assert.equal(guestDryRunBody.result.structuredContent.action, "event_guests.add");
    assert.equal(guestDryRunBody.result.structuredContent.mode, "dry_run");
    assert.equal("lumaEventId" in guestDryRunBody.result.structuredContent.event, false);

    const approvalDryRunResponse = await callMcpRoute(mcpToolCallRequest(7, "approve_applications", {
      eventId: "yc-founder-mixer",
      execute: false,
      query: {
        pageSize: 1,
        queue: "ready",
        segment: "yc_founders"
      }
    }));
    const approvalDryRunBody = await approvalDryRunResponse.json();
    assert.equal(approvalDryRunResponse.status, 200);
    assert.equal(approvalDryRunBody.result.structuredContent.mode, "dry_run");
    assert.equal(approvalDryRunBody.result.structuredContent.requestedCount, 1);
    assert.equal(approvalDryRunBody.result.structuredContent.appliedCount, 1);
    assert.equal(approvalDryRunBody.result.structuredContent.applications.length, 1);
    assert.equal(approvalDryRunBody.result.structuredContent.backendJobs.event_writeback > 0, true);
    assert.equal(approvalDryRunBody.result.structuredContent.runtime.owner, "yc_os");
    assert.equal(approvalDryRunBody.result.structuredContent.runtime.providerEffects, "dry_run");
    assert.equal(approvalDryRunBody.result.structuredContent.runtimeJobs.event_writeback > 0, true);

    const queue = await callAgentTool("list_approval_queue", {
      eventId: "yc-founder-mixer",
      pageSize: 1,
      queue: "needs_info"
    });
    const applicationId = (queue as { applications: Array<{ id: string }> }).applications[0].id;
    const guestContextResponse = await callMcpRoute(mcpToolCallRequest(8, "get_guest_context", { applicationId }));
    const guestContextBody = await guestContextResponse.json();
    assert.equal(guestContextResponse.status, 200);
    assert.equal(guestContextBody.result.structuredContent.application.id, applicationId);
    assert.match(guestContextBody.result.structuredContent.contact.email, /@/);
    assert.equal(typeof guestContextBody.result.structuredContent.guest.lumaGuestId, "string");
    assert.equal(Array.isArray(guestContextBody.result.structuredContent.runtime.events), true);

    const unsupportedGet = await getMcpRoute(testRequest("/api/mcp", {
      headers: routeMcpHeaders,
      method: "GET"
    }));
    const unsupportedGetBody = await unsupportedGet.json();
    assert.equal(unsupportedGet.status, 405);
    assert.equal(unsupportedGetBody.error, "mcp_sse_not_supported");

    const missingAccept = await callMcpRoute(jsonPostRequest("/api/mcp", {
      id: 9,
      jsonrpc: "2.0",
      method: "tools/list"
    }, { headers }));
    const missingAcceptBody = await missingAccept.json();
    assert.equal(missingAccept.status, 406);
    assert.equal(missingAcceptBody.error, "mcp_accept_required");

    const toolErrorResponse = await callMcpRoute(mcpToolCallRequest(10, "missing_tool", {}));
    const toolErrorBody = await toolErrorResponse.json();
    assert.equal(toolErrorResponse.status, 200);
    assert.equal(toolErrorBody.result.isError, true);
    assert.equal(toolErrorBody.result.structuredContent.error, "tool_call_failed");
  } finally {
    env.restore();
  }
});

test("agent approval previews are disabled in production", async () => {
  const env = withTestEnv({ APP_ENV: "production" });

  try {
    await assert.rejects(
      () => callAgentTool("approve_applications", {
        eventId: "yc-founder-mixer",
        execute: false
      }),
      /do not accept execute=false/
    );
  } finally {
    env.restore();
  }
});

test("agent tool calls return sanitized backend store errors", async () => {
  const env = withTestEnv({
    APP_ENV: undefined,
    EVENT_PREP_DATA_SOURCE: "supabase",
    SUPABASE_SERVICE_ROLE_KEY: "supabase-service-key",
    SUPABASE_URL: "https://supabase.test"
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ message: "relation public.yc_founder_needs does not exist" }),
    { status: 404 }
  )) as typeof fetch;

  try {
    await assert.rejects(
      () => callAgentTool("enrich_event_context", {
        eventId: "yc-agent-event-1",
        needs: [{ founderId: "founder_1", needText: "Looking for buyer intros" }],
        reason: "Testing sanitized backend store errors"
      }),
      (error: unknown) => error instanceof AgentToolError &&
        error.code === "agent_backend_store_error" &&
        error.statusCode === 503
    );
  } finally {
    globalThis.fetch = previousFetch;
    env.restore();
  }
});

test("agent approval tools omit raw provider payloads and direct contact fields", async () => {
  const response = await callAgentTool("list_approval_queue", {
    eventId: "yc-founder-mixer",
    pageSize: 5,
    queue: "ready"
  });
  const serialized = JSON.stringify(response);

  assert.equal(serialized.includes("lumaPayload"), false);
  assert.equal(serialized.includes("rawFields"), false);
  assert.equal(serialized.includes("guestId"), false);
  assert.equal(serialized.includes("@"), false);
  assert.equal(/\(415\) 555-\d{4}/.test(serialized), false);
});
