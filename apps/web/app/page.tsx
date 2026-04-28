import Link from "next/link";
import { getDashboardSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtW(v: number | null) {
  return v === null ? "—" : `${Math.round(v)} W`;
}
function fmtPct(v: number | null) {
  return v === null ? "—" : `${Math.round(v)} %`;
}

type Tone = "default" | "good" | "warn" | "bad" | "info";

const TONE: Record<
  Tone,
  { ring: string; bar: string; text: string; glow: string }
> = {
  default: {
    ring: "ring-white/10",
    bar: "bg-zinc-500",
    text: "text-zinc-100",
    glow: "from-zinc-500/15 to-transparent",
  },
  good: {
    ring: "ring-emerald-500/30",
    bar: "bg-emerald-400",
    text: "text-emerald-300",
    glow: "from-emerald-500/20 to-transparent",
  },
  warn: {
    ring: "ring-amber-500/30",
    bar: "bg-amber-400",
    text: "text-amber-300",
    glow: "from-amber-500/20 to-transparent",
  },
  bad: {
    ring: "ring-rose-500/30",
    bar: "bg-rose-400",
    text: "text-rose-300",
    glow: "from-rose-500/20 to-transparent",
  },
  info: {
    ring: "ring-sky-500/30",
    bar: "bg-sky-400",
    text: "text-sky-300",
    glow: "from-sky-500/20 to-transparent",
  },
};

function Tile({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  icon?: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-white/[0.03] backdrop-blur-sm ring-1 ${t.ring} p-4 sm:p-5 flex flex-col gap-2 min-w-0`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 -top-12 h-24 bg-gradient-to-b ${t.glow} blur-xl`}
      />
      <div className="relative flex items-center justify-between gap-3">
        <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-zinc-400 truncate">
          {label}
        </span>
        {icon && <span className={`${t.text} opacity-80 shrink-0`}>{icon}</span>}
      </div>
      <span
        className={`relative text-2xl sm:text-3xl font-semibold tabular-nums leading-tight ${t.text}`}
      >
        {value}
      </span>
      {hint && (
        <span className="relative text-[11px] text-zinc-500 truncate">
          {hint}
        </span>
      )}
      <span
        className={`relative mt-1 h-[2px] w-10 rounded-full ${t.bar} opacity-80`}
      />
    </div>
  );
}

const SunIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" strokeLinecap="round" />
  </svg>
);
const HouseIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 12 12 4l9 8" strokeLinejoin="round" strokeLinecap="round" />
    <path d="M5 10v10h14V10" strokeLinejoin="round" />
  </svg>
);
const PlugIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const BattIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="7" width="16" height="10" rx="2" />
    <path d="M21 10v4" strokeLinecap="round" />
  </svg>
);
const BoltIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" strokeLinejoin="round" />
  </svg>
);
const SwitchIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="8" width="18" height="8" rx="4" />
    <circle cx="8" cy="12" r="2" />
  </svg>
);
const GearIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-.9c.6.5 1.3.9 2 1.2L10 21h4l.5-2.6c.7-.3 1.4-.7 2-1.2l2.4.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" strokeLinejoin="round" />
  </svg>
);

