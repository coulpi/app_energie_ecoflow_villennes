import { getDashboardSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtW(v: number | null) {
  return v === null ? "—" : `${Math.round(v)} W`;
}
function fmtPct(v: number | null) {
  return v === null ? "—" : `${Math.round(v)} %`;
}

function Tile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const ring = {
    default: "ring-zinc-700",
    good: "ring-emerald-600",
    warn: "ring-amber-600",
    bad: "ring-rose-600",
  }[tone];
  return (
    <div
      className={`rounded-2xl bg-zinc-900 ring-1 ${ring} p-5 flex flex-col gap-2`}
    >
      <span className="text-xs uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </div>
  );
}

export default async function Page() {
  const s = await getDashboardSnapshot();
  const surplusTone =
    s.surplusW === null ? "default" : s.surplusW > 0 ? "good" : "warn";
  const socTone =
    s.batterySoc === null
      ? "default"
      : s.batterySoc < 20
        ? "bad"
        : s.batterySoc > 80
          ? "good"
          : "default";

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Tableau de bord</h1>
        <span className="text-xs text-zinc-500">
          MAJ {new Date(s.ts).toLocaleTimeString("fr-FR")}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Production" value={fmtW(s.productionW)} tone="good" />
        <Tile label="Consommation" value={fmtW(s.consumptionW)} />
        <Tile
          label="Surplus"
          value={fmtW(s.surplusW)}
          tone={surplusTone}
          hint={s.surplusW !== null && s.surplusW > 0 ? "exportable" : undefined}
        />
        <Tile label="Batterie SoC" value={fmtPct(s.batterySoc)} tone={socTone} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile label="Puissance batterie" value={fmtW(s.batteryPowerW)} />
        <Tile
          label="Prise AC batterie"
          value={s.switchOn === null ? "—" : s.switchOn ? "ON" : "OFF"}
          tone={s.switchOn ? "good" : "default"}
        />
        <Tile label="Mode pilotage" value={s.controlMode} />
      </div>

      <p className="text-sm text-zinc-500">
        Données rafraîchies à chaque chargement (server component). Voir
        l'historique pour des courbes détaillées.
      </p>
    </div>
  );
}
