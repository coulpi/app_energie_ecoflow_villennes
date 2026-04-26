import { prisma } from "./prisma";

const BATTERY_CAPACITY_WH = 2016; // Delta Max 2000

/**
 * Estime la puissance batterie depuis la dérive du SoC sur 10-15 min.
 * Convention : + = décharge (sortie AC), - = charge.
 */
async function estimateBatteryFromSocDrift(): Promise<number | null> {
  const now = Date.now();
  const since = new Date(now - 20 * 60_000);
  const battery = await prisma.device.findFirst({
    where: { enabled: true, role: "BATTERY" },
  });
  if (!battery) return null;
  const samples = await prisma.reading.findMany({
    where: {
      deviceId: battery.id,
      ts: { gte: since },
      soc: { not: null },
    },
    orderBy: { ts: "asc" },
    select: { ts: true, soc: true },
  });
  if (samples.length < 2) return null;

  const newest = samples[samples.length - 1]!;
  // On cherche un échantillon entre 5 et 15 min avant le plus récent.
  const tNew = newest.ts.getTime();
  let oldest: { ts: Date; soc: number | null } | null = null;
  for (const s of samples) {
    const dt = (tNew - s.ts.getTime()) / 60_000;
    if (dt >= 5 && dt <= 20) {
      oldest = s;
      break;
    }
  }
  if (!oldest || oldest.soc === null || newest.soc === null) return null;

  const minutesElapsed = (tNew - oldest.ts.getTime()) / 60_000;
  if (minutesElapsed < 5) return null;

  const deltaSoc = newest.soc - oldest.soc; // % positif = chargé
  if (Math.abs(deltaSoc) < 0.5) return 0; // pas de dérive significative
  const deltaWh = (deltaSoc / 100) * BATTERY_CAPACITY_WH;
  const watts = (deltaWh * 60) / minutesElapsed;
  // SoC monte → charge (puissance batterie négative dans notre convention).
  // SoC descend → décharge (puissance positive).
  return -watts;
}

export interface DashboardSnapshot {
  ts: string;
  productionW: number | null;
  consumptionW: number | null;
  gridW: number | null; // signé : + import, - export
  surplusW: number | null;
  batterySoc: number | null;
  batteryPowerW: number | null;
  switchOn: boolean | null;
  controlMode: string;
  tariffPeriod: string | null;
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const since = new Date(Date.now() - 5 * 60_000);

  const lastByRole = async (role: string) => {
    const dev = await prisma.device.findFirst({
      where: { enabled: true, role: role as never },
      include: {
        readings: {
          where: { ts: { gte: since } },
          orderBy: { ts: "desc" },
          take: 1,
        },
      },
    });
    return dev?.readings[0] ?? null;
  };

  const [prod, cons, grid, bat, sw, ctrl] = await Promise.all([
    lastByRole("PRODUCTION_METER"),
    lastByRole("CONSUMPTION_METER"),
    lastByRole("GRID_METER"),
    lastByRole("BATTERY"),
    lastByRole("BATTERY_AC_SWITCH"),
    prisma.controlState.findUnique({ where: { key: "default" } }),
  ]);

  let productionW = prod?.powerW ?? null;
  let gridW = grid?.powerW ?? null;
  let consumptionW = cons?.powerW ?? null;
  // Calcule batteryPowerW d'abord (logique plus bas), nécessaire pour
  // une dérivation correcte de la consommation.
  let batteryPowerW: number | null = bat?.powerW ?? null;
  if ((batteryPowerW === null || batteryPowerW === 0) && sw) {
    if (sw.switchOn === true && sw.powerW !== null && sw.powerW > 5) {
      batteryPowerW = -sw.powerW;
    }
  }
  if (batteryPowerW === null || batteryPowerW === 0) {
    const estimated = await estimateBatteryFromSocDrift();
    if (estimated !== null) batteryPowerW = estimated;
  }
  // Bilan énergétique global :
  //   prod + grid_signed + bat_signed = consumption
  //   (grid_signed : + import, - export ; bat_signed : + décharge, - charge)
  const batForBalance = batteryPowerW ?? 0;
  if (consumptionW === null && productionW !== null && gridW !== null) {
    consumptionW = productionW + gridW + batForBalance;
  }
  if (productionW === null && consumptionW !== null && gridW !== null) {
    productionW = Math.max(0, consumptionW - gridW - batForBalance);
  }
  if (gridW === null && productionW !== null && consumptionW !== null) {
    gridW = consumptionW - productionW - batForBalance;
  }
  // Surplus : ce qui sort vers le réseau si grid signé < 0, sinon
  // production - consommation (équivalent).
  const surplusW =
    gridW !== null
      ? -gridW
      : productionW !== null && consumptionW !== null
        ? productionW - consumptionW
        : null;

  // Puissance batterie déjà calculée plus haut pour le bilan.

  return {
    ts: new Date().toISOString(),
    productionW,
    consumptionW,
    gridW,
    surplusW,
    batterySoc: bat?.soc ?? null,
    batteryPowerW,
    switchOn: sw?.switchOn ?? null,
    controlMode: ctrl?.mode ?? "RULES",
    tariffPeriod: null,
  };
}
