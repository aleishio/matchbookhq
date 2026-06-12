import { timingSafeEqual } from "node:crypto";
import {
  getSiteAccessToken,
  getUnlockCookieName,
  readBearerToken
} from "./site-access";

export type AgentScope =
  | "mcp:tools"
  | "read:event_prep"
  | "read:approvals"
  | "write:events"
  | "write:event_guests"
  | "write:approvals";

export type AgentAccessContext = {
  scope: AgentScope[];
  tokenLabel: "site_access_token";
};

export class AgentAccessError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AgentAccessError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const DEFAULT_SCOPE: AgentScope[] = ["mcp:tools", "read:event_prep", "read:approvals", "write:events", "write:event_guests", "write:approvals"];

export function createAgentAccessConfig(request: Request) {
  assertUnlockedForAgentAccess(request);

  const accessToken = getSiteAccessTokenOrThrow();
  const origin = agentRequestOrigin(request);
  const mcpUrl = `${origin}/api/mcp`;
  const toolsUrl = `${origin}/api/agent/tools/call`;
  const capabilitiesUrl = `${origin}/api/agent/capabilities`;
  return {
    actions: [
      {
        description: "Create YC OS events through the agent-native MCP surface.",
        method: "MCP tools/call",
        name: "create_event",
        url: mcpUrl
      },
      {
        description: "Attach YC founder/company records to YC OS events.",
        method: "MCP tools/call",
        name: "add_event_attendees",
        url: mcpUrl
      },
      {
        description: "Enrich YC OS event context with YC notes and founder needs.",
        method: "MCP tools/call",
        name: "enrich_event_context",
        url: mcpUrl
      },
      {
        description: "Create YC OS event guest requests. Live by default with a reason; YC OS runtime performs provider work.",
        method: "MCP tools/call",
        name: "add_event_guests",
        url: mcpUrl
      },
      {
        description: "Approve event applications through YC OS.",
        method: "MCP tools/call",
        name: "approve_applications",
        url: mcpUrl
      },
      {
        description: "Reject event applications through YC OS.",
        method: "MCP tools/call",
        name: "reject_applications",
        url: mcpUrl
      },
      {
        description: "Request more information from event applicants through YC OS.",
        method: "MCP tools/call",
        name: "request_application_info",
        url: mcpUrl
      }
    ],
    authorizationHeader: `Bearer ${accessToken}`,
    capabilitiesUrl,
    config: {
      mcpServers: {
        "yc-os": {
          headers: {
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${accessToken}`,
            "MCP-Protocol-Version": "2025-11-25"
          },
          url: mcpUrl
        }
      }
    },
    expiresAt: null,
    mcpUrl,
    scope: DEFAULT_SCOPE,
    tokenLabel: "site_access_token" as const,
    toolsUrl
  };
}

export function verifyAgentBearerToken(authorization: string | null): AgentAccessContext {
  const token = readBearerToken(authorization);
  if (!token) {
    throw new AgentAccessError("agent_token_missing", "Bearer token is required.", 401);
  }

  assertSiteAccessToken(token);

  return {
    scope: DEFAULT_SCOPE,
    tokenLabel: "site_access_token"
  };
}

export function agentRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const host = firstHeaderValue(request.headers.get("host"));
  const resolvedHost = forwardedHost ?? host ?? url.host;
  const resolvedProtocol = forwardedProto ?? url.protocol.replace(":", "");

  return `${resolvedProtocol}://${resolvedHost}`;
}

export function assertUnlockedForAgentAccess(request: Request) {
  const accessToken = getSiteAccessTokenOrThrow();
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const cookieName = getUnlockCookieName();
  const cookieValue = cookies[cookieName];

  if (!cookieValue || !safeEqual(cookieValue, accessToken)) {
    throw new AgentAccessError(
      "site_locked",
      "Unlock YC OS in this browser before copying agent access.",
      401
    );
  }
}

export function agentAccessErrorResponse(error: unknown) {
  if (error instanceof AgentAccessError) {
    return {
      body: { error: error.code, message: error.message },
      status: error.statusCode
    };
  }

  return {
    body: { error: "agent_access_error", message: "Unable to complete agent access request." },
    status: 500
  };
}

export function agentNoStoreHeaders() {
  return {
    "Cache-Control": "no-store"
  };
}

function getSiteAccessTokenOrThrow() {
  const token = getSiteAccessToken();

  if (!token) {
    throw new AgentAccessError(
      "site_access_token_missing",
      "YC_OS_ACCESS_TOKEN is required before agent access can be used.",
      503
    );
  }

  return token;
}

function assertSiteAccessToken(candidate: string) {
  const accessToken = getSiteAccessTokenOrThrow();
  if (!safeEqual(candidate, accessToken)) {
    throw new AgentAccessError("agent_token_invalid", "Agent access token is invalid.", 401);
  }
}

function firstHeaderValue(value: string | null) {
  const first = value?.split(",")[0]?.trim();
  return first || undefined;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) return {} as Record<string, string>;

  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separatorIndex = cookie.indexOf("=");
        if (separatorIndex === -1) return [cookie, ""];
        return [
          decodeURIComponent(cookie.slice(0, separatorIndex)),
          decodeURIComponent(cookie.slice(separatorIndex + 1))
        ];
      })
  );
}
