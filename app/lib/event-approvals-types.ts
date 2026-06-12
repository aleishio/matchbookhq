export type ApprovalStatus =
  | "ready"
  | "needsInfo"
  | "awaitingReply"
  | "manual"
  | "waitlist"
  | "approved"
  | "rejected";

export type ApprovalLens = ApprovalStatus | "all";
export type ApprovalAction = "approve" | "sendInfo" | "manualReview" | "waitlist" | "none";
export type EvidenceTone = "ok" | "warn" | "neutral";
export type ApplicantSourceKind =
  | "luma"
  | "yc_founder"
  | "yc_company"
  | "yc_network"
  | "email_reply"
  | "ai_review";
export type SourceComparisonResult = "match" | "partial" | "missing" | "conflict" | "not_checked";
export type AiApprovalDecision = "approve" | "send_info" | "manual" | "waitlist" | "reject";

export const DEFAULT_CLARIFICATION_EMAIL_SUBJECT = "Confirming your YC event details";
export const DEFAULT_CLARIFICATION_EMAIL_BODY = "Please reply with your YC company, batch, role, and any mapped YC email.";
export const MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH = 140;
export const MAX_CLARIFICATION_EMAIL_BODY_LENGTH = 2000;
export const MAX_CLARIFICATION_EMAIL_NOTES_LENGTH = 1200;

export type LoadedLumaEvent = {
  id: string;
  lumaApiId?: string;
  title: string;
  startsAt: string;
  location: string;
  seats: number;
  applicationCount: number;
  source: string;
  seedId?: string;
  syncedAt: string;
  url?: string;
};

export type ApprovalEvidence = {
  label: string;
  value: string;
  tone: EvidenceTone;
};

export type LumaApplicationPayload = {
  guestId: string;
  eventApiId: string;
  approvalStatus: string;
  registeredAt: string;
  name: string;
  email: string;
  phone: string;
  registrationAnswers: Record<string, string>;
  rawFields: Record<string, string | number | boolean | null>;
};

export type ApplicantSourceComparison = {
  field: "email" | "alternate_email" | "phone" | "name" | "company" | "batch" | "role" | "network" | "reply";
  source: ApplicantSourceKind;
  lumaValue: string;
  ycValue?: string;
  result: SourceComparisonResult;
  weight: number;
  notes: string;
};

export type AiApprovalRecommendation = {
  decision: AiApprovalDecision;
  confidence: number;
  model: string;
  promptVersion: string;
  reviewedAt: string;
  reason: string;
  signals: string[];
};

export type ClarificationRequest = {
  sentFrom: string;
  subject: string;
  preview: string;
};

export type ParsedReply = {
  receivedAt: string;
  summary: string;
  extracted: string[];
  aiDecision: "approve" | "manual";
  reason: string;
};

export type EventApprovalApplication = {
  id: string;
  eventId: string;
  lumaId: string;
  founderId: string;
  name: string;
  email: string;
  phone: string;
  companyName: string;
  companyLine: string;
  photoUrl?: string;
  submittedAt: string;
  status: ApprovalStatus;
  matchConfidence: number;
  relation: string;
  recommendation: string;
  rule: string;
  lumaStatus: string;
  primaryAction: ApprovalAction;
  selectedDefault: boolean;
  lumaPayload: LumaApplicationPayload;
  sourceComparisons: ApplicantSourceComparison[];
  aiRecommendation: AiApprovalRecommendation;
  evidence: ApprovalEvidence[];
  audit: string[];
  clarificationRequest?: ClarificationRequest;
  parsedReply?: ParsedReply;
};

export type EventApprovalsData = {
  events: LoadedLumaEvent[];
  applications: EventApprovalApplication[];
};
