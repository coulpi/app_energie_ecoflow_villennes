import { getDashboardSnapshot } from "@/lib/snapshot";
import AutoRefresh from "./AutoRefresh";

// Vue plein écran pour afficheur ESP32-S3 (480×480 ou 800×480) ou tout
// navigateur. Auto-refresh toutes les 10 s.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "EcoFlow Kiosk",
  other: {
    "http-equiv": "refresh",
  },
};

function fmt(v: number | null, unit: string) {
  return v === null ? "—" : `${Math.round(v)} ${unit}`;
}

export default async function KioskPage() {
  const s = await getDashboardSnapshot();

  return (
    <>
      <AutoRefresh seconds={10} />
      <style>{`
        header { display: none !important; }
        main { padding: 0 !important; }
        body { overflow: hidden; }
      `}</style>
      <div
        className="fixed inset-0 grid grid-cols-2 grid-rows-2 gap-1 bg-black"
        style={{ height: "100vh", width: "100vw" }}
      >
        <Cell label="Production" value={fmt(s.productionW, "W")} tone="good" />
        <Cell label="Conso" value={fmt(s.consumptionW, "W")} />
        <Cell
          label="Surplus"
          value={fmt(s.surplusW, "W")}
          tone={
            s.surplusW === null
              ? "neutral"
              : s.surplusW > 0
                ? "good"
                : "warn"
          }
        />
        <Cell
          label="Batterie"
          value={fmt(s.batterySoc, "%")}
          tone={
            s.batterySoc === null
              ? "neutral"
              : s.batterySoc < 20
                ? "bad"
                : s.batterySoc > 80
                  ? "good"
                  : "neutral"
          }
        />
      </div>
      <div className="fixed bottom-1 right-2 text-[11px] text-zinc-600 font-mono">
        {s.switchOn ? "AC ON" : "AC OFF"} · {s.controlMode} ·{" "}
        {new Date(s.ts).toLocaleTimeString("fr-FR")}
      </div>
    </>
  );
}

function Cell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const color = {
    good: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-rose-400",
    neutral: "text-zinc-100",
  }[tone];
  return (
    <div className="flex flex-col items-center justify-center bg-zinc-950 border border-zinc-900">
      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2">
        {label}
      </div>
      <div className={`text-6xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
