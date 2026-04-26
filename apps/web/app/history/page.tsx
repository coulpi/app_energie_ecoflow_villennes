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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Historique (7 derniers jours)</h1>
      <p className="text-sm text-zinc-400">
        Agrégats horaires. Les graphiques arriveront dans une itération
        ultérieure (recharts est déjà installé).
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead className="text-zinc-400">
            <tr>
              <th className="text-left p-2">Heure</th>
              <th className="text-left p-2">Équipement</th>
              <th className="text-right p-2">Moy. W</th>
              <th className="text-right p-2">Prod Wh</th>
              <th className="text-right p-2">Conso Wh</th>
              <th className="text-right p-2">SoC min/max</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id.toString()} className="border-t border-zinc-800">
                <td className="p-2 font-mono">
                  {r.hourTs.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="p-2">{r.device.name}</td>
                <td className="p-2 text-right tabular-nums">
                  {r.avgPowerW?.toFixed(0) ?? "—"}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {r.prodWh?.toFixed(0) ?? "—"}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {r.consoWh?.toFixed(0) ?? "—"}
                </td>
                <td className="p-2 text-right tabular-nums">
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
  );
}
