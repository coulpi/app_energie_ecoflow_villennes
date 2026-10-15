"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Onglets d'une rubrique regroupant plusieurs pages (Équipements, Paramètres). */
export default function SubNav({
  items,
}: {
  items: Array<{ href: string; label: string }>;
}) {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={
              "shrink-0 px-3.5 h-9 inline-flex items-center rounded-lg text-sm font-medium transition-colors border " +
              (active
                ? "bg-blue-500/10 text-blue-300 border-blue-500/30"
                : "border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900")
            }
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
