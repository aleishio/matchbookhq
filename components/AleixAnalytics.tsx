"use client";

import { useEffect, type ReactNode } from "react";
import { captureAnalyticsEvent } from "@/lib/analytics";

type AleixLinkType = "social" | "resume" | "project" | "reference" | "demo" | "video";

export function AleixPageAnalytics({ sectionCount }: { sectionCount: number }) {
  useEffect(() => {
    captureAnalyticsEvent("aleix page viewed", { section_count: sectionCount });
  }, [sectionCount]);

  return null;
}

export function AleixTrackedLink({
  children,
  className,
  href,
  label,
  linkType
}: {
  children: ReactNode;
  className?: string;
  href: string;
  label: string;
  linkType: AleixLinkType;
}) {
  const external = href.startsWith("http");

  return (
    <a
      className={className}
      href={href}
      onClick={() => {
        captureAnalyticsEvent("aleix link clicked", {
          link_label: label,
          link_type: linkType
        });
      }}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      {children}
    </a>
  );
}
