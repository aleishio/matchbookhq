import { NextResponse } from "next/server";

import {
  boundedInteger,
  createBulkApprovalOperation,
  EventApprovalsRepositoryError,
  type ClarificationEmailInput,
  normalizeAiDecision,
  normalizeApprovalQueue,
  normalizeApprovalSegment,
  normalizeBulkAction
} from "@/app/lib/event-approvals-repository";
import { runImmediateApprovalWritebackSync } from "@/app/lib/approval-writeback-sync";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const body = await request.json();
    if (!isRecord(body)) {
      throw new EventApprovalsRepositoryError("invalid_body", "Bulk approval request body must be an object.");
    }

    const response = await createBulkApprovalOperation({
      eventId,
      action: normalizeBulkAction(readString(body.action)),
      applicationIds: readStringArray(body.applicationIds),
      query: readQuery(body.query),
      actorId: readString(body.actorId),
      actorName: readString(body.actorName),
      reason: readString(body.reason),
      clarificationEmail: readClarificationEmail(body.clarificationEmail),
      dryRun: body.dryRun === true
    });

    response.writebackSync = await runImmediateApprovalWritebackSync(response);

    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    return approvalsErrorResponse(error);
  }
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

function readClarificationEmail(value: unknown): ClarificationEmailInput | undefined {
  if (!isRecord(value)) return undefined;
  return {
    subject: readString(value.subject),
    body: readString(value.body)
  };
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
    { error: "approval_api_error", message: "Unable to create bulk approval operation." },
    { status: 500 }
  );
}
