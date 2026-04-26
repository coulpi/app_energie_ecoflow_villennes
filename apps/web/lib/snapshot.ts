import { prisma } from "./prisma";

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
  // Dérivation : selon les capteurs disponibles, on complète une mesure
  // manquante à partir des deux autres.
  //   net_grid = consumption - production  (+ = import, - = export)
  if (consumptionW === null && productionW !== null && gridW !== null) {
    consumptionW = productionW + gridW;
  }
  if (productionW === null && consumptionW !== null && gridW !== null) {
    productionW = Math.max(0, consumptionW - gridW);
  }
  if (gridW === null && productionW !== null && consumptionW !== null) {
    gridW = consumptionW - productionW;
  }
  // Surplus : ce qui sort vers le réseau si grid signé < 0, sinon
  // production - consommation (équivalent).
  const surplusW =
    gridW !== null
      ? -gridW
      : productionW !== null && consumptionW !== null
        ? productionW - consumptionW
        : null;

  // Puissance batterie : préférer la valeur du BMS, sinon dériver depuis
  // la prise AC. Le BMS Delta Max remonte souvent 0 W via MQTT alors que
  // la batterie charge réellement — la prise AC en amont, elle, mesure la
  // consommation réelle du chargeur (signe inversé : prise consomme >0
  // = batterie charge donc powerW négatif côté batterie).
  let batteryPowerW: number | null = bat?.powerW ?? null;
  if ((batteryPowerW === null || batteryPowerW === 0) && sw) {
    if (sw.switchOn === true && sw.powerW !== null && sw.powerW > 5) {
      batteryPowerW = -sw.powerW;
    }
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
