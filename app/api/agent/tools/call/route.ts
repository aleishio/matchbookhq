import { NextResponse } from "next/server";

import {
  agentAccessErrorResponse,
  agentNoStoreHeaders,
  verifyAgentBearerToken
} from "@/app/lib/agent-session";
import {
  agentToolErrorResponse,
  callAgentTool
} from "@/app/lib/agent-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    verifyAgentBearerToken(request.headers.get("authorization"));

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "invalid_tool_request", message: "Tool request body must be an object." },
        { headers: agentNoStoreHeaders(), status: 400 }
      );
    }

    const toolName = typeof body.tool === "string"
      ? body.tool
      : typeof body.name === "string"
        ? body.name
        : "";
    const result = await callAgentTool(toolName, body.arguments ?? body.input ?? {});

    return NextResponse.json(
      { result, tool: toolName },
      { headers: agentNoStoreHeaders() }
    );
  } catch (error) {
    const response = agentAccessErrorResponse(error);
    if (response.status !== 500 || response.body.error === "site_access_token_missing") {
      return NextResponse.json(response.body, {
        headers: agentNoStoreHeaders(),
        status: response.status
      });
    }

    const toolResponse = agentToolErrorResponse(error);
    return NextResponse.json(toolResponse.body, {
      headers: agentNoStoreHeaders(),
      status: toolResponse.status
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
