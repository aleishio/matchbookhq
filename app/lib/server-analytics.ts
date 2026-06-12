import type { FetchFn } from "./luma/client";

export type ServerAnalyticsPrimitive = string | number | boolean | null;
export type ServerAnalyticsProperties = Record<string, ServerAnalyticsPrimitive | undefined>;

export type ServerAnalyticsEventName =
  | "agent approval action requested"
  | "agent event guests action requested";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const FORBIDDEN_PROPERTY_PATTERNS = [
  /authorization/i,
  /body/i,
  /email/i,
  /luma_payload/i,
  /name/i,
  /phone/i,
  /raw/i,
  /reason/i,
  /secret/i,
  /text/i,
  /token/i
];

export async function captureServerAnalyticsEvent(
  event: ServerAnalyticsEventName,
  properties: ServerAnalyticsProperties,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: FetchFn = fetch
) {
  if (!isServerAnalyticsEnabled(env)) return;

  const host = normalizePostHogHost(env.NEXT_PUBLIC_POSTHOG_HOST);
  const token = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return;

  try {
    await fetchFn(new URL("/i/v0/e/", host), {
      body: JSON.stringify({
        api_key: token,
        distinct_id: "yc-os-agent-actions",
        event,
        properties: {
          ...sanitizeServerAnalyticsProperties(properties),
          "$process_person_profile": false
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  } catch {
    // Analytics must never block an agent action response.
  }
}

export function sanitizeServerAnalyticsProperties(properties: ServerAnalyticsProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      if (value === undefined) return false;
      return !FORBIDDEN_PROPERTY_PATTERNS.some((pattern) => pattern.test(key));
    })
  ) as Record<string, ServerAnalyticsPrimitive>;
}

function isServerAnalyticsEnabled(env: NodeJS.ProcessEnv) {
  return env.NEXT_PUBLIC_POSTHOG_ENABLED === "true"
    && Boolean(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim());
}

function normalizePostHogHost(host: string | undefined) {
  try {
    return new URL(host?.trim() || DEFAULT_POSTHOG_HOST).toString();
  } catch {
    return DEFAULT_POSTHOG_HOST;
  }
}
