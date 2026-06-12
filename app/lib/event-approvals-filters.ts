import type {
  ApprovalLens,
  EventApprovalApplication
} from "./event-approvals-types";

export type ApprovalSegment =
  | "all"
  | "ycFounders"
  | "possibleYc"
  | "investors"
  | "network"
  | "unmapped"
  | "capacity";

export const APPROVAL_SEGMENTS: Array<{ id: ApprovalSegment; label: string }> = [
  { id: "all", label: "All people" },
  { id: "ycFounders", label: "YC founders" },
  { id: "possibleYc", label: "Needs YC check" },
  { id: "investors", label: "Investors" },
  { id: "network", label: "Network" },
  { id: "unmapped", label: "Unmapped" },
  { id: "capacity", label: "Capacity" }
];

export const APPROVAL_SEGMENT_FILTERS: Array<{ id: ApprovalSegment; label: string }> = [
  { id: "all", label: "All people" },
  { id: "ycFounders", label: "YC founders" },
  { id: "investors", label: "Investors" },
  { id: "network", label: "Network" },
  { id: "unmapped", label: "External / unmapped" }
];

export function filterApprovalApplications(
  applications: EventApprovalApplication[],
  lens: ApprovalLens,
  segment: ApprovalSegment,
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();

  return applications.filter((application) => {
    if (lens !== "all" && application.status !== lens) return false;
    if (!matchesApprovalSegment(application, segment)) return false;
    if (!normalizedQuery) return true;

    return searchTextFor(application).includes(normalizedQuery);
  });
}

export function summarizeApprovalSegments(applications: EventApprovalApplication[]) {
  return APPROVAL_SEGMENTS.reduce<Record<ApprovalSegment, number>>((counts, segment) => {
    counts[segment.id] = applications.filter((application) => matchesApprovalSegment(application, segment.id)).length;
    return counts;
  }, {} as Record<ApprovalSegment, number>);
}

export function matchesApprovalSegment(
  application: EventApprovalApplication,
  segment: ApprovalSegment
) {
  const relation = application.relation.toLowerCase();

  if (segment === "all") return true;
  if (segment === "capacity") return application.status === "waitlist";
  if (segment === "unmapped") return relation.includes("unmapped");
  if (segment === "possibleYc") return relation.includes("possible yc");
  if (segment === "investors") return relation.includes("investor");
  if (segment === "network") return relation.includes("network") || relation.includes("guest");

  return isVerifiedYcFounder(application);
}

export function approvalSegmentLabelFor(application: EventApprovalApplication) {
  if (matchesApprovalSegment(application, "capacity")) return "Capacity hold";
  if (matchesApprovalSegment(application, "investors")) return "Investor";
  if (matchesApprovalSegment(application, "network")) return "Network";
  if (matchesApprovalSegment(application, "possibleYc")) return "Needs YC check";
  if (matchesApprovalSegment(application, "unmapped")) return "Unmapped";
  if (matchesApprovalSegment(application, "ycFounders")) return "YC founder";

  return "Manual";
}

function isVerifiedYcFounder(application: EventApprovalApplication) {
  if (application.status !== "ready" && application.status !== "waitlist" && application.status !== "approved") {
    return false;
  }

  const relation = application.relation.toLowerCase();
  return relation.includes("founder") && !relation.includes("possible") && !relation.includes("guest");
}

function searchTextFor(application: EventApprovalApplication) {
  return [
    application.name,
    application.email,
    application.phone,
    application.companyName,
    application.companyLine,
    application.relation,
    application.rule,
    application.recommendation,
    application.lumaStatus,
    application.lumaPayload.name,
    application.lumaPayload.email,
    application.lumaPayload.phone,
    ...Object.values(application.lumaPayload.registrationAnswers),
    ...Object.values(application.lumaPayload.rawFields).map((value) => String(value ?? "")),
    ...application.sourceComparisons.flatMap((comparison) => [
      comparison.field,
      comparison.source,
      comparison.lumaValue,
      comparison.ycValue ?? "",
      comparison.result,
      comparison.notes
    ]),
    application.aiRecommendation.decision,
    application.aiRecommendation.reason,
    ...application.aiRecommendation.signals,
    application.clarificationRequest?.sentFrom ?? "",
    application.clarificationRequest?.subject ?? "",
    application.clarificationRequest?.preview ?? "",
    application.parsedReply?.summary ?? "",
    application.parsedReply?.reason ?? "",
    application.parsedReply?.aiDecision ?? "",
    ...(application.parsedReply?.extracted ?? []),
    ...application.evidence.flatMap((item) => [item.label, item.value]),
    ...application.audit
  ].join(" ").toLowerCase();
}
