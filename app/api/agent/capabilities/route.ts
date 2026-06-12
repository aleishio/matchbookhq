import { NextResponse } from "next/server";

import {
  agentAccessErrorResponse,
  agentNoStoreHeaders,
  agentRequestOrigin,
  verifyAgentBearerToken
} from "@/app/lib/agent-session";
import { AGENT_TOOL_DEFINITIONS } from "@/app/lib/agent-tools";
import { AGENT_GUIDE } from "@/lib/agent-guide";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const access = verifyAgentBearerToken(request.headers.get("authorization"));
    const origin = agentRequestOrigin(request);

    return NextResponse.json(
      {
        actions: [
          {
            defaults: { execute: true },
            description: "Create YC OS events through the agent-native MCP surface. Live with a reason; production rejects execute=false.",
            method: "MCP tools/call",
            name: "create_event",
            required: ["title"],
            requiresForExecute: ["reason"],
            scope: "write:events",
            url: `${origin}/api/mcp`
          },
          {
            defaults: { execute: true },
            description: "Attach YC founder/company records to YC OS events. Live with a reason; production rejects execute=false.",
            method: "MCP tools/call",
            name: "add_event_attendees",
            required: ["eventId", "attendees"],
            requiresForExecute: ["reason"],
            scope: "write:events",
            url: `${origin}/api/mcp`
          },
          {
            defaults: { execute: true },
            description: "Enrich YC OS event context with YC notes and founder needs. Live with a reason; production rejects execute=false.",
            method: "MCP tools/call",
            name: "enrich_event_context",
            required: ["eventId"],
            requiresForExecute: ["reason"],
            scope: "write:events",
            url: `${origin}/api/mcp`
          },
          {
            defaults: {
              approvalStatus: "approved",
              execute: true,
              sendEmail: false
            },
            description: "Create YC OS event guest requests. Live with a reason; production rejects execute=false. The YC OS runtime owns provider execution.",
            method: "MCP tools/call",
            name: "add_event_guests",
            required: ["eventId", "guests"],
            requiresForExecute: ["reason"],
            scope: "write:event_guests",
            url: `${origin}/api/mcp`
          },
          {
            defaults: { execute: true },
            description: "Approve applications through YC OS. Live with a reason; production rejects execute=false.",
            method: "MCP tools/call",
            name: "approve_applications",
            required: ["eventId"],
            requiresForExecute: ["reason"],
            scope: "write:approvals",
            url: `${origin}/api/mcp`
          },
          {
            defaults: { execute: true },
            description: "Reject applications through YC OS. Live with a reason; production rejects execute=false.",
            method: "MCP tools/call",
            name: "reject_applications",
            required: ["eventId"],
            requiresForExecute: ["reason"],
            scope: "write:approvals",
            url: `${origin}/api/mcp`
          },
          {
            defaults: { execute: true },
            description: "Request more information from applications through YC OS. Live with a reason; production rejects execute=false.",
            method: "MCP tools/call",
            name: "request_application_info",
            required: ["eventId"],
            requiresForExecute: ["reason"],
            scope: "write:approvals",
            url: `${origin}/api/mcp`
          }
        ],
        capabilities: {
          tools: true,
          writeActions: true
        },
        guide: AGENT_GUIDE,
        session: {
          expiresAt: null,
          scope: access.scope,
          tokenLabel: access.tokenLabel
        },
        tools: AGENT_TOOL_DEFINITIONS
      },
      { headers: agentNoStoreHeaders() }
    );
  } catch (error) {
    const response = agentAccessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: agentNoStoreHeaders(),
      status: response.status
    });
  }
}
