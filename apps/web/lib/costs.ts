// Calcul des coûts d'électricité au tarif EDF Tempo, séparément pour les
// 2 réseaux (compteurs distincts) :
//   - HOUSE : réseau maison, import mesuré par le GRID_METER ;
//   - AUX   : réseau indépendant piscine, jacuzzi, voiture (AUX_NETWORK_METER).
// Chaque heure du rollup (ReadingHourly) est valorisée selon la couleur du
// jour Tempo (6h → 6h le lendemain, table TempoDay) et la plage HC/HP du
// contrat (EnergyContract). Abonnement proratisé à la durée de la période.

import { prisma } from "@/lib/prisma";

export const TZ = process.env.HOME_TZ ?? "Europe/Paris";

export type TempoColorKey = "BLUE" | "WHITE" | "RED";
export type Slot = `${TempoColorKey}_${"HC" | "HP"}`;
export const SLOTS: Slot[] = [
  "BLUE_HC",
  "BLUE_HP",
  "WHITE_HC",
  "WHITE_HP",
  "RED_HC",
  "RED_HP",
];
export type Network = "HOUSE" | "AUX";

type PriceField = "blueHc" | "blueHp" | "whiteHc" | "whiteHp" | "redHc" | "redHp";
export const SLOT_FIELD: Record<Slot, PriceField> = {
  BLUE_HC: "blueHc",
  BLUE_HP: "blueHp",
  WHITE_HC: "whiteHc",
  WHITE_HP: "whiteHp",
  RED_HC: "redHc",
  RED_HP: "redHp",
};

export interface Contract {
  network: Network;
  name: string;
  kva: number | null;
  subscriptionMonthlyEur: number;
  hcStartMinute: number;
  hcEndMinute: number;
  blueHc: number;
  blueHp: number;
  whiteHc: number;
  whiteHp: number;
  redHc: number;
  redHp: number;
}

// Valeurs initiales : grille Tempo EDF TTC au 1er août 2026 (défauts du
// schéma). Réseaux 1 et 2 : mêmes prix (9 kVA) ; abonnement compté sur le
// réseau 1 uniquement.
const DEFAULT_CONTRACTS: Record<
  Network,
  { name: string; kva: number | null; subscriptionMonthlyEur: number }
> = {
  HOUSE: { name: "Réseau 1", kva: 9, subscriptionMonthlyEur: 19.7 },
  AUX: { name: "Réseau 2", kva: 9, subscriptionMonthlyEur: 0 },
};

export async function getContracts(): Promise<Record<Network, Contract>> {
  // createMany + skipDuplicates : pas de course quand plusieurs requêtes
  // créent les contrats par défaut en même temps (upsert → P2002).
  await prisma.energyContract.createMany({
    data: (["HOUSE", "AUX"] as const).map((network) => ({
      network,
      ...DEFAULT_CONTRACTS[network],
    })),
    skipDuplicates: true,
  });
  const rows = await prisma.energyContract.findMany();
  const out = {} as Record<Network, Contract>;
  for (const c of rows) {
    if (c.network === "HOUSE" || c.network === "AUX") {
      out[c.network] = { ...c, network: c.network };
    }
  }
  return out;
}

// ── Fuseau horaire ──────────────────────────────────────────────────

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localParts(d: Date): { y: number; m: number; d: number; h: number; min: number } {
  const p = Object.fromEntries(
    partsFmt.formatToParts(d).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
  };
}

function ymd(p: { y: number; m: number; d: number }): string {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Instant UTC correspondant à minuit local du jour (y, m, d). */
function localMidnight(y: number, m: number, d: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d));
  const p = localParts(guess);
  const offsetMs = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/** Jour Tempo (YYYY-MM-DD) d'un instant : la journée Tempo commence à 6h. */
export function tempoDateOf(t: Date): string {
  return ymd(localParts(new Date(t.getTime() - 6 * 3_600_000)));
}

