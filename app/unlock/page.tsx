import type { Metadata } from "next";

import { YcUnlock } from "@/components/YcUnlock";
import { safeRedirectPath } from "@/app/lib/site-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unlock | YC OS Events",
  description: "Private YC OS access for authorized YC team members and scoped AI agents."
};

export default async function UnlockPage({
  searchParams
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeRedirectPath(params?.next);

  return <YcUnlock nextPath={nextPath} />;
}
