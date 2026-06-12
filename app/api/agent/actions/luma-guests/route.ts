import { NextResponse } from "next/server";

import {
  AgentActionError,
  agentActionErrorResponse,
  createLumaGuestsForAgent
} from "@/app/lib/agent-actions";
import {
  AgentAccessError,
  agentAccessErrorResponse,
  agentNoStoreHeaders,
  verifyAgentBearerToken
} from "@/app/lib/agent-session";
import { captureServerAnalyticsEvent } from "@/app/lib/server-analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    verifyAgentBearerToken(request.headers.get("authorization"));

    const body = await readJsonBody(request);
    const result = await createLumaGuestsForAgent(body);

    await captureServerAnalyticsEvent("agent event guests action requested", {
      approval_status: result.approvalStatus,
      event_id: result.event.id,
      guest_count_bucket: countBucket(result.requestedCount),
      mode: result.mode,
      result: result.mode,
      send_email: result.sendEmail,
      status_code: 200
    });

    return NextResponse.json(
      { result },
      { headers: agentNoStoreHeaders() }
    );
  } catch (error) {
    if (error instanceof AgentAccessError) {
      const response = agentAccessErrorResponse(error);
      return NextResponse.json(response.body, {
        headers: agentNoStoreHeaders(),
        status: response.status
      });
    }

    const response = agentActionErrorResponse(error);
    await captureServerAnalyticsEvent("agent event guests action requested", {
      error_code: errorCodeFor(response.body),
      result: "error",
      status_code: response.status
    });

    return NextResponse.json(response.body, {
      headers: agentNoStoreHeaders(),
      status: response.status
    });
  }
}

async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new AgentActionError("invalid_json", "Request body must be valid JSON.", 400);
  }
}

function countBucket(count: number) {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2-5";
  return "6-10";
}

function errorCodeFor(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "unknown";
  const error = (body as Record<string, unknown>).error;
  return typeof error === "string" ? error : "unknown";
}
