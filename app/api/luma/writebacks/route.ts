import { NextResponse } from "next/server";

import { processLumaWritebacksFromEnv } from "@/app/lib/luma/writebacks";
import { requireServerActionSecret } from "@/app/lib/server/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireServerActionSecret(request);
  if (unauthorized) return unauthorized;

  const summary = await processLumaWritebacksFromEnv();
  return NextResponse.json(summary, { status: summary.failed > 0 ? 207 : 200 });
}
