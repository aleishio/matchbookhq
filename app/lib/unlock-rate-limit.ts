export const UNLOCK_RATE_LIMIT_MAX_ATTEMPTS = 8;
const UNLOCK_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 1000;

type UnlockAttemptEntry = {
  attempts: number;
  resetAt: number;
};

type UnlockRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const unlockAttempts = new Map<string, UnlockAttemptEntry>();

export function checkUnlockRateLimit(
  request: Request,
  now = Date.now()
): UnlockRateLimitResult {
  pruneExpiredAttempts(now);

  const entry = unlockAttempts.get(getUnlockRateLimitKey(request));
  if (!entry || entry.resetAt <= now || entry.attempts < UNLOCK_RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
}

export function recordFailedUnlockAttempt(request: Request, now = Date.now()) {
  const key = getUnlockRateLimitKey(request);
  const current = unlockAttempts.get(key);

  if (!current || current.resetAt <= now) {
    unlockAttempts.set(key, {
      attempts: 1,
      resetAt: now + UNLOCK_RATE_LIMIT_WINDOW_MS
    });
    trimTrackedClients();
    return;
  }

  current.attempts += 1;
}

export function clearFailedUnlockAttempts(request: Request) {
  unlockAttempts.delete(getUnlockRateLimitKey(request));
}

export function resetUnlockRateLimitForTests() {
  unlockAttempts.clear();
}

function pruneExpiredAttempts(now: number) {
  for (const [key, entry] of unlockAttempts) {
    if (entry.resetAt <= now) unlockAttempts.delete(key);
  }
}

function trimTrackedClients() {
  while (unlockAttempts.size > MAX_TRACKED_CLIENTS) {
    const oldestKey = unlockAttempts.keys().next().value;
    if (!oldestKey) return;
    unlockAttempts.delete(oldestKey);
  }
}

function getUnlockRateLimitKey(request: Request) {
  return firstHeaderValue(request.headers.get("x-forwarded-for"))
    || firstHeaderValue(request.headers.get("x-real-ip"))
    || firstHeaderValue(request.headers.get("cf-connecting-ip"))
    || "unknown";
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}
