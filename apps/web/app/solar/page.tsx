import { prisma } from "@/lib/prisma";
import SolarDashboard from "./SolarDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SolarPage() {
  const inverters = await prisma.device.findMany({
    where: { enabled: true, type: "APSYSTEMS_INVERTER" },
    orderBy: { name: "asc" },
  });

  // Dernière lecture par (deviceId, panelIndex)
  const latestPanels = await Promise.all(
    inverters.map(async (inv) => {
      const reads = await prisma.solarPanelReading.findMany({
        where: { deviceId: inv.id },
        orderBy: { ts: "desc" },
        take: 16, // assez pour les 8 panneaux max × 2 lectures récentes
      });
      const seen = new Set<number>();
      const latest = reads.filter((r) => {
        if (seen.has(r.panelIndex)) return false;
        seen.add(r.panelIndex);
        return true;
      });
      return { inv, latest };
    }),
  );

  // Série 24h pour graphe agrégé : on bucketise à la minute pour ne pas
  // surcharger le payload (max 1440 points par panneau).
  const since = new Date(Date.now() - 24 * 3600_000);
  const seriesByInverter = await Promise.all(
    inverters.map(async (inv) => {
      const rows = await prisma.solarPanelReading.findMany({
        where: { deviceId: inv.id, ts: { gte: since } },
        orderBy: { ts: "asc" },
        select: { ts: true, panelIndex: true, pW: true },
      });
      // Bucket 5 min
      const bucketMs = 5 * 60_000;
      const map = new Map<
        number,
        Map<number, { sum: number; count: number }>
      >();
      for (const r of rows) {
        if (typeof r.pW !== "number") continue;
        const k = Math.floor(r.ts.getTime() / bucketMs) * bucketMs;
        let panels = map.get(k);
        if (!panels) {
          panels = new Map();
          map.set(k, panels);
        }
        const cur = panels.get(r.panelIndex) ?? { sum: 0, count: 0 };
        cur.sum += r.pW;
        cur.count += 1;
        panels.set(r.panelIndex, cur);
      }
      const points = Array.from(map.entries())
        .sort(([a], [b]) => a - b)
        .map(([k, panels]) => {
          const point: Record<string, number | string> = {
            t: new Date(k).toISOString(),
          };
          for (const [idx, agg] of panels) {
            point[`p${idx}`] = Math.round(agg.sum / agg.count);
          }
          return point;
        });
      return { inverterId: inv.id, points };
    }),
  );

  // Alertes en cours
  const openAlerts = await prisma.healthAlert.findMany({
    where: { resolvedAt: null },
    include: { device: true },
    orderBy: { startedAt: "desc" },
  });

  // Bilan jour : énergie produite par onduleur
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayEnergyByDevice = new Map<string, number>();
  for (const { inv } of latestPanels) {
    const rows = await prisma.reading.findMany({
      where: { deviceId: inv.id, ts: { gte: startOfDay } },
      orderBy: { ts: "asc" },
      select: { ts: true, powerW: true },
    });
    let wh = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      if (typeof a.powerW === "number" && typeof b.powerW === "number") {
        const dtH = (b.ts.getTime() - a.ts.getTime()) / 3_600_000;
        wh += ((a.powerW + b.powerW) / 2) * dtH;
      }
    }
    todayEnergyByDevice.set(inv.id, Math.max(0, Math.round(wh)));
  }

  return (
    <SolarDashboard
      inverters={latestPanels.map(({ inv, latest }) => ({
        id: inv.id,
        name: inv.name,
        sn: inv.externalId,
        panels: latest.map((p) => ({
          panelIndex: p.panelIndex,
          ts: p.ts.toISOString(),
          dcV: p.dcV,
          dcA: p.dcA,
          pW: p.pW,
          energyWh: p.energyWh,
          acV: p.acV,
          acHz: p.acHz,
          tempC: p.tempC,
          signalDb: p.signalDb,
        })),
        todayWh: todayEnergyByDevice.get(inv.id) ?? 0,
      }))}
      series={seriesByInverter}
      alerts={openAlerts.map((a) => ({
        id: a.id.toString(),
        deviceName: a.device.name,
        panelIndex: a.panelIndex,
        kind: a.kind,
        severity: a.severity,
        message: a.message,
        startedAt: a.startedAt.toISOString(),
      }))}
    />
  );
}
