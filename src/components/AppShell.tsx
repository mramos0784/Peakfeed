"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/map", label: "Map", icon: "ti-map-2" },
  { href: "/lists", label: "Lists", icon: "ti-list-numbers" },
  { href: "/vote-day", label: "Vote Day", icon: "ti-chart-bar" },
  { href: "/feed", label: "Feed", icon: "ti-rss" },
  { href: "/profile", label: "Profile", icon: "ti-user" },
] as const;

export default function AppShell({
  children,
  initials,
  voteWeekend,
}: {
  children: React.ReactNode;
  initials: string;
  voteWeekend: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="pf-shell">
      <header className="pf-app-header">
        <Link href="/" className="pf-logo">
          PEAKFEED
        </Link>
        <Link href="/profile" className="pf-avatar-btn" aria-label="Profile">
          {initials}
        </Link>
      </header>

      <main className="pf-shell-main">{children}</main>

      <nav className="pf-navbar">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`pf-nav-btn${active ? " active" : ""}`}
            >
              <i className={`ti ${tab.icon}`} />
              <span>{tab.label}</span>
              {tab.href === "/vote-day" && voteWeekend && (
                <div className="pf-nav-badge pulse" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
