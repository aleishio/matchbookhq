import type { ApprovalStatus, EventApprovalApplication } from "./event-approvals-types";

export function transitionApplication(
  application: EventApprovalApplication,
  status: ApprovalStatus,
  auditMessage: string
): EventApprovalApplication {
  if (status === "approved") {
    return {
      ...application,
      status,
      matchConfidence: 100,
      recommendation: "Approved by ops in YC OS.",
      rule: "A1 user approved and synced to Lu.ma",
      lumaStatus: "Approved in Lu.ma",
      primaryAction: "none",
      evidence: [{ label: "User decision", value: auditMessage, tone: "ok" }, ...application.evidence],
      audit: [auditMessage, ...application.audit]
    };
  }

  if (status === "rejected") {
    return {
      ...application,
      status,
      matchConfidence: 0,
      recommendation: "Rejected by ops in YC OS.",
      rule: "J1 user rejected and synced to Lu.ma",
      lumaStatus: "Declined in Lu.ma",
      primaryAction: "none",
      evidence: [{ label: "User decision", value: auditMessage, tone: "warn" }, ...application.evidence],
      audit: [auditMessage, ...application.audit]
    };
  }

  return {
    ...application,
    status,
    recommendation: "Wait for applicant details or review the parsed reply.",
    rule: "C2 clarification email sent, reply can be parsed before review",
    lumaStatus: "Pending in Lu.ma",
    primaryAction: "manualReview",
    audit: [auditMessage, ...application.audit]
  };
}

export function canSendInfo(application: EventApprovalApplication) {
  return application.status !== "awaitingReply" && application.email.trim().length > 0;
}

export function canApprove(application: EventApprovalApplication) {
  return application.status !== "approved";
}

export function canReject(application: EventApprovalApplication) {
  return application.status !== "rejected";
}
