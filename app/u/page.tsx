import type { Metadata } from "next";

import { YcUnlock } from "@/components/YcUnlock";
import { safeRedirectPath } from "@/app/lib/site-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unlock | YC OS Events",
  description: "Unlock YC OS for human app access or scoped machine handoff."
};

export default async function ShortUnlockPage({
  searchParams
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeRedirectPath(params?.next);

  return <YcUnlock nextPath={nextPath} showAgentInstructions />;
}
