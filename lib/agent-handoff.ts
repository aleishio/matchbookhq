import { AGENT_GUIDE } from "@/lib/agent-guide";

type AgentHandoffTool = {
  description: string;
  name: string;
};

type AgentHandoffAction = {
  description: string;
  method: string;
  name: string;
  url: string;
};

export type AgentHandoffSession = {
  actions: AgentHandoffAction[];
  capabilitiesUrl: string;
  config: {
    mcpServers: {
      "yc-os": {
        headers: {
          Authorization: string;
        };
        url: string;
      };
    };
  };
  expiresAt: string | null;
  mcpUrl: string;
  scope: string[];
  tools: AgentHandoffTool[];
  toolsUrl: string;
};

export function formatAgentHandoffText(session: AgentHandoffSession) {
  const authorizationHeader = session.config.mcpServers["yc-os"].headers.Authorization;

  return `YC OS MCP agent handoff
MCP URL: ${session.mcpUrl}
Tools endpoint: ${session.toolsUrl}
Capabilities endpoint: ${session.capabilitiesUrl}
Authorization header: ${authorizationHeader}
Expires at: ${session.expiresAt ?? "same as site unlock token"}
Scope: ${session.scope.join(", ")}

Assignment for the receiving agent:
${AGENT_GUIDE.overview} Do not ask the operator what to do first. Use MCP/API tools only; do not open or browse the YC OS website.

First task:
${numbered(AGENT_GUIDE.firstTask)}

Operator report:
${bullets(AGENT_GUIDE.operatorReport)}

Real vs fake/test data:
${bullets(AGENT_GUIDE.dataLabels)}

Safe YC team smoke test:
${AGENT_GUIDE.smokeTest.title}
${AGENT_GUIDE.smokeTest.when}
${numbered(AGENT_GUIDE.smokeTest.steps)}

Smoke-test safeguards:
${bullets(AGENT_GUIDE.smokeTest.safeguards)}

Provider add limit:
${AGENT_GUIDE.capacityLimit.title}
${numbered(AGENT_GUIDE.capacityLimit.steps)}

Capacity safeguards:
${bullets(AGENT_GUIDE.capacityLimit.safeguards)}

Provider development limits:
${AGENT_GUIDE.developmentLimits.title}
${numbered(AGENT_GUIDE.developmentLimits.steps)}

Development-limit safeguards:
${bullets(AGENT_GUIDE.developmentLimits.safeguards)}

If localhost is unreachable from your shell or browser, do not switch to UI exploration. Report that MCP/API network access is unavailable from your runtime and ask the operator for MCP access or tool output.

Use this MCP config in Claude Cowork, Codex, OpenClaw, Cursor, Paperclip, or another MCP-capable agent:

${JSON.stringify(session.config, null, 2)}

MCP tools:
${session.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n")}

Write actions:
${session.actions.map((action) => `- ${action.name}: ${action.method} via ${action.url}. ${action.description}`).join("\n")}

Rules:
- This is the same token that unlocks YC OS for authorized users.
- The token grants scoped YC OS MCP tools only. Treat those tools as the operating surface; provider APIs, secrets, raw payloads, retries, and audit stay inside the YC OS runtime.
- Call get_agent_guide or ${session.capabilitiesUrl} before assuming the workflow.
- Use MCP tools/call with Authorization set to the same bearer token.
- Write tools are live in production when a reason is supplied; omit execute or set execute=true.
- sendEmail defaults to false for guest requests; keep it false unless the operator asks otherwise.
- It does not grant server shell, database console, repo write, deployment, or secrets access.
- Do not paste production secrets, .env values, service-role keys, or private customer data into the agent.
- Keep payloads small: at most 10 guests per request.
- Do not put tokens, names, emails, phones, reasons, or raw provider payloads into public logs or PR text.`;
}

function numbered(items: string[]) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function bullets(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}
