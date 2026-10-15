"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "@/lib/snapshot";
import type { EnergySplit, EquipmentState, SeriesPoint } from "@/lib/dashboard";
import FlowDiagram, { type FlowLoad, isAuxLoad, loadPower } from "@/components/FlowDiagram";
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
  StatusDot,
} from "@/components/ui";
import { AlertList, type AlertItem, ModeChip, TempoChip } from "@/components/widgets";

const SNAP_MS = 5_000;
const LOADS_MS = 15_000;
const REFRESH_MS = 60_000; // données serveur (coûts, courbes, alertes)

export default function DashboardView({
  initial,
  energy,
  cost,
  alerts,
  equipment,
  series,
}: {
  initial: DashboardSnapshot;
  energy: EnergySplit;
  cost: { total: number; house: number; aux: number };
  alerts: AlertItem[];
  equipment: EquipmentState[];
  series: SeriesPoint[];
}) {
  const router = useRouter();
  const [s, setS] = useState<DashboardSnapshot>(initial);
  const [loads, setLoads] = useState<FlowLoad[]>([]);
  const [lastSoc, setLastSoc] = useState<number | null>(initial.batterySoc);

  useEffect(() => {
    if (s.batterySoc !== null) setLastSoc(s.batterySoc);
  }, [s.batterySoc]);

  useEffect(() => {
    const snap = async () => {
      try {
        const r = await fetch("/api/snapshot", { cache: "no-store" });
        if (r.ok) setS(await r.json());
      } catch {
        // réseau indisponible : on garde la dernière valeur
      }
    };
    const fetchLoads = async () => {
      try {
        const r = await fetch("/api/loads/live", { cache: "no-store" });
        if (r.ok) setLoads(((await r.json()) as { profiles?: FlowLoad[] }).profiles ?? []);
      } catch {
        // idem
      }
    };
    void fetchLoads();
    const a = setInterval(snap, SNAP_MS);
    const b = setInterval(fetchLoads, LOADS_MS);
    const c = setInterval(() => router.refresh(), REFRESH_MS);
    return () => {
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
    };
  }, [router]);

  const production = Math.max(0, s.productionW ?? 0);
  const consumption = Math.max(0, s.consumptionW ?? 0);
  const grid = s.gridW ?? 0;
  const batteryFlow = -(s.batteryPowerW ?? 0); // + charge, − décharge
  const soc = s.batterySoc ?? lastSoc;
  const aux = s.auxNetworkW;

  const cons = fmtPower(s.consumptionW);
  const prod = fmtPower(s.productionW);
  const gridP = fmtPower(Math.abs(grid));
  const auxP = fmtPower(aux);
  const batP = fmtPower(Math.abs(s.batteryPowerW ?? 0));

  // Répartition instantanée par réseau / circuit (W).
  const measured = loads.filter((p) => p.source === "measured" && p.currentlyOn);
  const total = consumption + Math.max(0, aux ?? 0);
  const pct = (w: number) => (total > 0 ? (w / total) * 100 : 0);
  const batteryCharge = Math.max(0, s.acSwitchPowerW ?? 0);

  return (
    <div className="space-y-5 sm:space-y-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Tableau de bord"
        sub="Vue d'ensemble · réseau 1 (maison) et réseau 2 (piscine, jacuzzi, PAC, voiture)"
        right={
          <span className="text-xs text-zinc-500 tabular-nums">
            Mis à jour {new Date(s.ts).toLocaleTimeString("fr-FR")}
          </span>
        }
      />

      {s.acSwitchOnline === false && (
        <div className="card !py-3 flex items-center gap-3 border-rose-500/40 bg-rose-500/5">
          <span className="w-5 h-5 text-rose-400 shrink-0">{Icon.alert}</span>
          <p className="text-sm text-zinc-200">
            <strong className="text-rose-400">Prise AC batterie injoignable.</strong> Les commandes de
            charge ne sont pas délivrées : vérifiez son Wi-Fi.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 min-[1760px]:grid-cols-7 gap-3 sm:gap-4">
        <KpiCard
          label="Consommation · réseau 1"
          value={cons.value}
          unit={cons.unit}
          icon={Icon.bolt}
          accent="home"
          sub={`Aujourd'hui ${fmtKWh(energy.conso1Wh)}`}
        />
        <KpiCard
          label="Production solaire"
          value={prod.value}
          unit={prod.unit}
          icon={Icon.sun}
          accent="solar"
          sub={`Aujourd'hui ${fmtKWh(energy.productionWh)}`}
        />
        <KpiCard
          label="Batterie"
          value={soc === null ? "—" : String(Math.round(soc))}
          unit={soc === null ? undefined : "%"}
          icon={Icon.battery}
          accent="battery"
          sub={
            batteryFlow > 30
              ? `Charge ${batP.value} ${batP.unit}`
              : batteryFlow < -30
                ? `Décharge ${batP.value} ${batP.unit}`
                : "En veille"
          }
        />
        <KpiCard
          label={grid >= 0 ? "Achat · réseau 1" : "Injection · réseau 1"}
          value={gridP.value}
          unit={gridP.unit}
          icon={Icon.pylon}
          accent={grid > 30 ? "import" : "grid"}
          sub={`Acheté aujourd'hui ${fmtKWh(energy.import1Wh)}`}
        />
        <KpiCard
          label="Réseau 2"
          value={auxP.value}
          unit={auxP.unit}
          icon={Icon.pool}
          accent="aux"
          sub={`Aujourd'hui ${fmtKWh(energy.import2Wh)}`}
        />
        <KpiCard
          label="Coût du jour"
          value={fmtEur(cost.total).replace(/\s?€/, "")}
          unit="€"
          icon={Icon.euro}
          accent="cost"
          sub={`R1 ${fmtEur(cost.house)} · R2 ${fmtEur(cost.aux)}`}
        />
        <KpiCard
          label="Autonomie · réseau 1"
          value={energy.autonomy === null ? "—" : String(Math.round(energy.autonomy * 100))}
          unit={energy.autonomy === null ? undefined : "%"}
          icon={Icon.leaf}
          accent="home"
          sub="couvert par solaire + batterie"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5">
        <Section
          title="Flux énergétiques en temps réel"
          className="xl:col-span-2"
          action={
            <div className="flex flex-wrap gap-2">
              <TempoChip color={s.tempoColor} />
              <ModeChip mode={s.controlMode} />
            </div>
          }
        >
          <div>
            <FlowDiagram
              data={{
                production,
                consumption,
                gridFlow: grid,
                batteryFlow,
                batteryLevel: soc === null ? null : Math.round(soc),
                auxNetworkW: aux,
                loads,
              }}
            />
          </div>
        </Section>

        <div className="space-y-4 sm:space-y-5 min-w-0">
          <Section title="Répartition par réseau / circuit" sub="Puissance instantanée">
            <ShareRow icon={Icon.home} label="Réseau 1 · maison" value={`${cons.value} ${cons.unit}`} pct={pct(consumption)} accent="home" />
            <ShareRow
              icon={Icon.pool}
              label="Réseau 2 · piscine, jacuzzi, PAC, voiture"
              value={`${auxP.value} ${auxP.unit}`}
              pct={pct(Math.max(0, aux ?? 0))}
              accent="aux"
            />
            {measured.map((p) => {
              const w = loadPower(p);
              const f = fmtPower(w);
              return (
                <ShareRow
                  key={p.id}
                  icon={/voiture|borne|\bev\b|car/i.test(p.name) ? Icon.car : isAuxLoad(p) ? Icon.pool : Icon.plug}
                  label={`${p.name} · R${isAuxLoad(p) ? 2 : 1}`}
                  value={`${f.value} ${f.unit}`}
                  pct={pct(w)}
                  accent={isAuxLoad(p) ? "aux" : "home"}
                />
              );
            })}
            {batteryCharge > 30 && (
              <ShareRow
                icon={Icon.battery}
                label="Charge batterie · R2"
                value={`${fmtPower(batteryCharge).value} ${fmtPower(batteryCharge).unit}`}
                pct={pct(batteryCharge)}
                accent="battery"
              />
            )}
          </Section>

          <Section
            title="Alertes et anomalies"
            action={<span className="text-xs text-zinc-500">{alerts.length || "Aucune"}</span>}
          >
            <AlertList alerts={alerts} max={4} />
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5">
        <Section title="Évolution sur 24 h" sub="Moyennes par quart d'heure" className="xl:col-span-2">
          <PowerChart
            data={series.map((p) => ({ ...p }))}
            series={[
              { key: "conso1", label: "Conso réseau 1", color: "var(--flow-grid)", area: true },
              { key: "production", label: "Production solaire", color: "var(--flow-home)" },
              { key: "aux", label: "Réseau 2", color: "var(--flow-aux)" },
              { key: "battery", label: "Batterie (+ décharge / − charge)", color: "var(--flow-battery)", dashed: true },
            ]}
          />
        </Section>
        <Section title="Répartition de l'énergie" sub="Aujourd'hui">
          <EnergyDonut
            centerLabel="au total"
            slices={[
              { label: "Solaire autoconsommé", value: energy.selfConsumedWh, color: "var(--flow-home)" },
              { label: "Solaire injecté", value: energy.exportedWh, color: "var(--flow-grid)" },
              { label: "Batterie (décharge)", value: energy.batteryDischargeWh, color: "var(--flow-battery)" },
              { label: "Acheté · réseau 1", value: energy.import1Wh, color: "var(--flow-solar)" },
              { label: "Acheté · réseau 2", value: energy.import2Wh, color: "var(--flow-aux)" },
            ]}
          />
        </Section>
      </div>

      <Section
        title="État des équipements"
        action={
          <Link href="/devices" className="text-xs text-blue-400 hover:underline">
            Gérer les appareils →
          </Link>
        }
      >
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          {equipment.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2 border-b last:border-b-0 md:[&:nth-last-child(2)]:border-b-0" style={{ borderColor: "var(--hairline)" }}>
              <StatusDot status={e.status} />
              <span className="text-sm text-zinc-200 flex-1 min-w-0 truncate">{e.name}</span>
              {e.network && (
                <span className="text-[10px] font-semibold text-zinc-500 border border-zinc-800 rounded px-1.5 py-0.5">
                  R{e.network}
                </span>
              )}
              <span className="text-xs text-zinc-400 w-28 truncate">{e.statusLabel}</span>
              <span className="text-sm tabular-nums text-zinc-100 w-20 text-right">{e.value}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
