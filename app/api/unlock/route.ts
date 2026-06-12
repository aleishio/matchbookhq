import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  getSiteAccessToken,
  getUnlockCookieName,
  safeRedirectPath
} from "@/app/lib/site-access";
import {
  checkUnlockRateLimit,
  clearFailedUnlockAttempts,
  recordFailedUnlockAttempt
} from "@/app/lib/unlock-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export async function POST(request: Request) {
  const token = getSiteAccessToken();
  if (!token) {
    return NextResponse.json(
      {
        error: "site_access_token_missing",
        message: "YC_OS_ACCESS_TOKEN is required before YC OS can be unlocked."
      },
      { status: 503 }
    );
  }

  const rateLimit = checkUnlockRateLimit(request);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "unlock_rate_limited",
        message: "Too many unlock attempts. Try again later."
      },
      {
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds)
        },
        status: 429
      }
    );
  }

  const body = await readJsonBody(request);
  const password = typeof body.password === "string" ? body.password.trim() : "";

  if (!password || !safeEqual(password, token)) {
    recordFailedUnlockAttempt(request);
    return NextResponse.json(
      { error: "invalid_password", message: "That password did not unlock YC OS." },
      { status: 401 }
    );
  }

  const nextPath = safeRedirectPath(typeof body.next === "string" ? body.next : "/");
  const response = NextResponse.json({
    next: nextPath,
    ok: true
  });

  response.cookies.set({
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    name: getUnlockCookieName(),
    path: "/",
    sameSite: "lax",
    secure: isHttpsRequest(request),
    value: token
  });

  clearFailedUnlockAttempts(request);
  return response;
}

function isHttpsRequest(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedProto) return forwardedProto === "https";
  return new URL(request.url).protocol === "https:";
}

async function readJsonBody(request: Request) {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
