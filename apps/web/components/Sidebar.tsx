"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "./ThemeToggle";

// Barre de navigation : bleu nuit dans les 2 thèmes (couleurs slate, non
// thémées). Desktop (lg+) : colonne fixe ; mobile/tablette : barre du haut
// + tiroir.

interface NavItem {
  href: string;
  label: string;
  /** Préfixes de routes rattachés à cet onglet (sous-pages). */
  match?: string[];
  icon: React.ReactNode;
}

const I = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const items: NavItem[] = [
  {
    href: "/",
    label: "Tableau de bord",
    match: ["/flow"],
    icon: I(
      <>
        <path d="M3 12 12 4l9 8" />
        <path d="M5 10v10h14V10" />
      </>,
    ),
  },
  {
    href: "/battery",
    label: "Batterie",
    match: ["/control"],
    icon: I(
      <>
        <rect x="3" y="7" width="16" height="10" rx="2" />
        <path d="M21 10v4M7 10v4M10.5 10v4" />
      </>,
    ),
  },
  {
    href: "/networks",
    label: "Réseaux",
    icon: I(
      <>
        <path d="M12 3v4M6 21l6-14 6 14M8 15h8M9.5 11h5" />
        <path d="M4 7h16" />
      </>,
    ),
  },
  {
    href: "/solar",
    label: "Solaire",
    icon: I(
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </>,
    ),
  },
  {
    href: "/screen",
    label: "Écran",
    icon: I(
      <>
        <rect x="4" y="3" width="16" height="16" rx="2" />
        <path d="M9 21h6M12 19v2M8 8h3M8 12h8M8 15h5" />
      </>,
    ),
  },
  {
    href: "/equipment",
    label: "Équipements",
    match: ["/jacuzzi", "/loads"],
    icon: I(
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 9h8M8 13h5M8 17h3" />
      </>,
    ),
  },
  {
    href: "/costs",
    label: "Coûts",
    icon: I(
      <>
        <path d="M17 6.5A7 7 0 1 0 17 17.5" />
        <path d="M4 10h9M4 14h9" />
      </>,
    ),
  },
  {
    href: "/history",
    label: "Historique",
    icon: I(<path d="M4 19V8M9 19V12M14 19V5M19 19V14" />),
  },
  {
    href: "/settings",
    label: "Paramètres",
    match: ["/devices", "/rules", "/tariffs", "/agent"],
    icon: I(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-.9c.6.5 1.3.9 2 1.2L10 21h4l.5-2.6c.7-.3 1.4-.7 2-1.2l2.4.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
      </>,
    ),
  },
];

function isActive(pathname: string, it: NavItem): boolean {
  const prefixes = [it.href, ...(it.match ?? [])];
  return prefixes.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`),
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-sky-500 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" className="w-5 h-5">
          <path d="M3 12 12 4l9 8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v10h14V10" strokeLinejoin="round" />
          <path d="M12.5 11 10 15h3l-1 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-50">EcoFlow Villennes</div>
        <div className="text-[11px] text-slate-400">Maison connectée</div>
      </div>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <div className="h-10" />;
  return (
    <div className="px-3 leading-tight">
      <div className="text-[11px] text-slate-400 capitalize">
        {now.toLocaleDateString("fr-FR", {
          weekday: "short",
          day: "numeric",
          month: "long",
          timeZone: "Europe/Paris",
        })}
      </div>
      <div className="text-lg font-semibold text-slate-50 tabular-nums">
        {now.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        })}
      </div>
    </div>
  );
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
      {items.map((it) => {
        const active = isActive(pathname, it);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-3 mx-3 px-3 h-11 rounded-lg text-sm font-medium transition-colors " +
              (active
                ? "text-slate-50 shadow-[0_4px_14px_rgba(37,99,235,0.35)]"
                : "text-slate-300 hover:bg-slate-50/10 hover:text-slate-50")
            }
            style={active ? { backgroundColor: "#2563eb" } : undefined}
          >
            <span className="w-5 h-5 shrink-0">{it.icon}</span>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const activeItem = items.find((it) => isActive(pathname, it));
  const shell = "bg-[#0f1b33] border-slate-800";

  return (
    <>
      {/* Desktop : colonne fixe */}
      <aside
        className={`hidden lg:flex flex-col w-60 shrink-0 border-r ${shell} sticky top-0 h-screen z-30`}
      >
        <Link href="/" className="px-5 h-20 flex items-center">
          <Logo />
        </Link>
        <NavLinks pathname={pathname} />
        <div className="border-t border-slate-800 p-3 space-y-3">
          <Clock />
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile / tablette : barre du haut */}
      <header
        className={`lg:hidden sticky top-0 z-40 flex items-center justify-between gap-3 px-3 h-14 border-b ${shell}`}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          aria-expanded={open}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-200 hover:bg-slate-50/10"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
        <span className="font-medium text-slate-50 truncate">
          {activeItem?.label ?? "EcoFlow Villennes"}
        </span>
        <ThemeToggle compact />
      </header>

      {/* Tiroir mobile */}
      <div
        className={
          "lg:hidden fixed inset-0 z-50 transition-opacity duration-200 " +
          (open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")
        }
        aria-hidden={!open}
      >
        <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
        <aside
          className={
            `absolute top-0 left-0 h-full w-72 max-w-[85%] border-r ${shell} shadow-2xl flex flex-col transition-transform duration-200 ` +
            (open ? "translate-x-0" : "-translate-x-full")
          }
          role="dialog"
          aria-label="Menu de navigation"
        >
          <div className="flex items-center justify-between px-4 h-16">
            <Logo />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer le menu"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-50/10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <NavLinks pathname={pathname} />
          <div className="border-t border-slate-800 p-3 space-y-3">
            <Clock />
            <ThemeToggle />
          </div>
        </aside>
      </div>
    </>
  );
}