function isHc(minuteOfDay: number, c: Contract): boolean {
  const { hcStartMinute: s, hcEndMinute: e } = c;
  return s <= e
    ? minuteOfDay >= s && minuteOfDay < e
    : minuteOfDay >= s || minuteOfDay < e;
}

// ── Périodes ────────────────────────────────────────────────────────

export type PeriodKey = "today" | "yesterday" | "7d" | "month" | "prevMonth";
export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "today", label: "Aujourd'hui" },
  { key: "yesterday", label: "Hier" },
  { key: "7d", label: "7 derniers jours" },
  { key: "month", label: "Mois en cours" },
  { key: "prevMonth", label: "Mois précédent" },
];

export function periodRange(key: PeriodKey, now = new Date()): { from: Date; to: Date } {
  const p = localParts(now);
  const today = localMidnight(p.y, p.m, p.d);
  switch (key) {
    case "today":
      return { from: today, to: now };
    case "yesterday": {
      const y = localParts(new Date(today.getTime() - 12 * 3_600_000));
      return { from: localMidnight(y.y, y.m, y.d), to: today };
    }
    case "7d": {
      const s = localParts(new Date(today.getTime() - 6.5 * 86_400_000));
      return { from: localMidnight(s.y, s.m, s.d), to: now };
    }
    case "month":
      return { from: localMidnight(p.y, p.m, 1), to: now };
    case "prevMonth": {
      const pm = p.m === 1 ? 12 : p.m - 1;
      const py = p.m === 1 ? p.y - 1 : p.y;
      return { from: localMidnight(py, pm, 1), to: localMidnight(p.y, p.m, 1) };
    }
  }
}

// ── Calcul ──────────────────────────────────────────────────────────

export interface SlotTotals {
  kWh: number;
  eur: number;
}

export interface NetworkCost {
  network: Network;
  name: string;
  kva: number | null;
  energyKWh: number;
  energyEur: number;
  subscriptionEur: number;
  totalEur: number;
  slots: Record<Slot, SlotTotals>;
  /** Heures avec une mesure du compteur de ce réseau. */
  hoursWithData: number;
}

export interface DayCost {
  date: string; // YYYY-MM-DD local
  color: TempoColorKey | null; // couleur du jour Tempo commençant ce jour
  houseKWh: number;
  houseEur: number;
  auxKWh: number;
  auxEur: number;
  savingsEur: number;
  /** Abonnement proratisé sur la part du jour comprise dans la période. */
  houseSubEur: number;
  auxSubEur: number;
}

export interface CostReport {
  from: Date;
  to: Date;
  house: NetworkCost;
  aux: NetworkCost;
  /** Conso maison couverte par solaire + batterie, valorisée au tarif. */
  savings: SlotTotals;
  /** Heures valorisées sans couleur Tempo connue (comptées en bleu). */
  unknownColorHours: number;
  days: DayCost[];
}

function emptySlots(): Record<Slot, SlotTotals> {
  return Object.fromEntries(SLOTS.map((s) => [s, { kWh: 0, eur: 0 }])) as Record<
    Slot,
    SlotTotals
  >;
}

function emptyNetwork(c: Contract): NetworkCost {
  return {
    network: c.network,
    name: c.name,
    kva: c.kva,
    energyKWh: 0,
    energyEur: 0,
    subscriptionEur: 0,
    totalEur: 0,
    slots: emptySlots(),
    hoursWithData: 0,
  };
}

interface HourAcc {
  ts: Date;
  houseImportWh: number | null;
  houseExportWh: number | null;
  batDischargeWh: number | null;
  prodWh: number | null;
  auxImportWh: number | null;
}

const add = (a: number | null, b: number): number => (a ?? 0) + b;

