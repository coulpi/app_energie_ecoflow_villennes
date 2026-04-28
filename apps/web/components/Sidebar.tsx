"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
  {
    href: "/solar",
    label: "Production solaire",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/loads",
    label: "Charges récurrentes",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="11" width="4" height="9" rx="1" />
        <rect x="10" y="6" width="4" height="14" rx="1" />
        <rect x="17" y="14" width="4" height="6" rx="1" />
      </svg>
    ),
  },
  {
    href: "/agent",
    label: "Agent IA",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3a4 4 0 0 0-4 4v1H7a3 3 0 0 0 0 6h1v1a4 4 0 0 0 8 0v-1h1a3 3 0 0 0 0-6h-1V7a4 4 0 0 0-4-4Z" strokeLinejoin="round" />
        <circle cx="10" cy="11" r="0.6" fill="currentColor" />
        <circle cx="14" cy="11" r="0.6" fill="currentColor" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Ferme le drawer au changement de route
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Bloque le scroll du body quand le drawer est ouvert
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  const activeItem = items.find((it) => isActive(it.href));

  return (
    <>
      {/* Sidebar verticale (tablette/desktop) */}
      <aside className="hidden sm:flex flex-col items-center w-16 shrink-0 bg-zinc-950 border-r border-zinc-900 py-4 sticky top-0 h-screen z-30">
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
            const active = isActive(it.href);
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

      {/* Top bar mobile avec burger */}
      <header className="sm:hidden sticky top-0 z-40 flex items-center justify-between gap-3 px-4 h-14 bg-zinc-950/95 backdrop-blur border-b border-zinc-900">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          aria-expanded={open}
          className="w-10 h-10 -ml-2 rounded-lg flex items-center justify-center text-zinc-200 hover:bg-zinc-900 active:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
        <span className="font-medium text-zinc-100 truncate">
          {activeItem?.label ?? "EcoFlow"}
        </span>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center text-[11px] font-semibold text-white">
          PC
        </div>
      </header>

      {/* Drawer mobile */}
      <div
        className={
          "sm:hidden fixed inset-0 z-50 transition-opacity duration-200 " +
          (open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")
        }
        aria-hidden={!open}
      >
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setOpen(false)}
        />
        <aside
          className={
            "absolute top-0 left-0 h-full w-72 max-w-[85%] bg-zinc-950 border-r border-zinc-900 shadow-2xl flex flex-col transition-transform duration-200 " +
            (open ? "translate-x-0" : "-translate-x-full")
          }
          role="dialog"
          aria-label="Menu de navigation"
        >
          <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-900">
            <span className="font-semibold text-zinc-100">EcoFlow Villennes</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer le menu"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-300 hover:bg-zinc-900"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {items.map((it) => {
              const active = isActive(it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={
                    "flex items-center gap-3 mx-2 my-0.5 px-3 h-12 rounded-lg transition-colors " +
                    (active
                      ? "bg-zinc-900 text-emerald-400"
                      : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100")
                  }
                >
                  <div className="w-5 h-5 shrink-0">{it.icon}</div>
                  <span className="text-sm font-medium">{it.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-zinc-900 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center text-xs font-semibold text-white">
              PC
            </div>
            <span className="text-sm text-zinc-400">Pierre Coulanges</span>
          </div>
        </aside>
      </div>
    </>
  );
}
