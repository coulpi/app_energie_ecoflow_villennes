import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDashboardSnapshot } from "@/lib/snapshot";
import { computeCosts, periodRange } from "@/lib/costs";
import { getSeries, getTodayEnergy } from "@/lib/dashboard";
import { isNetwork2 } from "@/lib/networks";
import { EnergyDonut, PowerChart } from "@/components/charts";
import {
  fmtEur,
  fmtKWh,
  fmtPower,
  Icon,
  KpiCard,
  PageHeader,
  Section,
  ShareRow,
} from "@/components/ui";

export const dynamic = "force-dynamic";



/** Conso du jour par appareil mesuré (agrégats horaires, heure en cours exclue). */
async function circuitsToday(from: Date) {
  const devices = await prisma.device.findMany({
    where: { role: { in: ["APPLIANCE", "BATTERY_AC_SWITCH"] as never } },
    select: { id: true, name: true, role: true },
  });
  const rows = await prisma.readingHourly.groupBy({
    by: ["deviceId"],
    where: { deviceId: { in: devices.map((d) => d.id) }, hourTs: { gte: from } },
    _sum: { consoWh: true },
  });
  const wh = new Map(rows.map((r) => [r.deviceId, r._sum.consoWh ?? 0]));
  return devices.map((d) => ({
    name:
      d.role === "BATTERY_AC_SWITCH"
        ? "Charge batterie"
        : d.name.replace(/^Prise\s+/i, "").replace(/^./, (c) => c.toUpperCase()),
    network: (d.role === "BATTERY_AC_SWITCH" || isNetwork2(d.name) ? 2 : 1) as 1 | 2,
    wh: wh.get(d.id) ?? 0,
    car: /voiture|ev\b|car/i.test(d.name),
  }));
}

