import { getDashboardSnapshot } from "@/lib/snapshot";
import { computeCosts, periodRange } from "@/lib/costs";
import { getAlerts, getEquipmentStates, getSeries, getTodayEnergy } from "@/lib/dashboard";
import DashboardView from "./DashboardView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const today = periodRange("today");
  const [snapshot, energy, costs, alerts, equipment, series] = await Promise.all([
    getDashboardSnapshot(),
    getTodayEnergy(),
    computeCosts(today.from, today.to),
    getAlerts(),
    getEquipmentStates(),
    getSeries(24),
  ]);
  return (
    <DashboardView
      initial={snapshot}
      energy={energy}
      cost={{
        total: costs.house.totalEur + costs.aux.totalEur,
        house: costs.house.totalEur,
        aux: costs.aux.totalEur,
      }}
      alerts={alerts.map((a) => ({ ...a, at: a.at?.toISOString() ?? null }))}
      equipment={equipment}
      series={series}
    />
  );
}
