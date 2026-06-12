import type { Metadata } from "next";

import { YcUnlock } from "@/components/YcUnlock";
import { safeRedirectPath } from "@/app/lib/site-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Handoff | YC OS Events",
  description: "Unlock YC OS agent mode and copy the scoped MCP/API handoff instructions."
};

export default async function ShortUnlockPage({
  searchParams
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeRedirectPath(params?.next);

  return <YcUnlock defaultMode="agent" nextPath={nextPath} showAgentInstructions />;
}
