import { getDashboardSnapshot } from "@/lib/snapshot";
import EnergyFlow from "./EnergyFlow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FlowPage() {
  const snapshot = await getDashboardSnapshot();
  return <EnergyFlow initial={snapshot} />;
}
