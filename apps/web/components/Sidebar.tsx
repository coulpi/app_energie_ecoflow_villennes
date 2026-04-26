"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items: { href: string; icon: React.ReactNode; label: string }[] = [
  {
    href: "/",
    label: "Tableau de bord",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 12 12 4l9 8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 10v10h14V10" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/flow",
    label: "Flux d'énergie",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="6" cy="7" r="2" />
        <circle cx="18" cy="7" r="2" />
        <circle cx="12" cy="17" r="2" />
        <path d="M7.5 8.5 11 15.5M16.5 8.5 13 15.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/history",
    label: "Historique",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 19V8M9 19V12M14 19V5M19 19V14" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/devices",
    label: "Équipements",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 4v16M4 12h16" strokeLinecap="round" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    href: "/rules",
    label: "Règles",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path
          d="M12 2c1 4 4 6 8 7-4 1-7 3-8 7-1-4-4-6-8-7 4-1 7-3 8-7Z"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/control",
    label: "Pilotage",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  return (
    <aside className="hidden sm:flex flex-col items-center w-16 shrink-0 bg-zinc-950 border-r border-zinc-900 py-4 sticky top-0 h-screen">
      <Link
        href="/"
        className="relative w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-300 hover:text-white"
        title="Accueil"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5">
          <path d="M3 12 12 4l9 8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v10h14V10" strokeLinejoin="round" />
        </svg>
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
      </Link>

      <nav className="flex flex-col gap-1 mt-6 flex-1">
        {items.map((it) => {
          const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              title={it.label}
              className={
                "w-10 h-10 rounded-lg flex items-center justify-center transition-colors " +
                (active
                  ? "bg-zinc-800 text-emerald-400"
                  : "text-zinc-500 hover:text-zinc-100 hover:bg-zinc-900")
              }
            >
              <div className="w-5 h-5">{it.icon}</div>
            </Link>
          );
        })}
      </nav>

      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center text-xs font-semibold text-white">
          PC
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
      </div>
    </aside>
  );
}
