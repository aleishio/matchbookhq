import { NextResponse } from "next/server";

import {
  generateClarificationEmailDraft
} from "@/app/lib/clarification-email-draft";
import {
  boundedInteger,
  EventApprovalsRepositoryError,
  listEventApprovals,
  normalizeAiDecision,
  normalizeApprovalQueue,
  normalizeApprovalSegment
} from "@/app/lib/event-approvals-repository";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const body = await request.json();
    if (!isRecord(body)) {
      throw new EventApprovalsRepositoryError("invalid_body", "Email draft request body must be an object.");
    }

    const draftContext = await draftContextFor(eventId, body);
    const draft = await generateClarificationEmailDraft({
      notes: readString(body.notes) ?? "",
      eventTitle: draftContext.eventTitle,
      recipientCount: draftContext.recipientCount
    });

    return NextResponse.json(draft);
  } catch (error) {
    return approvalsErrorResponse(error);
  }
}

async function draftContextFor(eventId: string, body: Record<string, unknown>) {
  const query = readQuery(body.query);
  if (query) {
    const response = await listEventApprovals({
      eventId,
      ...query,
      page: 1,
      pageSize: 1
    });

    return {
      eventTitle: response.event.title,
      recipientCount: response.total
    };
  }

  const response = await listEventApprovals({
    eventId,
    page: 1,
    pageSize: 1
  });
  const applicationIds = readStringArray(body.applicationIds);

  return {
    eventTitle: response.event.title,
    recipientCount: Math.max(1, applicationIds?.length ?? 1)
  };
}

function readQuery(value: unknown) {
  if (!isRecord(value)) return undefined;

  return {
    queue: normalizeApprovalQueue(readString(value.queue), "all"),
    segment: normalizeApprovalSegment(readString(value.segment), "all"),
    aiDecision: normalizeAiDecision(readString(value.aiDecision), "all"),
    search: readString(value.search) ?? "",
    page: boundedInteger(readStringOrNumber(value.page), 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: boundedInteger(readStringOrNumber(value.pageSize), 25, 1, 100)
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readStringOrNumber(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function approvalsErrorResponse(error: unknown) {
  if (error instanceof EventApprovalsRepositoryError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    { error: "approval_api_error", message: "Unable to draft clarification email." },
    { status: 500 }
  );
}
