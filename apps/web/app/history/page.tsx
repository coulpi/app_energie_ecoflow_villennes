import { prisma } from "@/lib/prisma";
import HistoryChart, { type HistoryPoint } from "./HistoryChart";

export const dynamic = "force-dynamic";

function fmtLabel(d: Date): string {
  const dd = d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Paris",
  });
  const hh = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    timeZone: "Europe/Paris",
  });
  return `${dd} ${hh}`;
}

export default async function HistoryPage() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await prisma.readingHourly.findMany({
    where: { hourTs: { gte: since } },
    include: { device: true },
    orderBy: [{ hourTs: "asc" }],
  });

  // Agrégation par heure : somme prod/conso, moyenne SoC.
  const byHour = new Map<
    string,
    { ts: Date; prod: number; conso: number; socSum: number; socCount: number }
  >();
  for (const r of rows) {
    const key = r.hourTs.toISOString();
    const slot = byHour.get(key) ?? {
      ts: r.hourTs,
      prod: 0,
      conso: 0,
      socSum: 0,
      socCount: 0,
    };
    if (r.prodWh) slot.prod += r.prodWh;
    if (r.consoWh) slot.conso += r.consoWh;
    if (r.minSoc !== null && r.maxSoc !== null) {
      slot.socSum += (r.minSoc + r.maxSoc) / 2;
      slot.socCount += 1;
    }
    byHour.set(key, slot);
  }

  const points: HistoryPoint[] = Array.from(byHour.values())
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((s) => ({
      ts: s.ts.toISOString(),
      label: fmtLabel(s.ts),
      prodWh: Math.round(s.prod),
      consoWh: Math.round(s.conso),
      soc: s.socCount > 0 ? Math.round(s.socSum / s.socCount) : null,
    }));

  // Bilans 7 jours
  const totalProd = points.reduce((acc, p) => acc + p.prodWh, 0);
  const totalConso = points.reduce((acc, p) => acc + p.consoWh, 0);

  // Lignes du tableau : 200 dernières
  const lastRows = [...rows]
    .sort((a, b) => b.hourTs.getTime() - a.hourTs.getTime())
    .slice(0, 200);

  return (
    <div className="space-y-5 sm:space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="page-h1">Historique</h1>
          <p className="page-sub mt-1">
            Agrégats horaires sur les 7 derniers jours.
          </p>
        </div>
        <div className="flex gap-3 text-xs text-zinc-400">
          <span>
            Produit{" "}
            <span className="text-emerald-300 font-semibold tabular-nums">
              {(totalProd / 1000).toFixed(1)} kWh
            </span>
          </span>
          <span>
            Consommé{" "}
            <span className="text-sky-300 font-semibold tabular-nums">
              {(totalConso / 1000).toFixed(1)} kWh
            </span>
          </span>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="card text-sm text-zinc-500">
          Aucune donnée agrégée pour la période. Les agrégats horaires sont
          calculés par le worker.
        </div>
      ) : (
        <HistoryChart data={points} />
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          Dernières lignes par équipement
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm w-full min-w-[640px]">
            <thead className="text-zinc-400 bg-white/[0.02]">
              <tr>
                <th className="text-left p-3 font-medium">Heure</th>
                <th className="text-left p-3 font-medium">Équipement</th>
                <th className="text-right p-3 font-medium">Moy. W</th>
                <th className="text-right p-3 font-medium">Prod Wh</th>
                <th className="text-right p-3 font-medium">Conso Wh</th>
                <th className="text-right p-3 font-medium">SoC min/max</th>
              </tr>
            </thead>
            <tbody>
              {lastRows.map((r) => (
                <tr
                  key={r.id.toString()}
                  className="border-t border-white/[0.05] hover:bg-white/[0.02]"
                >
                  <td className="p-3 font-mono text-xs whitespace-nowrap">
                    {r.hourTs.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="p-3">{r.device.name}</td>
                  <td className="p-3 text-right tabular-nums">
                    {r.avgPowerW?.toFixed(0) ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums text-emerald-300">
                    {r.prodWh?.toFixed(0) ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums text-sky-300">
                    {r.consoWh?.toFixed(0) ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {r.minSoc !== null && r.maxSoc !== null
                      ? `${r.minSoc.toFixed(0)} / ${r.maxSoc.toFixed(0)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
