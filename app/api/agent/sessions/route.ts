import { NextResponse } from "next/server";

import {
  agentAccessErrorResponse,
  agentNoStoreHeaders,
  createAgentAccessConfig
} from "@/app/lib/agent-session";
import { AGENT_TOOL_DEFINITIONS } from "@/app/lib/agent-tools";
import { AGENT_GUIDE } from "@/lib/agent-guide";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const access = createAgentAccessConfig(request);

    return NextResponse.json(
      {
        actions: access.actions,
        authorizationHeader: access.authorizationHeader,
        capabilitiesUrl: access.capabilitiesUrl,
        config: access.config,
        expiresAt: access.expiresAt,
        guide: AGENT_GUIDE,
        mcpUrl: access.mcpUrl,
        scope: access.scope,
        tokenLabel: access.tokenLabel,
        tools: AGENT_TOOL_DEFINITIONS.map((tool) => ({
          description: tool.description,
          name: tool.name
        })),
        toolsUrl: access.toolsUrl
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
