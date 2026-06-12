import { NextResponse } from "next/server";

import { syncLumaApprovalsFromEnv } from "@/app/lib/luma/sync";
import { requireServerActionSecret } from "@/app/lib/server/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireServerActionSecret(request);
  if (unauthorized) return unauthorized;

  const summary = await syncLumaApprovalsFromEnv();
  return NextResponse.json(summary, { status: summary.status === "completed" ? 200 : 500 });
}
