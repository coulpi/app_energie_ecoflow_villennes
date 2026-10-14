import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  computeCosts,
  getContracts,
  periodRange,
  PERIODS,
  SLOTS,
  SLOT_FIELD,
  type Contract,
  type NetworkCost,
  type PeriodKey,
  type Slot,
  type TempoColorKey,
} from "@/lib/costs";

export const dynamic = "force-dynamic";

const COLOR_LABEL: Record<TempoColorKey, string> = {
  BLUE: "Bleu",
  WHITE: "Blanc",
  RED: "Rouge",
};
const COLOR_DOT: Record<TempoColorKey, string> = {
  BLUE: "bg-blue-500",
  WHITE: "bg-zinc-100",
  RED: "bg-red-500",
};

function slotLabel(s: Slot): { color: TempoColorKey; hc: boolean } {
  const [color, p] = s.split("_") as [TempoColorKey, "HC" | "HP"];
  return { color, hc: p === "HC" };
}

const eur = (v: number) =>
  v.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const kwh = (v: number) =>
  `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 2 : 1 })} kWh`;

function minToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

async function updateContract(network: string, formData: FormData) {
  "use server";
  const num = (k: string) => {
    const v = Number(String(formData.get(k) ?? "").replace(",", "."));
    return Number.isFinite(v) ? v : undefined;
  };
  const kvaRaw = String(formData.get("kva") ?? "").trim();
  await prisma.energyContract.update({
    where: { network },
    data: {
      name: String(formData.get("name") ?? "").trim() || undefined,
      kva: kvaRaw ? Number(kvaRaw) : null,
      subscriptionMonthlyEur: num("subscriptionMonthlyEur"),
      hcStartMinute: hhmmToMin(String(formData.get("hcStart") ?? "22:00")),
      hcEndMinute: hhmmToMin(String(formData.get("hcEnd") ?? "06:00")),
      blueHc: num("blueHc"),
      blueHp: num("blueHp"),
      whiteHc: num("whiteHc"),
      whiteHp: num("whiteHp"),
      redHc: num("redHc"),
      redHp: num("redHp"),
    },
  });
  revalidatePath("/costs");
}

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const period: PeriodKey = PERIODS.some((x) => x.key === p)
    ? (p as PeriodKey)
    : "month";
  const { from, to } = periodRange(period);
  const [report, contracts] = await Promise.all([
    computeCosts(from, to),
    getContracts(),
  ]);
  const total = report.house.totalEur + report.aux.totalEur;
  const fmtDate = (d: Date) =>
    d.toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="page-h1">Coûts d&rsquo;électricité</h1>
        <p className="page-sub mt-1">
          Tarif EDF Tempo, réseau maison et réseau piscine/jacuzzi (compteurs
          distincts). Du {fmtDate(report.from)} au {fmtDate(report.to)}.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((x) => (
          <Link
            key={x.key}
            href={`/costs?p=${x.key}`}
            className={
              "btn text-xs " +
              (x.key === period
                ? "bg-emerald-900/50 text-emerald-100 border border-emerald-700"
                : "btn-ghost")
            }
          >
            {x.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard
          label={report.house.name}
          value={eur(report.house.totalEur)}
          hint={`${kwh(report.house.energyKWh)} · abo ${eur(report.house.subscriptionEur)}`}
        />
        <SummaryCard
          label={report.aux.name}
          value={eur(report.aux.totalEur)}
          hint={
            report.aux.hoursWithData === 0
              ? "pas de mesure sur la période"
              : `${kwh(report.aux.energyKWh)} · abo ${eur(report.aux.subscriptionEur)}`
          }
        />
        <SummaryCard label="Total" value={eur(total)} hint="2 réseaux, abonnements inclus" />
        <SummaryCard
          label="Économies solaire + batterie"
          value={eur(report.savings.eur)}
          hint={`${kwh(report.savings.kWh)} non achetés (maison)`}
          good
        />
      </div>

      {report.unknownColorHours > 0 && (
        <p className="text-xs text-amber-300">
          {report.unknownColorHours} h sans couleur Tempo connue, comptées au
          tarif bleu.
        </p>
      )}

      <div className="card overflow-x-auto">
        <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 mb-3">
          Détail par couleur et plage horaire
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1 pr-3 font-normal">Période</th>
              <th className="py-1 pr-3 font-normal text-right">Maison</th>
              <th className="py-1 pr-3 font-normal text-right">€</th>
              <th className="py-1 pr-3 font-normal text-right">Piscine/jacuzzi</th>
              <th className="py-1 font-normal text-right">€</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {SLOTS.map((s) => {
              const { color, hc } = slotLabel(s);
              return (
                <tr key={s} className="border-t border-zinc-800/70">
                  <td className="py-1.5 pr-3 font-sans">
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${COLOR_DOT[color]}`} />
                      {COLOR_LABEL[color]} {hc ? "HC" : "HP"}
                      <span className="text-[11px] text-zinc-500">
                        {contracts.HOUSE[SLOT_FIELD[s]].toFixed(4)} €
                      </span>
                    </span>
                  </td>
                  <SlotCells net={report.house} slot={s} />
                  <SlotCells net={report.aux} slot={s} last />
                </tr>
              );
            })}
            <tr className="border-t border-zinc-700 font-semibold">
              <td className="py-1.5 pr-3 font-sans">Abonnement</td>
              <td />
              <td className="py-1.5 pr-3 text-right">{eur(report.house.subscriptionEur)}</td>
              <td />
              <td className="py-1.5 text-right">{eur(report.aux.subscriptionEur)}</td>
            </tr>
            <tr className="border-t border-zinc-700 font-semibold">
              <td className="py-1.5 pr-3 font-sans">Total</td>
              <td className="py-1.5 pr-3 text-right">{kwh(report.house.energyKWh)}</td>
              <td className="py-1.5 pr-3 text-right">{eur(report.house.totalEur)}</td>
              <td className="py-1.5 pr-3 text-right">{kwh(report.aux.energyKWh)}</td>
              <td className="py-1.5 text-right">{eur(report.aux.totalEur)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {report.days.length > 1 && (
        <div className="card overflow-x-auto">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 mb-3">
            Par jour (énergie, hors abonnement)
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3 font-normal">Jour</th>
                <th className="py-1 pr-3 font-normal text-right">Maison</th>
                <th className="py-1 pr-3 font-normal text-right">Piscine/jacuzzi</th>
                <th className="py-1 pr-3 font-normal text-right">Total</th>
                <th className="py-1 font-normal text-right">Économies</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {report.days.map((d) => {
                const [, mm, dd] = d.date.split("-");
                return (
                  <tr key={d.date} className="border-t border-zinc-800/70">
                    <td className="py-1.5 pr-3 font-sans">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${d.color ? COLOR_DOT[d.color] : "bg-zinc-700"}`}
                          title={d.color ? COLOR_LABEL[d.color] : "couleur inconnue"}
                        />
                        {dd}/{mm}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right">{eur(d.houseEur)}</td>
                    <td className="py-1.5 pr-3 text-right">{eur(d.auxEur)}</td>
                    <td className="py-1.5 pr-3 text-right">{eur(d.houseEur + d.auxEur)}</td>
                    <td className="py-1.5 text-right text-emerald-300">{eur(d.savingsEur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Calcul horaire à partir des agrégats (heure en cours non incluse).
        Journée Tempo de 6h à 6h. Économies = conso maison mesurée non
        achetée au réseau (solaire + décharge batterie), au tarif de
        l&rsquo;heure. La charge batterie est payée sur le réseau
        piscine/jacuzzi (prise AC IN).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ContractForm contract={contracts.HOUSE} />
        <ContractForm contract={contracts.AUX} />
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  good = false,
}: {
  label: string;
  value: string;
  hint: string;
  good?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div
        className={
          "mt-1 text-2xl font-semibold font-mono " +
          (good ? "text-emerald-300" : "text-zinc-100")
        }
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-zinc-500">{hint}</div>
    </div>
  );
}

function SlotCells({
  net,
  slot,
  last = false,
}: {
  net: NetworkCost;
  slot: Slot;
  last?: boolean;
}) {
  const t = net.slots[slot];
  return (
    <>
      <td className="py-1.5 pr-3 text-right text-zinc-400">{kwh(t.kWh)}</td>
      <td className={"py-1.5 text-right " + (last ? "" : "pr-3")}>{eur(t.eur)}</td>
    </>
  );
}

function ContractForm({ contract: c }: { contract: Contract }) {
  const priceInput = (field: keyof Contract, label: string) => (
    <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
      {label}
      <input
        name={field}
        type="number"
        step="0.0001"
        min={0}
        defaultValue={c[field] as number}
        className="input-base w-28 text-right font-mono"
      />
    </label>
  );
  return (
    <form action={updateContract.bind(null, c.network)} className="card space-y-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        Contrat Tempo · {c.network === "HOUSE" ? "réseau maison" : "réseau piscine/jacuzzi"}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input name="name" defaultValue={c.name} className="input-base col-span-2" />
        <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
          kVA
          <input
            name="kva"
            type="number"
            min={3}
            defaultValue={c.kva ?? ""}
            className="input-base w-28 text-right font-mono"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
          Abo €/mois
          <input
            name="subscriptionMonthlyEur"
            type="number"
            step="0.01"
            min={0}
            defaultValue={c.subscriptionMonthlyEur}
            className="input-base w-28 text-right font-mono"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
          HC début
          <input
            name="hcStart"
            type="time"
            defaultValue={minToHHMM(c.hcStartMinute)}
            className="input-base w-28"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-zinc-400">
          HC fin
          <input
            name="hcEnd"
            type="time"
            defaultValue={minToHHMM(c.hcEndMinute)}
            className="input-base w-28"
          />
        </label>
        {priceInput("blueHc", "Bleu HC €/kWh")}
        {priceInput("blueHp", "Bleu HP €/kWh")}
        {priceInput("whiteHc", "Blanc HC €/kWh")}
        {priceInput("whiteHp", "Blanc HP €/kWh")}
        {priceInput("redHc", "Rouge HC €/kWh")}
        {priceInput("redHp", "Rouge HP €/kWh")}
      </div>
      <div className="flex justify-end">
        <button className="btn-primary">Enregistrer</button>
      </div>
    </form>
  );
}
