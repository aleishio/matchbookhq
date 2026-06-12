import { Resend } from "resend";

import { createSupabaseServiceClientFromEnv } from "../supabase/service-client";

export type ResendWebhookVerificationInput = {
  rawBody: string;
  secret: string;
  headers: Headers;
  apiKey?: string;
};

export type ResendReceivedEmail = {
  id: string;
  to?: string[] | null;
  from?: string | null;
  created_at?: string | null;
  subject?: string | null;
  bcc?: string[] | null;
  cc?: string[] | null;
  reply_to?: string[] | null;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string> | null;
  message_id?: string | null;
  attachments?: unknown[] | null;
};

export type ResendReceivingClient = {
  getReceivedEmail(emailId: string): Promise<ResendReceivedEmail>;
};

export type ResendApprovalReplyTarget = {
  applicationId: string;
  clarificationEmailJobId?: string;
};

export type ResendWebhookStore = {
  recordProviderWebhookEvent(input: {
    eventType: string;
    providerEventId: string;
    payload: Record<string, unknown>;
  }): Promise<{ inserted: boolean }>;
  findApprovalReplyTarget(input: {
    fromEmail: string;
    receivedEmailId: string;
    messageId?: string;
    toEmails: string[];
    subject?: string;
  }): Promise<ResendApprovalReplyTarget | null>;
  recordApplicantReply(input: {
    applicationId: string;
    clarificationEmailJobId?: string;
    providerMessageId: string;
    fromEmail: string;
    receivedAt: string;
    subject?: string;
    bodyText?: string;
    parsedFields: Record<string, unknown>;
    status: "pending_review" | "auto_ready" | "manual" | "ignored";
  }): Promise<{ inserted: boolean; replyId?: string }>;
  markProviderWebhookEventProcessed(input: {
    providerEventId: string;
    processingError?: string;
  }): Promise<void>;
};

export type ResendWebhookResult = {
  verified: true;
  eventType: string;
  providerEventId: string;
  inserted: boolean;
  processed: boolean;
  receivedEmailId?: string;
  applicationId?: string;
  clarificationEmailJobId?: string;
  replyId?: string;
  reason?: string;
};

type ResendWebhookPayload = {
  type?: unknown;
  created_at?: unknown;
  data?: unknown;
  [key: string]: unknown;
};

const WEBHOOK_VERIFY_API_KEY = "re_webhook_verify";
const APPROVAL_REPLY_PROMPT_VERSION = "approval-reply-v1";

export class ResendWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResendWebhookSignatureError";
  }
}

export class ResendWebhookProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResendWebhookProcessingError";
  }
}

