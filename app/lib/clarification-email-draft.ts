import {
  DEFAULT_CLARIFICATION_EMAIL_SUBJECT,
  MAX_CLARIFICATION_EMAIL_BODY_LENGTH,
  MAX_CLARIFICATION_EMAIL_NOTES_LENGTH,
  MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH
} from "./event-approvals-types";
import { EventApprovalsRepositoryError } from "./event-approvals-repository";

export type ClarificationEmailDraftSource = "ai" | "fallback";

export type ClarificationEmailDraft = {
  subject: string;
  body: string;
  source: ClarificationEmailDraftSource;
  model?: string;
};

export type ClarificationEmailDraftRequest = {
  notes: string;
  eventTitle?: string;
  recipientCount?: number;
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_EMAIL_DRAFT_MODEL = "gpt-4o-mini";
const OPENAI_EMAIL_DRAFT_TIMEOUT_MS = 15_000;

const CLARIFICATION_EMAIL_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      minLength: 1,
      maxLength: MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH
    },
    body: {
      type: "string",
      minLength: 1,
      maxLength: MAX_CLARIFICATION_EMAIL_BODY_LENGTH
    }
  },
  required: ["subject", "body"],
  additionalProperties: false
} as const;

export async function generateClarificationEmailDraft(
  request: ClarificationEmailDraftRequest
): Promise<ClarificationEmailDraft> {
  const notes = normalizeNotes(request.notes);
  if (!notes) {
    throw new EventApprovalsRepositoryError(
      "invalid_clarification_email_notes",
      "Clarification email notes are required."
    );
  }

  if (notes.length > MAX_CLARIFICATION_EMAIL_NOTES_LENGTH) {
    throw new EventApprovalsRepositoryError(
      "invalid_clarification_email_notes",
      `Clarification email notes must be ${MAX_CLARIFICATION_EMAIL_NOTES_LENGTH} characters or fewer.`
    );
  }

  const fallbackDraft = fallbackClarificationEmailDraft({
    ...request,
    notes
  });
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fallbackDraft;

  const model = process.env.OPENAI_EMAIL_DRAFT_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_OPENAI_EMAIL_DRAFT_MODEL;

  try {
    return {
      ...(await draftWithOpenAI({ ...request, notes }, apiKey, model)),
      source: "ai",
      model
    };
  } catch {
    return fallbackDraft;
  }
}

function fallbackClarificationEmailDraft(
  request: Required<Pick<ClarificationEmailDraftRequest, "notes">> & Omit<ClarificationEmailDraftRequest, "notes">
): ClarificationEmailDraft {
  const eventCopy = request.eventTitle ? ` for ${request.eventTitle}` : "";
  const notes = ensureTrailingPeriod(request.notes);
  const body = normalizeGeneratedBody([
    `Hi, thanks for applying${eventCopy}.`,
    `We need one more detail before reviewing your application: ${notes}`,
    "Please also include your YC company, batch, role, and the best email connected to your YC account if that is relevant.",
    "Thanks,"
  ].join("\n\n"));

  return {
    subject: DEFAULT_CLARIFICATION_EMAIL_SUBJECT,
    body,
    source: "fallback"
  };
}

async function draftWithOpenAI(
  request: Required<Pick<ClarificationEmailDraftRequest, "notes">> & Omit<ClarificationEmailDraftRequest, "notes">,
  apiKey: string,
  model: string
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_EMAIL_DRAFT_TIMEOUT_MS);
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  };
  const organization = process.env.OPENAI_ORG_ID?.trim();
  const project = process.env.OPENAI_PROJECT_ID?.trim();
  if (organization) headers["openai-organization"] = organization;
  if (project) headers["openai-project"] = project;

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: "system",
            content: [
              "You draft concise operational clarification emails for YC event approvals.",
              "Ask only for information needed to verify YC identity or review context.",
              "Do not promise approval. Do not mention internal tooling, rules, AI, or confidence.",
              "Use plain text, a direct human tone, and no markdown."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              `Event: ${request.eventTitle ?? "YC event"}`,
              `Recipients: ${Math.max(1, request.recipientCount ?? 1)}`,
              "Operator notes:",
              request.notes,
              "",
              "Draft a subject and message body. The body should be ready to send as-is."
            ].join("\n")
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "clarification_email_draft",
            schema: CLARIFICATION_EMAIL_DRAFT_SCHEMA,
            strict: true
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI draft request failed with ${response.status}.`);
    }

    const payload = await response.json();
    return parseOpenAIEmailDraft(payload);
  } finally {
    clearTimeout(timeout);
  }
}

function parseOpenAIEmailDraft(payload: unknown) {
  const outputText = responseOutputText(payload);
  if (!outputText) throw new Error("OpenAI draft response did not include text output.");

  const parsed = JSON.parse(outputText) as unknown;
  if (!isRecord(parsed)) throw new Error("OpenAI draft response was not an object.");

  const subject = normalizeGeneratedSubject(parsed.subject);
  const body = normalizeGeneratedBody(parsed.body);
  if (!subject || !body) throw new Error("OpenAI draft response was incomplete.");
  if (subject.length > MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH) {
    throw new Error("OpenAI draft subject exceeded the limit.");
  }
  if (body.length > MAX_CLARIFICATION_EMAIL_BODY_LENGTH) {
    throw new Error("OpenAI draft body exceeded the limit.");
  }

  return { subject, body };
}

function responseOutputText(payload: unknown) {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";

  for (const outputItem of payload.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) continue;
    for (const contentItem of outputItem.content) {
      if (!isRecord(contentItem)) continue;
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        return contentItem.text;
      }
    }
  }

  return "";
}

function normalizeNotes(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeGeneratedSubject(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeGeneratedBody(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureTrailingPeriod(value: string) {
  if (/[.!?]$/.test(value)) return value;
  return `${value}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
