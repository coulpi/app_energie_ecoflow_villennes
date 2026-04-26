import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";

/** Agrège les Reading bruts en moyennes/sommes horaires puis purge. */
export async function runRollupOnce(now = new Date()): Promise<void> {
  const hourFloor = new Date(now);
  hourFloor.setMinutes(0, 0, 0);
  // On agrège l'heure précédente complète (évite les agrégats partiels).
  const targetEnd = new Date(hourFloor);
  const targetStart = new Date(targetEnd);
  targetStart.setHours(targetStart.getHours() - 1);

  const devices = await prisma.device.findMany({ where: { enabled: true } });

  for (const d of devices) {
    const rows = await prisma.reading.findMany({
      where: {
        deviceId: d.id,
        ts: { gte: targetStart, lt: targetEnd },
      },
      select: { powerW: true, soc: true, ts: true },
    });
    if (rows.length === 0) continue;

    const powers = rows
      .map((r) => r.powerW)
      .filter((p): p is number => p !== null && p !== undefined);
    const socs = rows
      .map((r) => r.soc)
      .filter((s): s is number => s !== null && s !== undefined);

    const avgPowerW =
      powers.length > 0
        ? powers.reduce((a, b) => a + b, 0) / powers.length
        : null;

    // Énergie ≈ moyenne(W) * 1h ; séparée prod/conso selon le rôle.
    let prodWh: number | null = null;
    let consoWh: number | null = null;
    if (avgPowerW !== null) {
      const e = avgPowerW; // 1h → Wh = W
      if (d.role === "PRODUCTION_METER") prodWh = Math.max(0, e);
      else if (d.role === "CONSUMPTION_METER") consoWh = Math.max(0, e);
    }

    await prisma.readingHourly.upsert({
      where: { deviceId_hourTs: { deviceId: d.id, hourTs: targetStart } },
      create: {
        deviceId: d.id,
        hourTs: targetStart,
        avgPowerW,
        prodWh,
        consoWh,
        minSoc: socs.length ? Math.min(...socs) : null,
        maxSoc: socs.length ? Math.max(...socs) : null,
        samples: rows.length,
      },
      update: {
        avgPowerW,
        prodWh,
        consoWh,
        minSoc: socs.length ? Math.min(...socs) : null,
        maxSoc: socs.length ? Math.max(...socs) : null,
        samples: rows.length,
      },
    });
  }

  // Purge des Reading bruts au-delà de la rétention.
  const cutoffRaw = new Date(
    now.getTime() - env.RAW_RETENTION_DAYS * 86_400_000,
  );
  const { count: rawDeleted } = await prisma.reading.deleteMany({
    where: { ts: { lt: cutoffRaw } },
  });

  // Purge des agrégats horaires au-delà de la rétention longue.
  const cutoffHourly = new Date(
    now.getTime() - env.HOURLY_RETENTION_DAYS * 86_400_000,
  );
  const { count: hourlyDeleted } = await prisma.readingHourly.deleteMany({
    where: { hourTs: { lt: cutoffHourly } },
  });

  log.info("rollup completed", { rawDeleted, hourlyDeleted });
}

export function startRollupScheduler(): NodeJS.Timeout {
  // Fait tourner toutes les 5 min : la première occurrence après le début
  // d'une nouvelle heure traite l'heure complète qui vient de s'écouler.
  return setInterval(
    () =>
      runRollupOnce().catch((e) =>
        log.error("rollup error", { error: (e as Error).message }),
      ),
    5 * 60 * 1000,
  );
}