export async function handleResendWebhook({
  rawBody,
  headers,
  secret,
  store,
  receivingClient,
  apiKey
}: {
  rawBody: string;
  headers: Headers;
  secret: string;
  store: ResendWebhookStore;
  receivingClient?: ResendReceivingClient;
  apiKey?: string;
}): Promise<ResendWebhookResult> {
  const payload = verifyResendWebhookSignature({ rawBody, headers, secret, apiKey });
  const eventType = stringField(payload.type) ?? "unknown";
  const providerEventId = headerValue(headers, "svix-id") ?? stringField(payload.id);
  if (!providerEventId) {
    throw new ResendWebhookSignatureError("Missing Resend webhook id.");
  }

  const stored = await store.recordProviderWebhookEvent({
    eventType,
    providerEventId,
    payload
  });

  if (eventType !== "email.received") {
    await store.markProviderWebhookEventProcessed({ providerEventId });
    return {
      verified: true,
      eventType,
      providerEventId,
      inserted: stored.inserted,
      processed: false,
      reason: "stored_non_reply_event"
    };
  }

  if (!receivingClient) {
    await store.markProviderWebhookEventProcessed({
      providerEventId,
      processingError: "RESEND_API_KEY is required to fetch received email content."
    });
    throw new ResendWebhookProcessingError("RESEND_API_KEY is required to fetch received email content.");
  }

  const metadata = extractReceivedEmailMetadata(payload);
  if (!metadata.receivedEmailId) {
    await store.markProviderWebhookEventProcessed({
      providerEventId,
      processingError: "Resend email.received webhook did not include data.email_id."
    });
    throw new ResendWebhookProcessingError("Resend email.received webhook did not include data.email_id.");
  }

  const email = await receivingClient.getReceivedEmail(metadata.receivedEmailId);
  const normalized = normalizeReceivedEmail(payload, email);
  const target = await store.findApprovalReplyTarget({
    fromEmail: normalized.fromEmail,
    receivedEmailId: normalized.receivedEmailId,
    messageId: normalized.messageId,
    toEmails: normalized.toEmails,
    subject: normalized.subject
  });

  if (!target) {
    await store.markProviderWebhookEventProcessed({
      providerEventId,
      processingError: "No approval application matched the inbound reply."
    });
    return {
      verified: true,
      eventType,
      providerEventId,
      inserted: stored.inserted,
      processed: true,
      receivedEmailId: normalized.receivedEmailId,
      reason: "unlinked_reply"
    };
  }

  const parsedFields = parseApprovalReplyFields({
    bodyText: normalized.bodyText,
    subject: normalized.subject,
    fromEmail: normalized.fromEmail,
    toEmails: normalized.toEmails,
    messageId: normalized.messageId,
    attachments: normalized.attachments,
    headers: normalized.headers
  });
  const reply = await store.recordApplicantReply({
    applicationId: target.applicationId,
    clarificationEmailJobId: target.clarificationEmailJobId,
    providerMessageId: normalized.receivedEmailId,
    fromEmail: normalized.fromEmail,
    receivedAt: normalized.receivedAt,
    subject: normalized.subject,
    bodyText: normalized.bodyText,
    parsedFields,
    status: replyStatusForParsedFields(parsedFields)
  });

  await store.markProviderWebhookEventProcessed({ providerEventId });

  return {
    verified: true,
    eventType,
    providerEventId,
    inserted: stored.inserted,
    processed: true,
    receivedEmailId: normalized.receivedEmailId,
    applicationId: target.applicationId,
    clarificationEmailJobId: target.clarificationEmailJobId,
    replyId: reply.replyId
  };
}

export function verifyResendWebhookSignature({
  rawBody,
  secret,
  headers,
  apiKey
}: ResendWebhookVerificationInput): Record<string, unknown> {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) throw new ResendWebhookSignatureError("Resend webhook secret is required.");

  try {
    const resend = new Resend(apiKey?.trim() || WEBHOOK_VERIFY_API_KEY);
    const verified = resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id: requiredHeader(headers, "svix-id"),
        timestamp: requiredHeader(headers, "svix-timestamp"),
        signature: requiredHeader(headers, "svix-signature")
      },
      webhookSecret: normalizedSecret
    });

    if (!isRecord(verified)) {
      throw new ResendWebhookSignatureError("Resend webhook payload must be a JSON object.");
    }

    return verified;
  } catch (error) {
    if (error instanceof ResendWebhookSignatureError) throw error;
    throw new ResendWebhookSignatureError("Invalid Resend webhook signature.");
  }
}

export function createResendReceivingClientFromEnv(env: NodeJS.ProcessEnv = process.env): ResendReceivingClient {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new ResendWebhookProcessingError("RESEND_API_KEY is required to fetch received email content.");
  }

  const resend = new Resend(apiKey);
  return {
    async getReceivedEmail(emailId) {
      const response = await resend.emails.receiving.get(emailId);
      if (response.error || !response.data) {
        throw new ResendWebhookProcessingError(
          `Unable to fetch received email content from Resend for ${emailId}.`
        );
      }
      return response.data;
    }
  };
}

export function createSupabaseResendWebhookStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ResendWebhookStore {
  const client = createSupabaseServiceClientFromEnv(env);

  return {
    async recordProviderWebhookEvent(input) {
      const rows = await client.upsert<Array<Record<string, unknown>>[number]>("provider_webhook_events", [{
        provider: "resend",
        event_type: input.eventType,
        provider_event_id: input.providerEventId,
        payload: input.payload
      }], {
        onConflict: "provider,provider_event_id",
        ignoreDuplicates: true,
        returning: "representation",
        select: "id"
      });

      return { inserted: rows.length > 0 };
    },

    async findApprovalReplyTarget(input) {
      const fromEmail = normalizeEmailAddress(input.fromEmail);
      if (!fromEmail) return null;

      const jobs = await client.select<Array<Record<string, unknown>>[number]>("clarification_email_jobs", {
        select: "id,application_id",
        extraParams: { to_email: `ilike.${fromEmail}` },
        order: "created_at.desc",
        limit: 1
      });
      const job = jobs[0];
      if (job) {
        return {
          applicationId: String(job.application_id),
          clarificationEmailJobId: String(job.id)
        };
      }

      const applications = await client.select<Array<Record<string, unknown>>[number]>("luma_event_applications", {
        select: "id",
        extraParams: { applicant_email: `ilike.${fromEmail}` },
        order: "updated_at.desc",
        limit: 1
      });
      const application = applications[0];
      return application ? { applicationId: String(application.id) } : null;
    },

    async recordApplicantReply(input) {
      const existing = await client.select<Array<Record<string, unknown>>[number]>("applicant_replies", {
        select: "id",
        filters: [{ column: "provider_message_id", value: input.providerMessageId }],
        limit: 1
      });
      if (existing[0]) {
        return { inserted: false, replyId: String(existing[0].id) };
      }

      const rows = await client.insert<Array<Record<string, unknown>>[number]>("applicant_replies", [{
        application_id: input.applicationId,
        clarification_email_job_id: input.clarificationEmailJobId ?? null,
        provider_message_id: input.providerMessageId,
        from_email: input.fromEmail,
        received_at: input.receivedAt,
        subject: input.subject ?? null,
        body_text: input.bodyText ?? null,
        parsed_fields: input.parsedFields,
        status: input.status
      }], {
        returning: "representation",
        select: "id"
      });

      return { inserted: rows.length > 0, replyId: stringField(rows[0]?.id) };
    },

    async markProviderWebhookEventProcessed(input) {
      await client.update("provider_webhook_events", {
        processed_at: new Date().toISOString(),
        processing_error: input.processingError ?? null
      }, {
        filters: [
          { column: "provider", value: "resend" },
          { column: "provider_event_id", value: input.providerEventId }
        ],
        returning: "minimal"
      });
    }
  };
}

function extractReceivedEmailMetadata(payload: ResendWebhookPayload) {
  const data = objectField(payload.data);
  return {
    receivedEmailId: stringField(data.email_id)
  };
}

function normalizeReceivedEmail(payload: ResendWebhookPayload, email: ResendReceivedEmail) {
  const data = objectField(payload.data);
  const receivedEmailId = stringField(email.id) ?? stringField(data.email_id);
  const fromEmail = normalizeEmailAddress(stringField(email.from) ?? stringField(data.from));
  if (!receivedEmailId) throw new ResendWebhookProcessingError("Received email response did not include an id.");
  if (!fromEmail) throw new ResendWebhookProcessingError("Received email response did not include a sender.");

  const html = stringField(email.html);
  const bodyText = stringField(email.text) ?? (html ? htmlToText(html) : undefined);
  const subject = stringField(email.subject) ?? stringField(data.subject);
  const messageId = stringField(email.message_id) ?? stringField(data.message_id);

  return {
    receivedEmailId,
    fromEmail,
    toEmails: stringArray(email.to).length > 0 ? stringArray(email.to) : stringArray(data.to),
    receivedAt:
      stringField(email.created_at) ??
      stringField(data.created_at) ??
      stringField(payload.created_at) ??
      new Date().toISOString(),
    subject,
    bodyText,
    messageId,
    attachments: arrayField(email.attachments).length > 0 ? arrayField(email.attachments) : arrayField(data.attachments),
    headers: objectField(email.headers),
    cc: stringArray(email.cc).length > 0 ? stringArray(email.cc) : stringArray(data.cc),
    bcc: stringArray(email.bcc).length > 0 ? stringArray(email.bcc) : stringArray(data.bcc),
    replyTo: stringArray(email.reply_to)
  };
}

