import posthog from "posthog-js";

export type AnalyticsPrimitive = string | number | boolean | null;
export type AnalyticsProperties = Record<string, AnalyticsPrimitive | undefined>;

export type CountBucket = "0" | "1" | "2-5" | "6-10" | "11-25" | "26-100" | "100+";
export type LengthBucket = "0" | "1-10" | "11-40" | "41-120" | "120+";
export type ConfidenceBucket = "0-39" | "40-69" | "70-89" | "90-100";
export type AgentAccessLane = "url" | "cowork" | "setup";

export type AnalyticsEventProperties = {
  "event prep viewed": {
    attendee_count: number;
    event_id: string;
    founder_count: number;
    page_size: number;
    source: string;
  };
  "founder filter changed": {
    event_id: string;
    lens: string;
    result_count: number;
  };
  "founder search submitted": {
    event_id: string;
    query_length_bucket: LengthBucket;
    result_count: number;
  };
  "founder page changed": {
    event_id: string;
    page: number;
    page_size: number;
    result_count: number;
    total_pages: number;
  };
  "founder selected": FounderSelectionProperties;
  "founder filters cleared": {
    event_id: string;
    previous_lens: string;
    query_length_bucket: LengthBucket;
  };
  "founder event changed": {
    event_id: string;
    founder_count: number;
    previous_event_id: string;
  };
  "intro viewed": IntroProperties;
  "intro context expanded": IntroProperties;
  "note added": {
    event_id: string;
    founder_batch: string;
    founder_category: string;
    note_length_bucket: LengthBucket;
    note_type: "local";
    visible_note_count: number;
  };
  "approvals viewed": {
    application_count: number;
    event_count: number;
    page_size: number;
  };
  "approval event changed": {
    application_count: number;
    event_count: number;
    event_id: string;
  };
  "approval queue changed": {
    event_id: string;
    queue: string;
    result_count: number;
  };
  "approval segment changed": {
    event_id: string;
    result_count: number;
    segment: string;
  };
  "approval search submitted": {
    event_id: string;
    query_length_bucket: LengthBucket;
    result_count: number;
  };
  "approval page changed": {
    event_id: string;
    page: number;
    page_size: number;
    result_count: number;
    total_pages: number;
  };
  "application selected": ApprovalApplicationProperties;
  "application selection toggled": ApprovalApplicationProperties & {
    selected: boolean;
  };
  "bulk applications selected": {
    count_bucket: CountBucket;
    event_id: string;
    scope: "page" | "results";
  };
  "bulk selection cleared": {
    count_bucket: CountBucket;
    event_id: string;
  };
  "bulk approval action clicked": {
    action: "approve" | "send_info" | "reject";
    eligible_count_bucket: CountBucket;
    event_id: string;
    selected_count_bucket: CountBucket;
  };
  "application action clicked": ApprovalApplicationProperties & {
    action: "approve" | "send_info" | "reject";
  };
  "approval dossier opened": ApprovalApplicationProperties;
  "approval dossier closed": ApprovalApplicationProperties;
  "aleix page viewed": {
    section_count: number;
  };
  "aleix link clicked": {
    link_label: string;
    link_type: "social" | "resume" | "project" | "reference" | "demo" | "video";
  };
  "agent access opened": {
    default_lane: AgentAccessLane;
    entrypoint: "main_nav" | "unlock_page";
  };
  "agent access lane selected": {
    lane: AgentAccessLane;
  };
  "agent handoff copied": {
    content_type: "agent_prompt" | "external_checklist" | "mcp_config";
    lane: AgentAccessLane;
    result: "copied" | "manual_fallback";
  };
  "agent session created": {
    action_count: number;
    lane: AgentAccessLane;
    result: "created" | "locked" | "error";
    tool_count: number;
  };
  "agent access closed": {
    close_method: "button" | "backdrop" | "escape";
    lane: AgentAccessLane;
  };
};

export type AnalyticsEventName = keyof AnalyticsEventProperties;

type FounderSelectionProperties = {
  caution_count: number;
  event_id: string;
  founder_batch: string;
  founder_category: string;
  founder_stage: string;
  has_caution: boolean;
  has_intro: boolean;
  intro_count: number;
};

type IntroProperties = {
  event_id: string;
  fit_label: string;
  founder_category: string;
  has_caution: boolean;
  same_company: boolean;
  target_category: string;
};

type ApprovalApplicationProperties = {
  ai_decision: string;
  confidence_bucket: ConfidenceBucket;
  event_id: string;
  relation_type: string;
  segment: string;
  status: string;
};

const FORBIDDEN_PROPERTY_PATTERNS = [
  /body/i,
  /authorization/i,
  /email/i,
  /evidence/i,
  /founder_id/i,
  /luma_payload/i,
  /name/i,
  /note_(body|content|text)/i,
  /opener/i,
  /phone/i,
  /raw/i,
  /reason/i,
  /secret/i,
  /text/i,
  /token/i
];

const PLACEHOLDER_POSTHOG_PROJECT_TOKENS = new Set(["ph_test"]);

export function captureAnalyticsEvent<EventName extends AnalyticsEventName>(
  event: EventName,
  properties: AnalyticsEventProperties[EventName]
) {
  if (!isAnalyticsEnabled()) return;

  posthog.capture(event, sanitizeAnalyticsProperties(properties));
}

export function sanitizeAnalyticsProperties(properties: AnalyticsProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      if (value === undefined) return false;
      return !FORBIDDEN_PROPERTY_PATTERNS.some((pattern) => pattern.test(key));
    })
  ) as Record<string, AnalyticsPrimitive>;
}

export function isAnalyticsEnabled() {
  return (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "true" &&
    isPostHogProjectTokenConfigured(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)
  );
}

export function isPostHogProjectTokenConfigured(token: string | undefined) {
  const normalizedToken = token?.trim();
  if (!normalizedToken) return false;
  return !PLACEHOLDER_POSTHOG_PROJECT_TOKENS.has(normalizedToken);
}

export function countBucket(count: number): CountBucket {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2-5";
  if (count <= 10) return "6-10";
  if (count <= 25) return "11-25";
  if (count <= 100) return "26-100";
  return "100+";
}

export function textLengthBucket(value: string): LengthBucket {
  const length = value.trim().length;
  if (length <= 0) return "0";
  if (length <= 10) return "1-10";
  if (length <= 40) return "11-40";
  if (length <= 120) return "41-120";
  return "120+";
}

export function confidenceBucket(confidence: number): ConfidenceBucket {
  if (confidence < 40) return "0-39";
  if (confidence < 70) return "40-69";
  if (confidence < 90) return "70-89";
  return "90-100";
}
