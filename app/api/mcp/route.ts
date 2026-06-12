import { NextResponse } from "next/server";

import {
  agentAccessErrorResponse,
  agentNoStoreHeaders,
  agentRequestOrigin,
  verifyAgentBearerToken
} from "@/app/lib/agent-session";
import {
  AGENT_TOOL_DEFINITIONS,
  callAgentTool
} from "@/app/lib/agent-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonRpcRequest = {
  id?: number | string | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
};

const MCP_PROTOCOL_VERSION = "2025-11-25";
const REQUIRED_ACCEPT_TYPES = ["application/json", "text/event-stream"];

export async function POST(request: Request) {
  try {
    verifyAgentBearerToken(request.headers.get("authorization"));
    assertValidOrigin(request);
    assertValidPostAccept(request.headers.get("accept"));
    assertSupportedProtocolVersion(request);

    const body = await readJsonRpcBody(request);
    if (Array.isArray(body)) {
      return NextResponse.json(
        jsonRpcError(null, -32600, "JSON-RPC batches are not supported by this MCP Streamable HTTP endpoint."),
        { headers: agentNoStoreHeaders(), status: 400 }
      );
    }

    if (isAcceptedNotification(body)) {
      return new Response(null, {
        headers: agentNoStoreHeaders(),
        status: 202
      });
    }

    const response = await handleJsonRpcRequest(body);
    return NextResponse.json(response, { headers: agentNoStoreHeaders() });
  } catch (error) {
    const response = mcpHttpErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: agentNoStoreHeaders(),
      status: response.status
    });
  }
}

export async function GET(request: Request) {
  try {
    verifyAgentBearerToken(request.headers.get("authorization"));
    assertValidOrigin(request);
    return NextResponse.json(
      { error: "mcp_sse_not_supported", message: "This MCP server does not support server-to-client SSE streams." },
      {
        headers: {
          ...agentNoStoreHeaders(),
          Allow: "POST"
        },
        status: 405
      }
    );
  } catch (error) {
    const response = mcpHttpErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: agentNoStoreHeaders(),
      status: response.status
    });
  }
}

async function handleJsonRpcRequest(raw: unknown) {
  if (!isRecord(raw)) {
    return jsonRpcError(null, -32600, "Invalid JSON-RPC request.");
  }

  const request = raw as JsonRpcRequest;
  const id = request.id ?? null;

  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(id, -32600, "Invalid JSON-RPC request.");
  }

  if (request.method === "initialize") {
    return jsonRpcResult(id, {
      capabilities: {
        tools: {}
      },
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: "yc-os",
        version: "0.1.0"
      }
    });
  }

  if (request.method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (request.method === "tools/list") {
    return jsonRpcResult(id, {
      tools: AGENT_TOOL_DEFINITIONS.map((tool) => ({
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name
      }))
    });
  }

  if (request.method === "tools/call") {
    const params = isRecord(request.params) ? request.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = params.arguments ?? {};

    try {
      const result = await callAgentTool(name, args);
      return jsonRpcResult(id, mcpToolResult(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool call failed.";
      return jsonRpcResult(id, {
        content: [
          {
            text: message,
            type: "text"
          }
        ],
        isError: true,
        structuredContent: {
          error: "tool_call_failed",
          message
        }
      });
    }
  }

  return jsonRpcError(id, -32601, `Unsupported method: ${request.method}.`);
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return {
    id,
    jsonrpc: "2.0",
    result
  };
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return {
    error: {
      code,
      message
    },
    id,
    jsonrpc: "2.0"
  };
}

function mcpToolResult(result: unknown) {
  return {
    content: [
      {
        text: JSON.stringify(result, null, 2),
        type: "text"
      }
    ],
    structuredContent: result
  };
}

async function readJsonRpcBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new McpHttpError(
      400,
      "mcp_parse_error",
      "MCP request body must be valid JSON."
    );
  }
}

function isAcceptedNotification(raw: unknown) {
  if (!isRecord(raw)) return false;
  const request = raw as JsonRpcRequest;
  return request.jsonrpc === "2.0" &&
    typeof request.method === "string" &&
    request.id === undefined;
}

function assertValidPostAccept(acceptHeader: string | null) {
  const acceptedTypes = parseHeaderValues(acceptHeader);
  const hasEveryRequiredType = REQUIRED_ACCEPT_TYPES.every((type) => acceptedTypes.includes(type));
  if (hasEveryRequiredType) return;

  throw new McpHttpError(
    406,
    "mcp_accept_required",
    "MCP POST requests must accept both application/json and text/event-stream."
  );
}

function assertSupportedProtocolVersion(request: Request) {
  const protocolVersion = request.headers.get("mcp-protocol-version")?.trim();
  if (!protocolVersion || protocolVersion === MCP_PROTOCOL_VERSION) return;

  throw new McpHttpError(
    400,
    "mcp_protocol_version_unsupported",
    `Unsupported MCP-Protocol-Version: ${protocolVersion}.`
  );
}

function assertValidOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  if (origin === agentRequestOrigin(request)) return;

  throw new McpHttpError(
    403,
    "mcp_origin_forbidden",
    "MCP request origin is not allowed."
  );
}

function parseHeaderValues(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean);
}

class McpHttpError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "McpHttpError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function mcpHttpErrorResponse(error: unknown) {
  if (error instanceof McpHttpError) {
    return {
      body: {
        error: error.code,
        message: error.message
      },
      status: error.statusCode
    };
  }

  return agentAccessErrorResponse(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
