import assert from "node:assert/strict";
import test from "node:test";

import { AI_AGENT_COMPACT_DOCS } from "../app/lib/how-built-docs.ts";

test("AI how-built docs stay compact and copy-ready", () => {
  const words = AI_AGENT_COMPACT_DOCS.trim().split(/\s+/);
  const lines = AI_AGENT_COMPACT_DOCS.split("\n");

  assert.equal(AI_AGENT_COMPACT_DOCS.startsWith("YC_OS_AI_DOCS\n"), true);
  assert.equal(words.length <= 125, true);
  assert.equal(lines.length <= 8, true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("/api/agent/capabilities"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("/api/mcp"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("/api/agent/tools/call"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("read_tools="), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("get_agent_guide"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("get_event_prep_context"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("list_event_prep_events"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("search_founders"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("list_approval_events"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("list_approval_queue"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("get_approval_summary"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("get_guest_context"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("write_tools="), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("MCP only"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("create_event"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("add_event_attendees"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("enrich_event_context"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("add_event_guests"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("approve_applications"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("reject_applications"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("request_application_info"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("YC OS runtime executes records/provider effects"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("writes are live in production"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("execute=true"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("execute=false"), false);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("service-role"), true);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("|"), false);
  assert.equal(AI_AGENT_COMPACT_DOCS.includes("@"), false);
});
