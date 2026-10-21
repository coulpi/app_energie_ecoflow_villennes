import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getDashboardSnapshot } from "@/lib/snapshot";
import { getSeries } from "@/lib/dashboard";
import BatteryControl from "@/components/BatteryControl";
import BatteryModeCard from "@/components/BatteryModeCard";
import { PowerChart } from "@/components/charts";
import { fmtPower, Icon, KpiCard, PageHeader, Section } from "@/components/ui";
import { ModeChip } from "@/components/widgets";
import ForceChargeCard from "../ForceChargeCard";

export const dynamic = "force-dynamic";

const CAPACITY_WH = 2016; // Delta Max 2000

// Mode et bornes du pilotage automatique. Les autres réglages (puissances,
// Tempo) sont dans BatteryControl : on ne met à jour que ces champs-ci.
async function saveMode(formData: FormData) {
  "use server";
  const num = (k: string, d: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) ? v : d;
  };
  const data = {
    mode: String(formData.get("mode")) as never,
    followLoadOffsetW: num("offsetW", 50),
    followLoadMinW: num("minW", 0),
    minDischargeSoc: num("minSoc", 20),
    maxChargeSoc: num("maxSoc", 95),
  };
  await prisma.controlState.upsert({
    where: { key: "default" },
    create: { key: "default", ...data },
    update: data,
  });
  revalidatePath("/battery");
  revalidatePath("/");
}

export default async function BatteryPage() {
  const [s, ctrl, series] = await Promise.all([
    getDashboardSnapshot(),
    prisma.controlState.findUnique({ where: { key: "default" } }),
    getSeries(24),
  ]);
  const soc = s.batterySoc;
  const p = s.batteryPowerW ?? 0; // + décharge, − charge
  const pw = fmtPower(Math.abs(p));
  const psOn = s.powerstreamPriority === 0;
  const manual = (ctrl?.mode ?? s.controlMode) === "MANUAL";

  return (
    <div className="space-y-5 sm:space-y-6 max-w-[1500px] mx-auto">
      <PageHeader
        title="Batterie"
        sub="EcoFlow Delta Max 2000 · charge sur le réseau 2, décharge vers le réseau 1 via le PowerStream"
        right={<ModeChip mode={s.controlMode} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        <KpiCard
          label="Niveau de charge"
          value={soc === null ? "—" : String(Math.round(soc))}
          unit={soc === null ? undefined : "%"}
          icon={Icon.battery}
          accent="battery"
          valueAccent
          sub={soc === null ? "SoC non remonté" : `≈ ${((soc / 100) * CAPACITY_WH / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} / 2,02 kWh`}
        />
        <KpiCard
          label={p < -30 ? "Charge" : p > 30 ? "Décharge" : "Puissance"}
          value={Math.abs(p) > 30 ? pw.value : "0"}
          unit={Math.abs(p) > 30 ? pw.unit : "W"}
          icon={Icon.bolt}
          accent="battery"
          sub={p < -30 ? "depuis le réseau 2" : p > 30 ? "vers le réseau 1" : "En veille"}
        />
        <KpiCard
          label="Prise AC · réseau 2"
          value={s.acSwitchOnline === false ? "Hors ligne" : s.switchOn === null ? "—" : s.switchOn ? "ON" : "OFF"}
          icon={Icon.plug}
          accent={s.acSwitchOnline === false ? "import" : "neutral"}
          sub={s.acSwitchPowerW !== null ? `${Math.round(s.acSwitchPowerW)} W tirés` : undefined}
        />
        <KpiCard
          label="PowerStream"
          value={psOn ? "Alimentation" : "Stockage"}
          icon={Icon.home}
          accent="home"
          sub={`Consigne ${s.powerstreamPermanentW ?? 0} W`}
        />
        <KpiCard
          label="Plancher / plafond"
          value={`${ctrl?.minDischargeSoc ?? 20}–${ctrl?.maxChargeSoc ?? 95}`}
          unit="%"
          icon={Icon.gauge}
          accent="neutral"
          sub="SoC min décharge · max charge"
        />
      </div>

      <BatteryModeCard initial={s} />

      {/* Réglages du pilotage automatique : grisés et inactifs en mode
          manuel (le worker ne les applique plus). */}
      <div
        className={`space-y-5 sm:space-y-6 ${manual ? "opacity-45 pointer-events-none select-none" : ""}`}
        aria-disabled={manual || undefined}
      >
      {manual && (
        <p className="text-sm text-amber-400">
          Mode manuel actif : recharge forcée, programme quotidien, décharge Tempo, règles et agent
          IA sont suspendus.
        </p>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5">
        <div className="xl:col-span-2 min-w-0">
          <ForceChargeCard />
        </div>
        <Section title="Mode de pilotage" sub="Stratégie automatique et bornes de SoC">
          <form action={saveMode} className="space-y-3">
            <label className="block">
              <span className="text-xs text-zinc-400">Mode</span>
              <select name="mode" defaultValue={ctrl?.mode ?? "RULES"} className="input-base w-full mt-1">
                <option value="FOLLOW_LOAD">Suivi de charge (autoconsommation)</option>
                <option value="RULES">Règles</option>
                <option value="MANUAL">Manuel</option>
                <option value="OFF">Désactivé</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Marge sous la conso" name="offsetW" value={ctrl?.followLoadOffsetW ?? 50} unit="W" />
              <Field label="Injection min" name="minW" value={ctrl?.followLoadMinW ?? 0} unit="W" />
              <Field label="SoC min décharge" name="minSoc" value={ctrl?.minDischargeSoc ?? 20} unit="%" />
              <Field label="SoC max charge" name="maxSoc" value={ctrl?.maxChargeSoc ?? 95} unit="%" />
            </div>
            <div className="flex justify-end">
              <button className="btn-primary">Enregistrer</button>
            </div>
          </form>
        </Section>
      </div>

      <BatteryControl initial={s} />
      </div>

      <Section title="Activité sur 24 h" sub="Puissance batterie (+ décharge / − charge) et production solaire">
        <PowerChart
          data={series.map((x) => ({ ...x }))}
          series={[
            { key: "battery", label: "Batterie", color: "var(--flow-battery)", area: true },
            { key: "production", label: "Production solaire", color: "var(--flow-solar)" },
            { key: "aux", label: "Réseau 2 (dont charge)", color: "var(--flow-aux)", dashed: true },
          ]}
        />
      </Section>
    </div>
  );
}

function Field({ label, name, value, unit }: { label: string; name: string; value: number; unit: string }) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input name={name} type="number" defaultValue={value} className="input-base w-full min-w-0 text-right font-mono" />
        <span className="text-xs text-zinc-500 w-5">{unit}</span>
      </span>
    </label>
  );
}