export async function computeCosts(from: Date, to: Date): Promise<CostReport> {
  const end = new Date(Math.min(to.getTime(), Date.now()));
  const contracts = await getContracts();

  const devices = await prisma.device.findMany({
    where: {
      role: {
        in: [
          "GRID_METER",
          "AUX_NETWORK_METER",
          "BATTERY",
          "PRODUCTION_METER",
        ] as never,
      },
    },
    select: { id: true, role: true },
  });
  const roleOf = new Map(devices.map((d) => [d.id, d.role as string]));

  const rows = await prisma.readingHourly.findMany({
    where: {
      deviceId: { in: devices.map((d) => d.id) },
      hourTs: { gte: from, lt: end },
    },
    select: {
      deviceId: true,
      hourTs: true,
      avgPowerW: true,
      prodWh: true,
      consoWh: true,
      importWh: true,
      exportWh: true,
    },
    orderBy: { hourTs: "asc" },
  });

  const hours = new Map<number, HourAcc>();
  for (const r of rows) {
    const k = r.hourTs.getTime();
    const h = hours.get(k) ?? {
      ts: r.hourTs,
      houseImportWh: null,
      houseExportWh: null,
      batDischargeWh: null,
      prodWh: null,
      auxImportWh: null,
    };
    // Heures antérieures à l'ajout de importWh/exportWh : on retombe sur
    // la moyenne nette (approximation si import et export dans l'heure).
    const imp = r.importWh ?? (r.avgPowerW !== null ? Math.max(0, r.avgPowerW) : null);
    const exp = r.exportWh ?? (r.avgPowerW !== null ? Math.max(0, -r.avgPowerW) : null);
    switch (roleOf.get(r.deviceId)) {
      case "GRID_METER":
        if (imp !== null) h.houseImportWh = add(h.houseImportWh, imp);
        if (exp !== null) h.houseExportWh = add(h.houseExportWh, exp);
        break;
      case "AUX_NETWORK_METER":
        if (imp !== null) h.auxImportWh = add(h.auxImportWh, imp);
        break;
      case "BATTERY":
        // powerW batterie : + = décharge (vers la maison via PowerStream).
        if (r.avgPowerW !== null)
          h.batDischargeWh = add(h.batDischargeWh, Math.max(0, r.avgPowerW));
        break;
      case "PRODUCTION_METER":
        if (r.prodWh !== null) h.prodWh = add(h.prodWh, r.prodWh);
        break;
    }
    hours.set(k, h);
  }

  const tempo = await prisma.tempoDay.findMany({
    where: {
      date: {
        gte: tempoDateOf(from),
        lte: tempoDateOf(end),
      },
    },
  });
  const colorOf = new Map(tempo.map((t) => [t.date, t.color as TempoColorKey]));

  const house = emptyNetwork(contracts.HOUSE);
  const aux = emptyNetwork(contracts.AUX);
  const savings: SlotTotals = { kWh: 0, eur: 0 };
  let unknownColorHours = 0;
  const days = new Map<string, DayCost>();

  for (const h of hours.values()) {
    const lp = localParts(h.ts);
    const minuteOfDay = lp.h * 60 + lp.min;
    const color = colorOf.get(tempoDateOf(h.ts)) ?? null;
    if (color === null) unknownColorHours++;
    const c = color ?? "BLUE";

    const dayKey = ymd(lp);
    const day = days.get(dayKey) ?? {
      date: dayKey,
      color: colorOf.get(dayKey) ?? null,
      houseKWh: 0,
      houseEur: 0,
      auxKWh: 0,
      auxEur: 0,
      savingsEur: 0,
      houseSubEur: 0,
      auxSubEur: 0,
    };

    const charge = (net: NetworkCost, contract: Contract, wh: number) => {
      const slot: Slot = `${c}_${isHc(minuteOfDay, contract) ? "HC" : "HP"}`;
      const kWh = wh / 1000;
      const eur = kWh * contract[SLOT_FIELD[slot]];
      net.slots[slot].kWh += kWh;
      net.slots[slot].eur += eur;
      net.energyKWh += kWh;
      net.energyEur += eur;
      net.hoursWithData++;
      return { kWh, eur };
    };

    if (h.houseImportWh !== null) {
      const r = charge(house, contracts.HOUSE, h.houseImportWh);
      day.houseKWh += r.kWh;
      day.houseEur += r.eur;

      // Économies : conso maison non achetée au réseau = production
      // solaire non exportée + décharge batterie (PowerStream). NB : la
      // pince Shelly « conso maison » mesure en fait le point de livraison
      // (≈ import, 0 en export) → inutilisable ici.
      const coveredWh =
        Math.max(0, (h.prodWh ?? 0) - (h.houseExportWh ?? 0)) +
        (h.batDischargeWh ?? 0);
      const slot: Slot = `${c}_${isHc(minuteOfDay, contracts.HOUSE) ? "HC" : "HP"}`;
      const sEur = (coveredWh / 1000) * contracts.HOUSE[SLOT_FIELD[slot]];
      savings.kWh += coveredWh / 1000;
      savings.eur += sEur;
      day.savingsEur += sEur;
    }
    if (h.auxImportWh !== null) {
      const r = charge(aux, contracts.AUX, h.auxImportWh);
      day.auxKWh += r.kWh;
      day.auxEur += r.eur;
    }
    days.set(dayKey, day);
  }

  // Abonnement proratisé à la durée de la période (base 365 j / 12 mois).
  const periodHours = Math.max(0, (end.getTime() - from.getTime()) / 3_600_000);
  for (const [net, contract] of [
    [house, contracts.HOUSE],
    [aux, contracts.AUX],
  ] as const) {
    net.subscriptionEur = (contract.subscriptionMonthlyEur * 12 * periodHours) / (365 * 24);
    net.totalEur = net.energyEur + net.subscriptionEur;
  }

  // Abonnement par jour : prorata des heures du jour local comprises dans
  // la période (journée entière = mensuel × 12 / 365).
  const subPerHour = (c: Contract) => (c.subscriptionMonthlyEur * 12) / (365 * 24);
  for (const day of days.values()) {
    const [y, m, d] = day.date.split("-").map(Number) as [number, number, number];
    const dayStart = localMidnight(y, m, d);
    const next = localParts(new Date(dayStart.getTime() + 36 * 3_600_000));
    const dayEnd = localMidnight(next.y, next.m, next.d);
    const hoursIn =
      Math.max(
        0,
        Math.min(dayEnd.getTime(), end.getTime()) - Math.max(dayStart.getTime(), from.getTime()),
      ) / 3_600_000;
    day.houseSubEur = subPerHour(contracts.HOUSE) * hoursIn;
    day.auxSubEur = subPerHour(contracts.AUX) * hoursIn;
  }

  return {
    from,
    to: end,
    house,
    aux,
    savings,
    unknownColorHours,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export interface MonthCost {
  month: string; // YYYY-MM
  houseKWh: number;
  houseEur: number;
  houseSubEur: number;
  auxKWh: number;
  auxEur: number;
  auxSubEur: number;
  savingsEur: number;
}

/** Coûts agrégés par mois calendaire sur les `months` derniers mois. */
export async function computeMonthlyCosts(
  months = 12,
  now = new Date(),
): Promise<MonthCost[]> {
  const p = localParts(now);
  const startIdx = p.y * 12 + (p.m - 1) - (months - 1);
  const from = localMidnight(Math.floor(startIdx / 12), (startIdx % 12) + 1, 1);
  const report = await computeCosts(from, now);
  const byMonth = new Map<string, MonthCost>();
  for (const d of report.days) {
    const month = d.date.slice(0, 7);
    const m = byMonth.get(month) ?? {
      month,
      houseKWh: 0,
      houseEur: 0,
      houseSubEur: 0,
      auxKWh: 0,
      auxEur: 0,
      auxSubEur: 0,
      savingsEur: 0,
    };
    m.houseKWh += d.houseKWh;
    m.houseEur += d.houseEur;
    m.houseSubEur += d.houseSubEur;
    m.auxKWh += d.auxKWh;
    m.auxEur += d.auxEur;
    m.auxSubEur += d.auxSubEur;
    m.savingsEur += d.savingsEur;
    byMonth.set(month, m);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}
