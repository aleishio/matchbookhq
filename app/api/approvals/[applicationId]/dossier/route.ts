import { NextResponse } from "next/server";

import {
  EventApprovalsRepositoryError,
  getApprovalDossier
} from "@/app/lib/event-approvals-repository";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ applicationId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { applicationId } = await context.params;

  try {
    const response = await getApprovalDossier(applicationId);
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
    { error: "approval_api_error", message: "Unable to load approval dossier." },
    { status: 500 }
  );
}
