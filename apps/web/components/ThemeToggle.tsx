"use client";

import { useEffect, useState } from "react";

/** Bascule clair / sombre, mémorisée par appareil (localStorage). */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // stockage indisponible (navigation privée) : thème non mémorisé
    }
  };

  const label = dark ? "Passer en mode clair" : "Passer en mode sombre";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={
        "flex items-center gap-3 rounded-lg text-slate-300 hover:text-slate-50 hover:bg-slate-50/10 transition-colors " +
        (compact ? "w-10 h-10 justify-center" : "w-full h-10 px-3")
      }
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5 shrink-0">
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" strokeLinecap="round" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        )}
      </svg>
      {!compact && <span className="text-sm">{dark ? "Mode clair" : "Mode sombre"}</span>}
    </button>
  );
}
