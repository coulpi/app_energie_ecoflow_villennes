import { prisma } from "./prisma";

const BATTERY_CAPACITY_WH = 2016; // Delta Max 2000

/**
 * Estime la puissance batterie depuis la dérive du SoC.
 * Convention : + = décharge (sortie AC), - = charge.
 *
 * Le BMS Delta Max ne donne que des SoC entiers (résolution 1 %), ce
 * qui rend les fenêtres courtes très bruyantes. On cherche donc le 1er
 * échantillon dans le passé dont le SoC diffère du SoC courant, en
 * remontant jusqu'à 60 min, pour mesurer l'instant exact d'un tick.
 *
 * Méthode :
 *   - On prend le tick le plus récent où le SoC change (newest).
 *   - On prend l'avant-dernier tick (older) où le SoC est encore différent
 *     de celui d'avant.
 *   - Le ΔSoC entre les deux ticks (1 % typiquement), divisé par le temps
 *     écoulé, donne une moyenne de puissance entre ces deux ticks. C'est
 *     la valeur la moins bruyante qu'on puisse extraire d'un signal entier.
 */
async function estimateBatteryFromSocDrift(): Promise<number | null> {
  const now = Date.now();
  const since = new Date(now - 60 * 60_000);
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

  // Identifie les "ticks" (transitions de valeur SoC).
  type Tick = { ts: Date; soc: number };
  const ticks: Tick[] = [];
  let prev: number | null = null;
  for (const s of samples) {
    if (s.soc === null) continue;
    if (prev === null || s.soc !== prev) {
      ticks.push({ ts: s.ts, soc: s.soc });
      prev = s.soc;
    }
  }
  if (ticks.length < 2) return 0; // SoC stable depuis 1h → batterie idle

  // Pour stabiliser, on moyenne la pente sur les N derniers intervalles
  // entre ticks consécutifs (max 6 = ~30 min de données généralement).
  const N = Math.min(6, ticks.length - 1);
  let sumWattsSigned = 0;
  let count = 0;
  for (let i = ticks.length - 1; i > ticks.length - 1 - N; i--) {
    const cur = ticks[i]!;
    const prev = ticks[i - 1]!;
    const minutesElapsed = (cur.ts.getTime() - prev.ts.getTime()) / 60_000;
    if (minutesElapsed < 0.5) continue;
    const deltaSoc = cur.soc - prev.soc;
    const deltaWh = (deltaSoc / 100) * BATTERY_CAPACITY_WH;
    const watts = (deltaWh * 60) / minutesElapsed;
    sumWattsSigned += watts;
    count += 1;
  }
  if (count === 0) return null;
  const avgWatts = sumWattsSigned / count;

  const last = ticks[ticks.length - 1]!;
  const sinceLastTick = (now - last.ts.getTime()) / 60_000;
  if (sinceLastTick > 15) return -avgWatts * 0.3;
  // SoC monte → charge (powerW négatif). SoC descend → décharge (powerW positif).
  return -avgWatts;
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
  let batteryPowerW: number | null = bat?.powerW ?? null;

  // 1) Source la plus fiable : prise AC quand elle est ON (batterie en charge).
  if ((batteryPowerW === null || batteryPowerW === 0) && sw) {
    if (sw.switchOn === true && sw.powerW !== null && sw.powerW > 5) {
      batteryPowerW = -sw.powerW;
    }
  }
  // Surplus : ce qui sort vers le réseau si grid signé < 0, sinon
  // production - consommation (équivalent).
  const surplusW =
    gridW !== null
      ? -gridW
      : productionW !== null && consumptionW !== null
        ? productionW - consumptionW
        : null;

  // Si conso, prod et grid sont tous mesurés directement, le bilan
  // énergétique donne la batterie de manière exacte :
  //   bat_signed = consumption - production - grid_signed
  // Cette estimation est plus précise que la dérive SoC (résolution 1%).
  // 2) Estimation par dérive du SoC (moyenne sur derniers ticks). Plus
  //    fiable que le bilan énergétique tant que les capteurs grid/conso
  //    ne sont pas tous concordants entre eux.
  if (batteryPowerW === null || batteryPowerW === 0) {
    const estimated = await estimateBatteryFromSocDrift();
    if (estimated !== null) batteryPowerW = estimated;
  }

  // Si une mesure (prod, conso, ou grid) manque, on dérive depuis le bilan.
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
