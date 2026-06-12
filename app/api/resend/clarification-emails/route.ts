import { NextResponse } from "next/server";

import { processClarificationEmailsFromEnv } from "@/app/lib/resend/clarification-emails";
import { requireServerActionSecret } from "@/app/lib/server/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireServerActionSecret(request);
  if (unauthorized) return unauthorized;

  const summary = await processClarificationEmailsFromEnv();
  return NextResponse.json(summary, { status: summary.failed > 0 ? 207 : 200 });
}
