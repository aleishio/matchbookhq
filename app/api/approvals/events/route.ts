import { NextResponse } from "next/server";

import { listApprovalEvents } from "@/app/lib/event-approvals-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await listApprovalEvents();
  return NextResponse.json({ events });
}
