"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/reviews", label: "Reviews" },
  { href: "/errors", label: "Error library" },
  { href: "/progress", label: "Progress" },
];

export function Nav({ mode, model }: { mode: "mock" | "live"; model: string }) {
  const pathname = usePathname();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          TCF Coach
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/session") : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-2.5 py-1 ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-text"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs ${mode === "mock" ? "bg-warn-soft text-warn" : "bg-good-soft text-good"}`}
          title={mode === "mock" ? "No ANTHROPIC_API_KEY: exercises come from the seed bank and feedback is rule-based." : `Model: ${model}`}
          data-testid="provider-badge"
        >
          {mode === "mock" ? "Mock AI mode" : `Claude · ${model}`}
        </span>
      </div>
    </header>
  );
}
