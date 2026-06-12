export const DEFAULT_UNLOCK_COOKIE_NAME = "yc_os_access_token";
export const LOCAL_DEV_YC_ACCESS_TOKEN = "ycombinator";
export const POSTHOG_PROXY_PATH = "/matchbook-relay";

const LOCAL_FALLBACK_NODE_ENVS = new Set(["development", "test"]);

const MACHINE_API_PATHS = new Set([
  "/api/luma/sync",
  "/api/luma/webhook",
  "/api/luma/writebacks",
  "/api/agent/actions/luma-guests",
  "/api/agent/capabilities",
  "/api/agent/guest-requests/process",
  "/api/agent/sessions",
  "/api/agent/tools/call",
  "/api/mcp",
  "/api/resend/clarification-emails",
  "/api/resend/webhook"
]);

export type SiteAccessCheckInput = {
  authorization?: string | null;
  cookieValue?: string | null;
  pathname: string;
  token: string;
};

export function getUnlockCookieName(env: NodeJS.ProcessEnv = process.env) {
  return env.YC_OS_UNLOCK_COOKIE_NAME?.trim() || DEFAULT_UNLOCK_COOKIE_NAME;
}

export function getSiteAccessToken(env: NodeJS.ProcessEnv = process.env) {
  const configuredToken = env.YC_OS_ACCESS_TOKEN?.trim()
    || env.AGENT_ACCESS_TOKEN?.trim();

  if (configuredToken) return configuredToken;
  return allowsLocalAccessFallback(env) ? LOCAL_DEV_YC_ACCESS_TOKEN : "";
}

export function allowsLocalAccessFallback(env: NodeJS.ProcessEnv = process.env) {
  if (LOCAL_FALLBACK_NODE_ENVS.has(env.NODE_ENV ?? "")) return true;
  return env.VERCEL_ENV === "development";
}

export function readBearerToken(authorization: string | null | undefined) {
  if (!authorization) return null;
  const [scheme, ...parts] = authorization.split(" ");
  if (scheme.toLowerCase() !== "bearer") return null;
  const token = parts.join(" ").trim();
  return token || null;
}

export function isSiteAccessAllowed(input: SiteAccessCheckInput) {
  if (isOpenPath(input.pathname)) return true;
  if (!input.token) return false;

  const bearerToken = readBearerToken(input.authorization);
  return input.cookieValue === input.token || bearerToken === input.token;
}

export function isOpenPath(pathname: string) {
  return pathname === "/unlock"
    || pathname === "/u"
    || pathname === "/api/unlock"
    || pathname === "/favicon.ico"
    || pathname === "/icon.svg"
    || MACHINE_API_PATHS.has(pathname)
    || pathname === POSTHOG_PROXY_PATH
    || pathname.startsWith(`${POSTHOG_PROXY_PATH}/`)
    || pathname.startsWith("/_next/");
}

export function safeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