export default async function NetworksPage() {
  const today = periodRange("today");
  const month = periodRange("month");
  const [s, energy, costToday, costMonth, series, circuits] = await Promise.all([
    getDashboardSnapshot(),
    getTodayEnergy(),
    computeCosts(today.from, today.to),
    computeCosts(month.from, month.to),
    getSeries(24),
    circuitsToday(today.from),
  ]);

  const r1W = Math.max(0, s.consumptionW ?? 0);
  const r2W = Math.max(0, s.auxNetworkW ?? 0);
  const grid = s.gridW ?? 0;
  const totalWh = energy.conso1Wh + energy.import2Wh;
  const c1 = circuits.filter((c) => c.network === 1);
  const c2 = circuits.filter((c) => c.network === 2);
  const other = (total: number, list: typeof circuits) =>
    Math.max(0, total - list.reduce((a, c) => a + c.wh, 0));

  const NetworkCard = ({
    n,
    title,
    sub,
    liveW,
    kwh,
    eurToday,
    eurMonth,
    accent,
    children,
  }: {
    n: 1 | 2;
    title: string;
    sub: string;
    liveW: number;
    kwh: number;
    eurToday: number;
    eurMonth: number;
    accent: "home" | "aux";
    children: React.ReactNode;
  }) => {
    const p = fmtPower(liveW);
    return (
      <Section
        title={title}
        sub={sub}
        action={
          <Link href={`/costs?p=month&n=${n}`} className="text-xs text-blue-400 hover:underline">
            Coûts →
          </Link>
        }
      >
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <div className="text-xs text-zinc-500">Maintenant</div>
            <div className={`text-2xl font-semibold tabular-nums ${accent === "home" ? "text-emerald-400" : "text-cyan-400"}`}>
              {p.value} <span className="text-sm text-zinc-400">{p.unit}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Aujourd&rsquo;hui</div>
            <div className="text-lg font-semibold tabular-nums text-zinc-100">{fmtKWh(kwh)}</div>
            <div className="text-xs text-zinc-500">{fmtEur(eurToday)}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Ce mois-ci</div>
            <div className="text-lg font-semibold tabular-nums text-zinc-100">{fmtEur(eurMonth)}</div>
            <div className="text-xs text-zinc-500">abonnement inclus</div>
          </div>
        </div>
        <div className="border-t pt-3" style={{ borderColor: "var(--hairline)" }}>
          <div className="card-kicker mb-1">Consommation par circuit · aujourd&rsquo;hui</div>
          {children}
        </div>
      </Section>
    );
  };

  const share = (wh: number, total: number) => (total > 0 ? (wh / total) * 100 : 0);

  return (
    <div className="space-y-5 sm:space-y-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Réseaux électriques"
        sub="Deux compteurs EDF distincts : réseau 1 (maison) et réseau 2 (piscine, jacuzzi, voiture)"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        <KpiCard label="Consommation totale · jour" value={fmtKWh(totalWh).replace(" kWh", "")} unit="kWh" icon={Icon.bolt} accent="grid" sub="réseaux 1 + 2" />
        <KpiCard
          label={grid >= 0 ? "Réseau 1 · achat" : "Réseau 1 · injection"}
          value={fmtPower(Math.abs(grid)).value}
          unit={fmtPower(Math.abs(grid)).unit}
          icon={Icon.pylon}
          accent={grid > 30 ? "import" : "grid"}
          sub={`Conso maison ${fmtPower(r1W).value} ${fmtPower(r1W).unit}`}
        />
        <KpiCard label="Réseau 2 · achat" value={fmtPower(r2W).value} unit={fmtPower(r2W).unit} icon={Icon.pool} accent="aux" sub="piscine, jacuzzi, voiture" />
        <KpiCard
          label="Coût du jour"
          value={fmtEur(costToday.house.totalEur + costToday.aux.totalEur).replace(/\s?€/, "")}
          unit="€"
          icon={Icon.euro}
          accent="cost"
          sub={`R1 ${fmtEur(costToday.house.totalEur)} · R2 ${fmtEur(costToday.aux.totalEur)}`}
        />
        <KpiCard
          label="Coût du mois"
          value={fmtEur(costMonth.house.totalEur + costMonth.aux.totalEur).replace(/\s?€/, "")}
          unit="€"
          icon={Icon.euro}
          accent="cost"
          sub="abonnement inclus"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5">
        <NetworkCard
          n={1}
          title="Réseau 1 · maison"
          sub="Solaire, batterie (PowerStream) et achat au réseau"
          liveW={r1W}
          kwh={energy.conso1Wh}
          eurToday={costToday.house.totalEur}
          eurMonth={costMonth.house.totalEur}
          accent="home"
        >
          {c1.map((c) => (
            <ShareRow key={c.name} icon={c.car ? Icon.car : Icon.plug} label={c.name} value={fmtKWh(c.wh)} pct={share(c.wh, energy.conso1Wh)} accent="home" />
          ))}
          <ShareRow icon={Icon.home} label="Reste de la maison" value={fmtKWh(other(energy.conso1Wh, c1))} pct={share(other(energy.conso1Wh, c1), energy.conso1Wh)} accent="grid" />
        </NetworkCard>
        <NetworkCard
          n={2}
          title="Réseau 2 · piscine, jacuzzi, voiture"
          sub="Mesuré par la pince Shelly dédiée · alimente aussi la charge batterie"
          liveW={r2W}
          kwh={energy.import2Wh}
          eurToday={costToday.aux.totalEur}
          eurMonth={costMonth.aux.totalEur}
          accent="aux"
        >
          {c2.map((c) => (
            <ShareRow
              key={c.name}
              icon={c.name === "Charge batterie" ? Icon.battery : c.car ? Icon.car : Icon.pool}
              label={c.name}
              value={fmtKWh(c.wh)}
              pct={share(c.wh, energy.import2Wh)}
              accent={c.name === "Charge batterie" ? "battery" : "aux"}
            />
          ))}
          <ShareRow icon={Icon.fan} label="Pompe piscine et autres" value={fmtKWh(other(energy.import2Wh, c2))} pct={share(other(energy.import2Wh, c2), energy.import2Wh)} accent="neutral" />
        </NetworkCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5">
        <Section title="Profil de charge sur 24 h" sub="Moyennes par quart d'heure" className="xl:col-span-2">
          <PowerChart
            data={series.map((x) => ({ ...x }))}
            series={[
              { key: "conso1", label: "Réseau 1 · conso maison", color: "var(--flow-home)", area: true },
              { key: "grid1", label: "Réseau 1 · achat (+) / injection (−)", color: "var(--flow-grid)" },
              { key: "aux", label: "Réseau 2", color: "var(--flow-aux)", area: true },
            ]}
          />
        </Section>
        <Section title="Répartition de la consommation" sub="Aujourd'hui">
          <EnergyDonut
            centerLabel="consommés"
            slices={[
              { label: "Réseau 1 · solaire", value: energy.selfConsumedWh, color: "var(--flow-solar)" },
              { label: "Réseau 1 · batterie", value: energy.batteryDischargeWh, color: "var(--flow-battery)" },
              { label: "Réseau 1 · acheté", value: energy.import1Wh, color: "var(--flow-grid)" },
              { label: "Réseau 2 · acheté", value: energy.import2Wh, color: "var(--flow-aux)" },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
