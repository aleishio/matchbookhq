import assert from "node:assert/strict";
import test from "node:test";

import {
  createResendEmailConfig,
  EmailConfigurationError,
  EmailDeliveryError,
  EmailValidationError,
  sendEmail,
  type ResendEmailTransport,
} from "../lib/email/resend.ts";

function emailEnv(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    RESEND_API_KEY: "re_test_key",
    RESEND_SENDING_DOMAIN: "events.matchbookhq.com",
    RESEND_FROM_EMAIL: "yc@events.matchbookhq.com",
    RESEND_FROM_NAME: "YC OS",
    RESEND_REPLY_TO_EMAIL: "yc@matchbookhq.com",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

test("builds Resend config from a verified subdomain sender", () => {
  const config = createResendEmailConfig(emailEnv());

  assert.equal(config.from, "YC OS <yc@events.matchbookhq.com>");
  assert.equal(config.fromEmail, "yc@events.matchbookhq.com");
  assert.equal(config.replyTo, "yc@matchbookhq.com");
  assert.equal(config.sendingDomain, "events.matchbookhq.com");
});

test("rejects root domains because email must send from a subdomain", () => {
  assert.throws(
    () =>
      createResendEmailConfig(
        emailEnv({
          RESEND_SENDING_DOMAIN: "example.com",
          RESEND_FROM_EMAIL: "hello@example.com",
        }),
      ),
    EmailConfigurationError,
  );
});

test("rejects sender addresses outside the configured Resend subdomain", () => {
  assert.throws(
    () =>
      createResendEmailConfig(
        emailEnv({
          RESEND_FROM_EMAIL: "hello@example.com",
        }),
      ),
    EmailConfigurationError,
  );
});

test("sends validated email payloads through the injected Resend transport", async () => {
  const calls: Array<{
    payload: Parameters<ResendEmailTransport["send"]>[0];
    options: Parameters<ResendEmailTransport["send"]>[1];
  }> = [];
  const transport: ResendEmailTransport = {
    async send(payload, options) {
      calls.push({ payload, options });
      return {
        data: { id: "email_123" },
        error: null,
        headers: null,
      };
    },
  };

  const result = await sendEmail(
    {
      to: [" FOUNDER@example.com "],
      cc: "team@example.com",
      subject: " Intro draft ",
      html: " <strong>Hello</strong> ",
      text: " Hello ",
      replyTo: "ops@example.com",
      tags: [{ name: "workflow", value: "event-prep" }],
      idempotencyKey: "intro-founder-123",
    },
    {
      env: emailEnv(),
      transport,
    },
  );

  assert.deepEqual(result, {
    provider: "resend",
    id: "email_123",
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, {
    from: "YC OS <yc@events.matchbookhq.com>",
    to: ["founder@example.com"],
    subject: "Intro draft",
    html: "<strong>Hello</strong>",
    text: "Hello",
    cc: ["team@example.com"],
    replyTo: ["ops@example.com"],
    tags: [{ name: "workflow", value: "event-prep" }],
  });
  assert.deepEqual(calls[0].options, {
    idempotencyKey: "intro-founder-123",
  });
});

test("uses the configured root-domain mailbox as the default reply-to", async () => {
  const calls: Array<Parameters<ResendEmailTransport["send"]>[0]> = [];
  const transport: ResendEmailTransport = {
    async send(payload) {
      calls.push(payload);
      return {
        data: { id: "email_123" },
        error: null,
        headers: null,
      };
    },
  };

  await sendEmail(
    {
      to: "founder@example.com",
      subject: "Default reply-to",
      text: "Hello",
    },
    {
      env: emailEnv(),
      transport,
    },
  );

  assert.deepEqual(calls[0].replyTo, ["yc@matchbookhq.com"]);
});

test("requires at least one email body", async () => {
  await assert.rejects(
    () =>
      sendEmail(
        {
          to: "founder@example.com",
          subject: "Missing body",
        },
        {
          env: emailEnv(),
          transport: unreachableTransport(),
        },
      ),
    EmailValidationError,
  );
});

test("rejects more than Resend's per-email recipient limit", async () => {
  await assert.rejects(
    () =>
      sendEmail(
        {
          to: Array.from({ length: 51 }, (_, index) => `person${index}@example.com`),
          subject: "Too many recipients",
          text: "Hello",
        },
        {
          env: emailEnv(),
          transport: unreachableTransport(),
        },
      ),
    EmailValidationError,
  );
});

test("surfaces Resend API failures without exposing configuration secrets", async () => {
  const transport: ResendEmailTransport = {
    async send() {
      return {
        data: null,
        error: {
          message: "Invalid from address",
          name: "invalid_from_address",
          statusCode: 422,
        },
        headers: null,
      };
    },
  };

  await assert.rejects(
    () =>
      sendEmail(
        {
          to: "founder@example.com",
          subject: "Provider failure",
          text: "Hello",
        },
        {
          env: emailEnv(),
          transport,
        },
      ),
    (error) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.providerCode, "invalid_from_address");
      assert.equal(error.providerStatusCode, 422);
      assert.equal(error.message.includes("re_test_key"), false);
      return true;
    },
  );
});

function unreachableTransport(): ResendEmailTransport {
  return {
    async send() {
      throw new Error("transport should not be called");
    },
  };
}