export default async function Page() {
  const s = await getDashboardSnapshot();
  const surplusTone: Tone =
    s.surplusW === null ? "default" : s.surplusW > 0 ? "good" : "warn";
  const socTone: Tone =
    s.batterySoc === null
      ? "default"
      : s.batterySoc < 20
        ? "bad"
        : s.batterySoc > 80
          ? "good"
          : "info";
  const gridTone: Tone =
    s.gridW === null ? "default" : s.gridW > 0 ? "warn" : "good";

  const importing = s.gridW !== null && s.gridW > 30;
  const exporting = s.gridW !== null && s.gridW < -30;
  const battCharging =
    s.batteryPowerW !== null && s.batteryPowerW < -30 ? true : false;
  const battDischarging =
    s.batteryPowerW !== null && s.batteryPowerW > 30 ? true : false;

  let bannerTone: Tone = "default";
  let bannerTitle = "Équilibre temps réel";
  let bannerSub = "Production et consommation alignées.";
  if (importing) {
    bannerTone = "warn";
    bannerTitle = "Déficit · import depuis le réseau";
    bannerSub = "La maison consomme plus que la production solaire.";
  } else if (exporting) {
    bannerTone = "good";
    bannerTitle = "Surplus · export vers le réseau";
    bannerSub = "La production solaire dépasse les besoins maison.";
  } else if (battCharging) {
    bannerTone = "info";
    bannerTitle = "Charge batterie en cours";
    bannerSub = "Le surplus alimente la batterie pour un usage différé.";
  } else if (battDischarging) {
    bannerTone = "info";
    bannerTitle = "Autonomie batterie";
    bannerSub = "La batterie alimente la maison sans recourir au réseau.";
  }

  const banner = TONE[bannerTone];

  return (
    <div className="space-y-5 sm:space-y-6 max-w-[1320px] mx-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="page-h1">Tableau de bord</h1>
          <p className="page-sub">Vue d&rsquo;ensemble de votre installation énergétique.</p>
        </div>
        <span className="text-[11px] text-zinc-500 tabular-nums">
          MAJ {new Date(s.ts).toLocaleTimeString("fr-FR")}
        </span>
      </div>

      {/* Bandeau d'état */}
      <div
        className={`relative overflow-hidden rounded-2xl ring-1 ${banner.ring} bg-white/[0.03] p-4 sm:p-5 flex items-start gap-4`}
      >
        <div
          className={`pointer-events-none absolute inset-x-0 -top-16 h-32 bg-gradient-to-b ${banner.glow} blur-2xl`}
        />
        <div
          className={`relative shrink-0 w-10 h-10 rounded-xl ${banner.bar}/20 ring-1 ${banner.ring} flex items-center justify-center ${banner.text}`}
        >
          {BoltIcon}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className={`text-sm sm:text-base font-semibold ${banner.text}`}>
            {bannerTitle}
          </div>
          <div className="text-xs sm:text-sm text-zinc-400 mt-0.5">{bannerSub}</div>
        </div>
        <Link
          href="/flow"
          className="relative hidden sm:inline-flex btn-ghost text-xs"
        >
          Voir le flux →
        </Link>
      </div>

      {/* KPIs principaux */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile
          label="Production"
          value={fmtW(s.productionW)}
          tone="good"
          icon={SunIcon}
        />
        <Tile
          label="Consommation"
          value={fmtW(s.consumptionW)}
          tone="info"
          icon={HouseIcon}
        />
        <Tile
          label="Surplus"
          value={fmtW(s.surplusW)}
          tone={surplusTone}
          hint={s.surplusW !== null && s.surplusW > 0 ? "exportable" : undefined}
          icon={BoltIcon}
        />
        <Tile
          label="Batterie SoC"
          value={fmtPct(s.batterySoc)}
          tone={socTone}
          icon={BattIcon}
        />
      </div>

      {/* KPIs secondaires */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile
          label="Réseau (signé)"
          value={fmtW(s.gridW)}
          hint={
            s.gridW === null
              ? undefined
              : s.gridW > 0
                ? "import depuis le réseau"
                : "export vers le réseau"
          }
          tone={gridTone}
          icon={PlugIcon}
        />
        <Tile
          label="Puissance batterie"
          value={fmtW(s.batteryPowerW)}
          hint={
            s.batteryPowerW === null
              ? undefined
              : s.batteryPowerW > 30
                ? "décharge"
                : s.batteryPowerW < -30
                  ? "charge"
                  : "veille"
          }
          tone={battCharging || battDischarging ? "info" : "default"}
          icon={BattIcon}
        />
        <Tile
          label="Prise AC batterie"
          value={s.switchOn === null ? "—" : s.switchOn ? "ON" : "OFF"}
          tone={s.switchOn ? "good" : "default"}
          icon={SwitchIcon}
        />
        <Tile
          label="Mode pilotage"
          value={s.controlMode}
          tone="info"
          icon={GearIcon}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 pt-2">
        <Link href="/flow" className="btn-ghost justify-center">Flux d&rsquo;énergie</Link>
        <Link href="/history" className="btn-ghost justify-center">Historique</Link>
        <Link href="/control" className="btn-ghost justify-center">Pilotage</Link>
        <Link href="/agent" className="btn-ghost justify-center">Agent IA</Link>
      </div>

      <p className="text-xs text-zinc-500">
        Données rafraîchies à chaque chargement (server component).
      </p>
    </div>
  );
}
