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

  // Stratégie robuste pour signal entier (résolution 1 % du SoC) :
  // on calcule directement le ΔSoC entre le 1er et le dernier tick de la
  // fenêtre, divisé par le temps total. Cela évite que la moyenne par
  // intervalle ne sur-pondère les ticks rapides.
  const first = ticks[0]!;
  const last = ticks[ticks.length - 1]!;
  const minutesTotal = (last.ts.getTime() - first.ts.getTime()) / 60_000;
  if (minutesTotal < 1) return null;
  const deltaSocTotal = last.soc - first.soc;
  const deltaWhTotal = (deltaSocTotal / 100) * BATTERY_CAPACITY_WH;
  const avgWatts = (deltaWhTotal * 60) / minutesTotal;

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
  acSwitchPowerW: number | null;
  controlMode: string;
  followLoadOffsetW: number | null;
  followLoadMinW: number | null;
  followLoadMaxW: number | null;
  chargeMaxW: number | null;
  chargeMinW: number | null;
  chargeOffsetW: number | null;
  chargeDeficitTimeoutMin: number | null;
  chargeOffToOnLockMin: number | null;
  tempoEnabled: boolean | null;
  tempoColor: string | null;
  tempoColorTomorrow: string | null;
  tempoRedDischargeHour: number | null;
  tempoOtherDischargeHour: number | null;
  tempoDischargeEndHour: number | null;
  tempoDischargeTargetW: number | null;
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
  const measuredConsumptionW = cons?.powerW ?? null;
  let consumptionW: number | null = null; // sera calculé par bilan
  let batteryPowerW: number | null = bat?.powerW ?? null;

  // (0) Priorité absolue : si la prise AC est ON et rapporte une conso
  // significative, c'est la mesure la plus fiable de la charge en cours.
  // Le BMS Delta Max envoie parfois des pics transitoires sur amp×vol DC
  // (vu jusqu'à 2.1 kW alors que la prise AC en passe 500). On préfère
  // la mesure AC réelle en entrée de batterie.
  if (sw?.switchOn === true && sw.powerW !== null && sw.powerW > 30) {
    batteryPowerW = -sw.powerW;
  }

  // 1) Si l'API privée (BMS) ne donne rien, on tente le bilan énergétique.
  if (
    batteryPowerW === null &&
    measuredConsumptionW !== null &&
    productionW !== null &&
    gridW !== null
  ) {
    const balanceBat = measuredConsumptionW - productionW - gridW;
    if (Math.abs(balanceBat) > 30) {
      batteryPowerW = Math.max(-2200, Math.min(2200, balanceBat));
    } else {
      batteryPowerW = 0;
    }
  }

  // 2) Si toujours rien, prise AC charging (ON + powerW > 5).
  if (batteryPowerW === null && sw) {
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
  // 3) Dernier recours : dérive du SoC (1% de résolution → bruyant).
  if (batteryPowerW === null) {
    const estimated = await estimateBatteryFromSocDrift();
    if (estimated !== null) batteryPowerW = estimated;
  }

  // === GUARDS APPLIQUÉS À LA FIN (après toutes les sources) ===
  // (a) Seuil 30 W : la consommation interne du BMS / inverter EcoFlow ne
  //     doit pas être interprétée comme une décharge utile.
  if (batteryPowerW !== null && Math.abs(batteryPowerW) < 30) {
    batteryPowerW = 0;
  }
  // (b) Cohérence prise AC : si la prise est OFF, la batterie ne peut pas
  //     se charger via AC. Toute valeur "charging" est rejetée.
  if (
    sw?.switchOn === false &&
    batteryPowerW !== null &&
    batteryPowerW < 0
  ) {
    batteryPowerW = 0;
  }

  // Conso maison = ce qui passe physiquement au point de livraison
  //   consumption = production + grid_signed + powerstream_output
  // (le PowerStream injecte sur le réseau maison depuis la batterie ; il
  //  réduit l'import grid sans réduire la conso physique réelle, on doit
  //  donc le rajouter au bilan).
  const psW = (ctrl as { powerstreamPermanentW?: number } | null)?.powerstreamPermanentW ?? 0;
  if (productionW !== null && gridW !== null) {
    consumptionW = productionW + gridW + psW;
  } else if (measuredConsumptionW !== null) {
    consumptionW = measuredConsumptionW;
  }
  if (productionW === null && consumptionW !== null && gridW !== null) {
    productionW = Math.max(0, consumptionW - gridW - psW);
  }
  if (gridW === null && productionW !== null && consumptionW !== null) {
    gridW = consumptionW - productionW - psW;
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
    acSwitchPowerW: sw?.powerW ?? null,
    controlMode: ctrl?.mode ?? "RULES",
    followLoadOffsetW: ctrl?.followLoadOffsetW ?? null,
    followLoadMinW: ctrl?.followLoadMinW ?? null,
    followLoadMaxW: ctrl?.followLoadMaxW ?? null,
    chargeMaxW: (ctrl as { chargeMaxW?: number } | null)?.chargeMaxW ?? null,
    chargeMinW: (ctrl as { chargeMinW?: number } | null)?.chargeMinW ?? null,
    chargeOffsetW: (ctrl as { chargeOffsetW?: number } | null)?.chargeOffsetW ?? null,
    chargeDeficitTimeoutMin:
      (ctrl as { chargeDeficitTimeoutMin?: number } | null)?.chargeDeficitTimeoutMin ?? null,
    chargeOffToOnLockMin:
      (ctrl as { chargeOffToOnLockMin?: number } | null)?.chargeOffToOnLockMin ?? null,
    tempoEnabled: (ctrl as { tempoEnabled?: boolean } | null)?.tempoEnabled ?? null,
    tempoColor: (ctrl as { tempoColor?: string } | null)?.tempoColor ?? null,
    tempoColorTomorrow:
      (ctrl as { tempoColorTomorrow?: string } | null)?.tempoColorTomorrow ?? null,
    tempoRedDischargeHour:
      (ctrl as { tempoRedDischargeHour?: number } | null)?.tempoRedDischargeHour ?? null,
    tempoOtherDischargeHour:
      (ctrl as { tempoOtherDischargeHour?: number } | null)?.tempoOtherDischargeHour ?? null,
    tempoDischargeEndHour:
      (ctrl as { tempoDischargeEndHour?: number } | null)?.tempoDischargeEndHour ?? null,
    tempoDischargeTargetW:
      (ctrl as { tempoDischargeTargetW?: number } | null)?.tempoDischargeTargetW ?? null,
    tariffPeriod: null,
  };
}
