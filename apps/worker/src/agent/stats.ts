import { prisma } from "../db.js";
import { dayOfWeek } from "@app/shared";

/**
 * Calcule la consommation moyenne (Wh) par (jour de la semaine, heure)
 * sur les N dernières semaines, à partir de ReadingHourly du compteur conso.
 */
export async function weeklyConsumptionPattern(
  weeks = 4,
): Promise<{ dow: number; hour: number; avgWh: number; samples: number }[]> {
  const since = new Date(Date.now() - weeks * 7 * 86_400_000);
  const cons = await prisma.device.findFirst({
    where: { enabled: true, role: "CONSUMPTION_METER" },
  });
  if (!cons) return [];

  const rows = await prisma.readingHourly.findMany({
    where: { deviceId: cons.id, hourTs: { gte: since } },
    select: { hourTs: true, consoWh: true, avgPowerW: true },
  });

  const buckets = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const dow = dayOfWeek(r.hourTs);
    const hour = r.hourTs.getHours();
    const key = `${dow}-${hour}`;
    const w = r.consoWh ?? r.avgPowerW ?? 0; // fallback : moyenne en W ≈ Wh sur 1h
    const cur = buckets.get(key) ?? { sum: 0, n: 0 };
    cur.sum += w;
    cur.n += 1;
    buckets.set(key, cur);
  }

  const out: ReturnType<typeof weeklyConsumptionPattern> extends Promise<
    infer T
  >
    ? T
    : never = [];
  for (let dow = 1; dow <= 7; dow++) {
    for (let h = 0; h < 24; h++) {
      const b = buckets.get(`${dow}-${h}`);
      out.push({
        dow,
        hour: h,
        avgWh: b ? b.sum / b.n : 0,
        samples: b?.n ?? 0,
      });
    }
  }
  return out;
}

export async function lastSnapshot(): Promise<{
  productionW: number | null;
  consumptionW: number | null;
  gridW: number | null;
  batterySoc: number | null;
  batteryPowerW: number | null;
  switchOn: boolean | null;
}> {
  const since = new Date(Date.now() - 5 * 60_000);
  const last = async (role: string) => {
    const d = await prisma.device.findFirst({
      where: { enabled: true, role: role as never },
      include: {
        readings: {
          where: { ts: { gte: since } },
          orderBy: { ts: "desc" },
          take: 1,
        },
      },
    });
    return d?.readings[0] ?? null;
  };
  const [prod, cons, grid, bat, sw] = await Promise.all([
    last("PRODUCTION_METER"),
    last("CONSUMPTION_METER"),
    last("GRID_METER"),
    last("BATTERY"),
    last("BATTERY_AC_SWITCH"),
  ]);
  return {
    productionW: prod?.powerW ?? null,
    consumptionW: cons?.powerW ?? null,
    gridW: grid?.powerW ?? null,
    batterySoc: bat?.soc ?? null,
    batteryPowerW: bat?.powerW ?? null,
    switchOn: sw?.switchOn ?? null,
  };
}
