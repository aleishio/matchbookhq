import { AgentAccess } from "@/components/AgentAccess";

export type MainNavSection = "prep" | "approvals" | "technical" | "aleix";

const MAIN_NAV_ITEMS: Array<{
  id: MainNavSection;
  href: string;
  label: string;
}> = [
  { id: "prep", href: "/", label: "Prep" },
  { id: "approvals", href: "/approvals", label: "Approvals" },
  { id: "technical", href: "/approvals/integrations", label: "How built" },
  { id: "aleix", href: "/aleix", label: "About Aleix" }
];

export function MainNav({ active }: { active: MainNavSection }) {
  return (
    <nav className="mode-nav" aria-label="YC OS sections">
      {MAIN_NAV_ITEMS.map((item) => (
        <a
          aria-current={active === item.id ? "page" : undefined}
          className={`mode-link${active === item.id ? " active" : ""}`}
          href={item.href}
          key={item.id}
        >
          {item.label}
        </a>
      ))}
      <AgentAccess />
    </nav>
  );
}
