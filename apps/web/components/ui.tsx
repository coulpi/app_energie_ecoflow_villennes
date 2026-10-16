// Briques d'interface communes (composants serveur, sans état) : cartes
// KPI, sections, barres de répartition, pastilles d'état et icônes.
// Couleurs = palettes thémées (claires/sombres via theme-colors.css).

import type { ReactNode } from "react";

export type Accent =
  | "solar"
  | "home"
  | "grid"
  | "battery"
  | "import"
  | "aux"
  | "cost"
  | "neutral";

export const ACCENT: Record<Accent, { icon: string; text: string; bar: string }> = {
  solar: { icon: "bg-amber-500/10 text-amber-400", text: "text-amber-400", bar: "bg-amber-500" },
  home: { icon: "bg-emerald-500/10 text-emerald-400", text: "text-emerald-400", bar: "bg-emerald-500" },
  grid: { icon: "bg-blue-500/10 text-blue-400", text: "text-blue-400", bar: "bg-blue-500" },
  battery: { icon: "bg-violet-500/10 text-violet-400", text: "text-violet-400", bar: "bg-violet-500" },
  import: { icon: "bg-rose-500/10 text-rose-400", text: "text-rose-400", bar: "bg-rose-500" },
  aux: { icon: "bg-cyan-500/10 text-cyan-400", text: "text-cyan-400", bar: "bg-cyan-500" },
  cost: { icon: "bg-orange-500/10 text-orange-400", text: "text-orange-400", bar: "bg-orange-500" },
  neutral: { icon: "bg-zinc-500/10 text-zinc-400", text: "text-zinc-300", bar: "bg-zinc-500" },
};

/** Puissance lisible : « 850 W » / « 2,15 kW » / « — ». */
export function fmtPower(w: number | null | undefined): { value: string; unit: string } {
  if (w === null || w === undefined || !Number.isFinite(w)) return { value: "—", unit: "" };
  if (Math.abs(w) >= 1000) {
    return {
      value: (w / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: 1 }),
      unit: "kW",
    };
  }
  return { value: String(Math.round(w)), unit: "W" };
}

export const fmtEur = (v: number) =>
  v.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

export const fmtKWh = (wh: number) =>
  `${(wh / 1000).toLocaleString("fr-FR", { maximumFractionDigits: wh < 10_000 ? 2 : 1 })} kWh`;

export function KpiCard({
  label,
  value,
  unit,
  sub,
  icon,
  accent = "neutral",
  valueAccent = false,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  icon: ReactNode;
  accent?: Accent;
  /** Colore la valeur avec l'accent (sinon couleur de texte principale). */
  valueAccent?: boolean;
}) {
  const a = ACCENT[accent];
  return (
    <div className="card !p-4 flex items-start gap-3 min-w-0">
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.icon}`}>
        <span className="w-5 h-5">{icon}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-zinc-400 truncate">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span
            className={`text-2xl font-semibold tabular-nums leading-tight ${valueAccent ? a.text : "text-zinc-100"}`}
          >
            {value}
          </span>
          {unit && <span className="text-sm text-zinc-400">{unit}</span>}
        </div>
        {sub && <div className="mt-1 text-[11px] text-zinc-500 truncate">{sub}</div>}
      </div>
    </div>
  );
}

export function Section({
  title,
  sub,
  action,
  children,
  className = "",
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h2 className="card-title">{title}</h2>
          {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="page-h1">{title}</h1>
        {sub && <p className="page-sub mt-1">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Ligne de répartition : icône, libellé, valeur, barre de part. */
export function ShareRow({
  icon,
  label,
  value,
  pct,
  accent,
  sub = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  pct: number;
  accent: Accent;
  /** Sous-ligne (détail d'un réseau) : en retrait, plus discrète. */
  sub?: boolean;
}) {
  const a = ACCENT[accent];
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={`flex items-center gap-3 ${sub ? "pl-11 py-1" : "py-1.5"}`}>
      <span
        className={`${sub ? "w-6 h-6 rounded-md" : "w-8 h-8 rounded-lg"} flex items-center justify-center shrink-0 ${a.icon}`}
      >
        <span className={sub ? "w-3.5 h-3.5" : "w-4 h-4"}>{icon}</span>
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`flex-1 min-w-0 truncate ${sub ? "text-xs text-zinc-400" : "text-sm text-zinc-200"}`}>{label}</span>
          <span className={`tabular-nums shrink-0 ${sub ? "text-xs font-medium text-zinc-300" : "text-sm font-semibold text-zinc-100"}`}>{value}</span>
          <span className="text-xs text-zinc-500 tabular-nums w-9 text-right shrink-0">{Math.round(p)} %</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
          <div className={`h-full rounded-full ${a.bar}`} style={{ width: `${p}%` }} />
        </div>
      </div>
    </div>
  );
}

export type Status = "ok" | "warn" | "bad" | "idle";
const STATUS_DOT: Record<Status, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  idle: "bg-zinc-500",
};
export function StatusDot({ status }: { status: Status }) {
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />;
}

// ── Icônes (trait 1,6, currentColor) ────────────────────────────────

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
    {d}
  </svg>
);

export const Icon = {
  bolt: svg(<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />),
  sun: svg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>,
  ),
  battery: svg(
    <>
      <rect x="3" y="7" width="16" height="10" rx="2" />
      <path d="M21 10v4M7 10v4M10.5 10v4" />
    </>,
  ),
  pylon: svg(<path d="M12 3v4M6 21l6-14 6 14M8 15h8M9.5 11h5M4 7h16" />),
  home: svg(
    <>
      <path d="M3 12 12 4l9 8" />
      <path d="M5 10v10h14V10" />
    </>,
  ),
  pool: svg(
    <>
      <path d="M3 17c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M3 21c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0" />
      <path d="M8 14V5a2 2 0 0 1 4 0M16 14V5a2 2 0 0 0-4 0M8 9h8" />
    </>,
  ),
  euro: svg(
    <>
      <path d="M17 6.5A7 7 0 1 0 17 17.5" />
      <path d="M4 10h9M4 14h9" />
    </>,
  ),
  leaf: svg(
    <>
      <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14Z" />
      <path d="M5 19 13 11" />
    </>,
  ),
  plug: svg(<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4" />),
  car: svg(
    <>
      <path d="M5 16V11l2-5h10l2 5v5" />
      <path d="M3 16h18v3H3zM7 19v2M17 19v2M6 11h12" />
    </>,
  ),
  fan: svg(
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10c0-4 1-7 4-7 2 0 2 3 0 5M14 12c4 0 7 1 7 4 0 2-3 2-5 0M12 14c0 4-1 7-4 7-2 0-2-3 0-5M10 12c-4 0-7-1-7-4 0-2 3-2 5 0" />
    </>,
  ),
  alert: svg(
    <>
      <path d="M12 4 3 20h18L12 4Z" />
      <path d="M12 10v4M12 17v.5" />
    </>,
  ),
  info: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.5" />
    </>,
  ),
  check: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>,
  ),
  gauge: svg(
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 14 4-5" />
    </>,
  ),
};
