export const TEST_BASE_URL = "http://yc-os.test";
export const TEST_ACCESS_TOKEN = "shared-test-token";
export const TEST_UNLOCK_COOKIE_NAME = "yc_os_access_token";
export const MCP_ACCEPT_HEADER = "application/json, text/event-stream";
export const MCP_PROTOCOL_VERSION = "2025-11-25";

export function bearerHeaders(token = TEST_ACCESS_TOKEN) {
  return {
    authorization: `Bearer ${token}`
  };
}

export function mcpHeaders(token = TEST_ACCESS_TOKEN) {
  return {
    ...bearerHeaders(token),
    accept: MCP_ACCEPT_HEADER,
    "mcp-protocol-version": MCP_PROTOCOL_VERSION
  };
}

export function testRequest(input: string, init: RequestInit = {}) {
  return new Request(testUrl(input), init);
}

export function jsonPostRequest(input: string, body: unknown, init: RequestInit = {}) {
  return testRequest(input, {
    ...init,
    body: JSON.stringify(body),
    headers: mergeHeaders({ "Content-Type": "application/json" }, init.headers),
    method: "POST"
  });
}

export function unlockedRequest(
  input: string,
  init: RequestInit = {},
  options: { cookieName?: string; token?: string } = {}
) {
  const cookieName = options.cookieName ?? TEST_UNLOCK_COOKIE_NAME;
  const token = options.token ?? TEST_ACCESS_TOKEN;

  return testRequest(input, {
    ...init,
    headers: mergeHeaders({ cookie: `${cookieName}=${token}` }, init.headers)
  });
}

export function agentToolRequest(
  tool: string,
  args: Record<string, unknown>,
  init: RequestInit = {}
) {
  return jsonPostRequest("/api/agent/tools/call", {
    arguments: args,
    tool
  }, init);
}

export function mcpRpcRequest(
  body: Record<string, unknown>,
  init: RequestInit = {}
) {
  return jsonPostRequest("/api/mcp", body, {
    ...init,
    headers: mergeHeaders(mcpHeaders(), init.headers)
  });
}

export function mcpToolsListRequest(id: number | string) {
  return mcpRpcRequest({
    id,
    jsonrpc: "2.0",
    method: "tools/list"
  });
}

export function mcpToolCallRequest(
  id: number | string,
  name: string,
  args: Record<string, unknown>
) {
  return mcpRpcRequest({
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      arguments: args,
      name
    }
  });
}

function testUrl(input: string) {
  if (/^https?:\/\//.test(input)) return input;
  return new URL(input, TEST_BASE_URL).toString();
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>) {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}
