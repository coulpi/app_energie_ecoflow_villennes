import { prisma } from "./prisma";

export interface DashboardSnapshot {
  ts: string;
  productionW: number | null;
  consumptionW: number | null;
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

  const [prod, cons, bat, sw, ctrl] = await Promise.all([
    lastByRole("PRODUCTION_METER"),
    lastByRole("CONSUMPTION_METER"),
    lastByRole("BATTERY"),
    lastByRole("BATTERY_AC_SWITCH"),
    prisma.controlState.findUnique({ where: { key: "default" } }),
  ]);

  const productionW = prod?.powerW ?? null;
  const consumptionW = cons?.powerW ?? null;
  const surplusW =
    productionW !== null && consumptionW !== null
      ? productionW - consumptionW
      : null;

  return {
    ts: new Date().toISOString(),
    productionW,
    consumptionW,
    surplusW,
    batterySoc: bat?.soc ?? null,
    batteryPowerW: bat?.powerW ?? null,
    switchOn: sw?.switchOn ?? null,
    controlMode: ctrl?.mode ?? "RULES",
    tariffPeriod: null,
  };
}
