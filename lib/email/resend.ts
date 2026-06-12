import { Resend } from "resend";
import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse,
} from "resend";

const MAX_RESEND_RECIPIENTS = 50;
const EMAIL_ADDRESS_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DOMAIN_PATTERN =
  /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z][a-z0-9-]{1,62}$/;

export interface ResendEmailConfig {
  apiKey: string;
  from: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  sendingDomain: string;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  tags?: Array<{ name: string; value: string }>;
  idempotencyKey?: string;
}

export interface SendEmailResult {
  provider: "resend";
  id: string;
}

export interface ResendEmailTransport {
  send(
    payload: CreateEmailOptions,
    options?: CreateEmailRequestOptions,
  ): Promise<CreateEmailResponse>;
}

export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

export class EmailValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailValidationError";
  }
}

export class EmailDeliveryError extends Error {
  readonly providerCode?: string;
  readonly providerStatusCode?: number | null;

  constructor({
    message,
    providerCode,
    providerStatusCode,
  }: {
    message: string;
    providerCode?: string;
    providerStatusCode?: number | null;
  }) {
    super(message);
    this.name = "EmailDeliveryError";
    this.providerCode = providerCode;
    this.providerStatusCode = providerStatusCode;
  }
}

let cachedTransport:
  | { apiKey: string; transport: ResendEmailTransport }
  | null = null;

export function createResendEmailConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResendEmailConfig {
  assertServerRuntime();

  const apiKey = readRequiredEnv(env, "RESEND_API_KEY");
  const fromEmail = normalizeEmailAddress(
    readRequiredEnv(env, "RESEND_FROM_EMAIL"),
    "RESEND_FROM_EMAIL",
  );
  const fromName = normalizeHeaderValue(
    env.RESEND_FROM_NAME?.trim() || "YC OS",
    "RESEND_FROM_NAME",
  );
  const sendingDomain = normalizeDomain(
    readRequiredEnv(env, "RESEND_SENDING_DOMAIN"),
    "RESEND_SENDING_DOMAIN",
  );
  const replyTo = env.RESEND_REPLY_TO_EMAIL?.trim()
    ? normalizeEmailAddress(env.RESEND_REPLY_TO_EMAIL, "RESEND_REPLY_TO_EMAIL")
    : undefined;
  const fromDomain = getEmailDomain(fromEmail);

  if (!isSubdomain(sendingDomain)) {
    throw new EmailConfigurationError(
      "RESEND_SENDING_DOMAIN must be a verified subdomain, for example events.matchbookhq.com.",
    );
  }

  if (fromDomain !== sendingDomain) {
    throw new EmailConfigurationError(
      "RESEND_FROM_EMAIL must use RESEND_SENDING_DOMAIN exactly.",
    );
  }

  return {
    apiKey,
    from: formatFromAddress(fromName, fromEmail),
    fromEmail,
    fromName,
    replyTo,
    sendingDomain,
  };
}

export async function sendEmail(
  input: SendEmailInput,
  options: {
    env?: NodeJS.ProcessEnv;
    transport?: ResendEmailTransport;
  } = {},
): Promise<SendEmailResult> {
  const config = createResendEmailConfig(options.env);
  const transport = options.transport ?? getDefaultTransport(config.apiKey);
  const payload = createEmailPayload(config, input);
  const requestOptions = input.idempotencyKey
    ? { idempotencyKey: normalizeHeaderValue(input.idempotencyKey, "idempotencyKey") }
    : undefined;
  const response = await transport.send(payload, requestOptions);

  if (response.error) {
    throw new EmailDeliveryError({
      message: `Resend email delivery failed: ${response.error.message}`,
      providerCode: response.error.name,
      providerStatusCode: response.error.statusCode,
    });
  }

  return {
    provider: "resend",
    id: response.data.id,
  };
}

function createEmailPayload(
  config: ResendEmailConfig,
  input: SendEmailInput,
): CreateEmailOptions {
  const subject = normalizeHeaderValue(input.subject, "subject");
  const to = normalizeAddressList(input.to, "to");
  const html = normalizeOptionalBody(input.html);
  const text = normalizeOptionalBody(input.text);

  if (!html && !text) {
    throw new EmailValidationError("Email requires a non-empty html or text body.");
  }

  return {
    from: config.from,
    to,
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(input.cc ? { cc: normalizeAddressList(input.cc, "cc") } : {}),
    ...(input.bcc ? { bcc: normalizeAddressList(input.bcc, "bcc") } : {}),
    ...(input.replyTo || config.replyTo
      ? {
          replyTo: normalizeAddressList(
            input.replyTo ?? config.replyTo ?? [],
            "replyTo",
          ),
        }
      : {}),
    ...(input.tags ? { tags: normalizeTags(input.tags) } : {}),
  } as CreateEmailOptions;
}

function getDefaultTransport(apiKey: string): ResendEmailTransport {
  if (cachedTransport?.apiKey === apiKey) {
    return cachedTransport.transport;
  }

  const resend = new Resend(apiKey);
  cachedTransport = {
    apiKey,
    transport: resend.emails,
  };
  return cachedTransport.transport;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new EmailConfigurationError(`${key} is required to send email.`);
  }
  return value;
}

function assertServerRuntime() {
  if (typeof window !== "undefined") {
    throw new EmailConfigurationError(
      "Email can only be sent from a server runtime.",
    );
  }
}

function normalizeEmailAddress(value: string, field: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_ADDRESS_PATTERN.test(email)) {
    throw new EmailConfigurationError(`${field} must be a valid email address.`);
  }
  return email;
}

function normalizeAddressList(
  value: string | string[],
  field: string,
): string[] {
  const addresses = (Array.isArray(value) ? value : [value]).map((item) =>
    item.trim().toLowerCase(),
  );

  if (addresses.length === 0) {
    throw new EmailValidationError(`${field} requires at least one recipient.`);
  }

  if (addresses.length > MAX_RESEND_RECIPIENTS) {
    throw new EmailValidationError(
      `${field} cannot contain more than ${MAX_RESEND_RECIPIENTS} recipients.`,
    );
  }

  for (const address of addresses) {
    if (!EMAIL_ADDRESS_PATTERN.test(address)) {
      throw new EmailValidationError(`${field} contains an invalid email address.`);
    }
  }

  return addresses;
}

function normalizeDomain(value: string, field: string): string {
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  if (!DOMAIN_PATTERN.test(domain)) {
    throw new EmailConfigurationError(`${field} must be a valid domain name.`);
  }

  return domain;
}

function normalizeHeaderValue(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new EmailValidationError(`${field} cannot be empty.`);
  }
  if (/[\r\n]/.test(normalized)) {
    throw new EmailValidationError(`${field} cannot contain line breaks.`);
  }
  return normalized;
}

function normalizeOptionalBody(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeTags(tags: Array<{ name: string; value: string }>) {
  return tags.map((tag) => ({
    name: normalizeHeaderValue(tag.name, "tag.name"),
    value: normalizeHeaderValue(tag.value, "tag.value"),
  }));
}

function formatFromAddress(name: string, email: string): string {
  if (/[<>]/.test(name)) {
    throw new EmailConfigurationError(
      "RESEND_FROM_NAME cannot contain angle brackets.",
    );
  }
  return `${name} <${email}>`;
}

function getEmailDomain(email: string): string {
  return email.split("@")[1] ?? "";
}

function isSubdomain(domain: string): boolean {
  return domain.split(".").length >= 3;
}
