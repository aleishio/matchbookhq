import { NextResponse } from "next/server";

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

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const url = new URL(request.url);

  try {
    const response = await listEventApprovals({
      eventId,
      queue: normalizeApprovalQueue(url.searchParams.get("queue"), "all"),
      segment: normalizeApprovalSegment(url.searchParams.get("segment"), "all"),
      aiDecision: normalizeAiDecision(url.searchParams.get("aiDecision"), "all"),
      search: url.searchParams.get("search") ?? "",
      page: boundedInteger(url.searchParams.get("page"), 1, 1, Number.MAX_SAFE_INTEGER),
      pageSize: boundedInteger(url.searchParams.get("pageSize"), 25, 1, 100)
    });

    return NextResponse.json(response);
  } catch (error) {
    return approvalsErrorResponse(error);
  }
}

function approvalsErrorResponse(error: unknown) {
  if (error instanceof EventApprovalsRepositoryError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    { error: "approval_api_error", message: "Unable to load event approvals." },
    { status: 500 }
  );
}