function parseApprovalReplyFields(input: {
  bodyText?: string;
  subject?: string;
  fromEmail: string;
  toEmails: string[];
  messageId?: string;
  attachments: Array<Record<string, unknown>>;
  headers: Record<string, unknown>;
}) {
  const body = stripQuotedReplyText(normalizeBody(input.bodyText));
  const company = labeledValue(body, ["yc company", "company", "startup"]);
  const batch = labeledValue(body, ["yc batch", "batch"]) ?? body.match(/\b[WSF]\d{2}\b/i)?.[0]?.toUpperCase();
  const ycEmail = labeledValue(body, ["yc email", "yc-connected email", "work email", "email"]) ?? firstEmail(body);
  const role = normalizeRole(labeledValue(body, ["role", "title"]) ?? body);
  const relationship = labeledValue(body, ["relationship", "yc relationship", "context"]) ?? role;
  const summary = summarizeReply(body, input.subject);
  const missing = [
    company ? "" : "company",
    batch ? "" : "batch",
    ycEmail ? "" : "yc_email",
    role ? "" : "role"
  ].filter(Boolean);
  const recommendedQueue = missing.length === 0 && role === "founder" ? "ready" : "manual";

  return {
    prompt_version: APPROVAL_REPLY_PROMPT_VERSION,
    summary,
    company,
    batch,
    yc_email: ycEmail,
    role,
    relationship,
    missing,
    recommended_queue: recommendedQueue,
    reason: recommendedQueue === "ready"
      ? "Reply includes company, batch, founder role, and a YC-connected email candidate."
      : "Reply is stored but still needs manual review before any Lu.ma writeback.",
    resend: {
      from_email: input.fromEmail,
      to_emails: input.toEmails,
      message_id: input.messageId,
      has_body_text: Boolean(body),
      attachment_count: input.attachments.length,
      header_keys: Object.keys(input.headers)
    }
  };
}

function stripQuotedReplyText(body: string) {
  if (!body) return "";
  const kept: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (/^>/.test(trimmed)) break;
    if (/^--\s*$/.test(trimmed)) break;
    if (/^on .+wrote:$/i.test(trimmed)) break;
    if (/^el .+escribi[oó]:$/i.test(trimmed)) break;
    if (/^from:\s/i.test(trimmed)) break;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

function replyStatusForParsedFields(parsedFields: Record<string, unknown>) {
  return parsedFields.recommended_queue === "ready" ? "auto_ready" : "manual";
}

function labeledValue(body: string, labels: string[]) {
  if (!body) return undefined;
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*([^:=-]{2,40})\s*[:=-]\s*(.+?)\s*$/);
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    if (normalizedLabels.includes(label)) return cleanField(match[2]);
  }
  return undefined;
}

function normalizeRole(value?: string) {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (/\bco[-\s]?founder\b/.test(lower)) return "founder";
  if (/\bfounder\b/.test(lower)) return "founder";
  if (/\bfounding team\b/.test(lower)) return "founder";
  if (/\binvestor|angel|vc\b/.test(lower)) return "investor";
  if (/\bemployee|engineer|operator|staff\b/.test(lower)) return "employee";
  if (/\bguest|friend|network\b/.test(lower)) return "guest";
  return undefined;
}

function firstEmail(value: string) {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
}

function summarizeReply(body: string, subject?: string) {
  if (!body) return subject?.trim() || "Applicant reply received.";
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeBody(value?: string) {
  return value?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() ?? "";
}

function cleanField(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function normalizeEmailAddress(value?: string) {
  const email = value?.match(/<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/)?.[1] ?? firstEmail(value ?? "");
  return email?.toLowerCase();
}

function requiredHeader(headers: Headers, name: string) {
  const value = headerValue(headers, name);
  if (!value) throw new ResendWebhookSignatureError(`Missing Resend ${name} header.`);
  return value;
}

function headerValue(headers: Headers, name: string) {
  return headers.get(name)?.trim() || undefined;
}

function objectField(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayField(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => stringField(item) ? [stringField(item) as string] : [])
    : [];
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
