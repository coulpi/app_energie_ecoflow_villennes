import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await prisma.readingHourly.findMany({
    where: { hourTs: { gte: since } },
    include: { device: true },
    orderBy: [{ hourTs: "desc" }],
    take: 200,
  });

  return (
    <div className="space-y-5 sm:space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="page-h1">Historique</h1>
        <p className="page-sub mt-1">
          Agrégats horaires sur 7 jours. Graphiques bientôt disponibles
          (recharts déjà installé).
        </p>
      </div>
      <div className="card p-0 overflow-hidden">
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
              {rows.map((r) => (
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
