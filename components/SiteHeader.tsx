import type { ReactNode } from "react";
import { MainNav, type MainNavSection } from "@/components/MainNav";

export function SiteHeader({
  active,
  children
}: {
  active: MainNavSection;
  children?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="yc-mark">Y</div>
      <div className="event-title">Aleix Ordeig Bros in SF</div>
      <div className="event-meta">Community Builder + Product Engineer</div>
      <MainNav active={active} />
      {children}
    </header>
  );
}
