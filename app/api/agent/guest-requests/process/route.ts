import { NextResponse } from "next/server";

import { processAgentGuestRequestsFromEnv } from "@/app/lib/agent-guest-request-worker";
import { requireServerActionSecret } from "@/app/lib/server/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireServerActionSecret(request);
  if (unauthorized) return unauthorized;

  const summary = await processAgentGuestRequestsFromEnv();
  return NextResponse.json(summary, { status: summary.failed > 0 ? 207 : 200 });
}
