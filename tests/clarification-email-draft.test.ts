import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/events/[eventId]/approvals/email-draft/route.ts";
import { generateClarificationEmailDraft } from "../app/lib/clarification-email-draft.ts";
import { MAX_CLARIFICATION_EMAIL_NOTES_LENGTH } from "../app/lib/event-approvals-types.ts";

test("email draft route returns a local draft when OpenAI is not configured", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const response = await POST(
      new Request("http://localhost/api/events/yc-founder-mixer/approvals/email-draft", {
        method: "POST",
        body: JSON.stringify({
          notes: "Ask Aleix to confirm LinkedIn, YC batch, and mapped YC email.",
          applicationIds: ["yc-founder-mixer-application-121"]
        })
      }),
      { params: Promise.resolve({ eventId: "yc-founder-mixer" }) }
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.source, "fallback");
    assert.equal(payload.subject, "Confirming your YC event details");
    assert.match(payload.body, /Ask Aleix to confirm LinkedIn/);
    assert.match(payload.body, /YC Founder Mixer/);
  } finally {
    restoreEnv("OPENAI_API_KEY", originalKey);
  }
});

test("email draft route rejects overlong operator notes", async () => {
  const response = await POST(
    new Request("http://localhost/api/events/yc-founder-mixer/approvals/email-draft", {
      method: "POST",
      body: JSON.stringify({
        notes: "x".repeat(MAX_CLARIFICATION_EMAIL_NOTES_LENGTH + 1)
      })
    }),
    { params: Promise.resolve({ eventId: "yc-founder-mixer" }) }
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "invalid_clarification_email_notes");
});

test("email draft generator calls OpenAI Responses with structured output", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_EMAIL_DRAFT_MODEL;
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};

  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_EMAIL_DRAFT_MODEL = "gpt-test-email";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                subject: "Confirming your event application",
                body: "Could you reply with your YC company, batch, and mapped YC email?"
              })
            }
          ]
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const draft = await generateClarificationEmailDraft({
      notes: "Ask for mapped YC email.",
      eventTitle: "YC Founder Mixer",
      recipientCount: 2
    });

    assert.equal(draft.source, "ai");
    assert.equal(draft.model, "gpt-test-email");
    assert.equal(draft.subject, "Confirming your event application");
    assert.equal(requestBody.model, "gpt-test-email");
    assert.equal(requestBody.store, false);
    assert.deepEqual(
      (((requestBody.text as Record<string, unknown>).format as Record<string, unknown>).type),
      "json_schema"
    );
  } finally {
    restoreEnv("OPENAI_API_KEY", originalKey);
    restoreEnv("OPENAI_EMAIL_DRAFT_MODEL", originalModel);
    globalThis.fetch = originalFetch;
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
