// Données serveur du tableau de bord et des pages Réseaux / Batterie :
// courbes 24 h (pas de 15 min), répartition de l'énergie du jour, alertes
// et état des équipements. Calculées depuis les Reading bruts.

import { prisma } from "@/lib/prisma";
import { periodRange } from "@/lib/costs";
import { isNetwork2 } from "@/lib/networks";
import { fetchBms } from "@/lib/bms";

const BUCKET_MIN = 15;

export interface SeriesPoint {
  ts: number; // début du créneau (ms)
  label: string; // HH:MM local
  production: number | null; // W
  conso1: number | null; // W, conso réseau 1 = solaire + réseau 1 + décharge
  grid1: number | null; // W signé (+ achat, − injection)
  aux: number | null; // W réseau 2
  battery: number | null; // W signé (+ décharge, − charge)
}

type Role = "PRODUCTION_METER" | "GRID_METER" | "AUX_NETWORK_METER" | "BATTERY";
const ROLES: Role[] = ["PRODUCTION_METER", "GRID_METER", "AUX_NETWORK_METER", "BATTERY"];

/** Moyennes par créneau de 15 min et par rôle sur [from, to). */
async function bucketize(from: Date, to: Date) {
  const devices = await prisma.device.findMany({
    where: { enabled: true, role: { in: ROLES as never } },
    select: { id: true, role: true },
  });
  const roleOf = new Map(devices.map((d) => [d.id, d.role as Role]));
  const rows = await prisma.reading.findMany({
    where: {
      deviceId: { in: devices.map((d) => d.id) },
      ts: { gte: from, lt: to },
      powerW: { not: null },
    },
    select: { deviceId: true, ts: true, powerW: true },
  });
  const step = BUCKET_MIN * 60_000;
  const start = Math.floor(from.getTime() / step) * step;
  const n = Math.ceil((to.getTime() - start) / step);
  // [role][bucket] → {sum, count} ; plusieurs compteurs d'un rôle : on
  // moyenne par compteur puis on additionne (AUX multi-pinces).
  const acc = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const b = Math.floor((r.ts.getTime() - start) / step);
    const k = `${r.deviceId}|${b}`;
    const a = acc.get(k) ?? { sum: 0, count: 0 };
    a.sum += r.powerW!;
    a.count++;
    acc.set(k, a);
  }
  const byRole = Object.fromEntries(
    ROLES.map((role) => [role, Array<number | null>(n).fill(null)]),
  ) as Record<Role, Array<number | null>>;
  for (const [k, a] of acc) {
    const [id, bs] = k.split("|");
    const role = roleOf.get(id!);
    if (!role) continue;
    const b = Number(bs);
    byRole[role][b] = (byRole[role][b] ?? 0) + a.sum / a.count;
  }
  return { start, step, n, byRole };
}

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });

export async function getSeries(hours = 24, now = new Date()): Promise<SeriesPoint[]> {
  const from = new Date(now.getTime() - hours * 3_600_000);
  const { start, step, n, byRole } = await bucketize(from, now);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < n; i++) {
    const prod = byRole.PRODUCTION_METER[i] ?? null;
    const grid = byRole.GRID_METER[i] ?? null;
    const bat = byRole.BATTERY[i] ?? null;
    const production = prod === null ? null : Math.max(0, prod);
    out.push({
      ts: start + i * step,
      label: hhmm(start + i * step),
      production,
      grid1: grid,
      conso1:
        grid === null
          ? null
          : Math.max(0, (production ?? 0) + grid + Math.max(0, bat ?? 0)),
      aux: byRole.AUX_NETWORK_METER[i] === null ? null : Math.max(0, byRole.AUX_NETWORK_METER[i]!),
      battery: bat,
    });
  }
  return out;
}

export interface EnergySplit {
  productionWh: number;
  selfConsumedWh: number; // solaire consommé sur place
  exportedWh: number;
  batteryDischargeWh: number;
  import1Wh: number;
  import2Wh: number;
  conso1Wh: number;
  /** Part de la conso réseau 1 couverte par solaire + batterie (0..1). */
  autonomy: number | null;
}

/** Bilan énergétique depuis minuit (heure locale). */
export async function getTodayEnergy(now = new Date()): Promise<EnergySplit> {
  const { from } = periodRange("today", now);
  const { step, n, byRole } = await bucketize(from, now);
  const h = step / 3_600_000;
  let productionWh = 0;
  let exportedWh = 0;
  let import1Wh = 0;
  let import2Wh = 0;
  let batteryDischargeWh = 0;
  for (let i = 0; i < n; i++) {
    const prod = byRole.PRODUCTION_METER[i];
    const grid = byRole.GRID_METER[i];
    const aux = byRole.AUX_NETWORK_METER[i];
    const bat = byRole.BATTERY[i];
    if (prod !== null && prod !== undefined) productionWh += Math.max(0, prod) * h;
    if (grid !== null && grid !== undefined) {
      if (grid > 0) import1Wh += grid * h;
      else exportedWh += -grid * h;
    }
    if (aux !== null && aux !== undefined) import2Wh += Math.max(0, aux) * h;
    if (bat !== null && bat !== undefined && bat > 0) batteryDischargeWh += bat * h;
  }
  const selfConsumedWh = Math.max(0, productionWh - exportedWh);
  const conso1Wh = selfConsumedWh + batteryDischargeWh + import1Wh;
  return {
    productionWh,
    selfConsumedWh,
    exportedWh,
    batteryDischargeWh,
    import1Wh,
    import2Wh,
    conso1Wh,
    autonomy: conso1Wh > 0 ? (selfConsumedWh + batteryDischargeWh) / conso1Wh : null,
  };
}

// ── Alertes ─────────────────────────────────────────────────────────

export type AlertLevel = "critical" | "warning" | "info";
export interface DashAlert {
  level: AlertLevel;
  title: string;
  detail: string;
  at?: Date;
}

const STALE_MS = 10 * 60_000;

interface LatestReading {
  ts: Date;
  powerW: number | null;
  soc: number | null;
  switchOn: boolean | null;
}

/**
 * Dernière mesure de chaque appareil (7 derniers jours) : un LATERAL
 * LIMIT 1 par appareil sur l'index (deviceId, ts DESC) → < 1 ms.
 * NB : un DISTINCT ON sur Reading parcourt toute la table et trie ~1 M de
 * lignes (≈ 2,5 s) ; un `include: { readings: { take: 1 } }` Prisma charge
 * toutes les mesures avant de tronquer en mémoire.
 */
async function fetchLatestReadings(): Promise<Map<string, LatestReading>> {
  const rows = await prisma.$queryRaw<Array<LatestReading & { deviceId: string }>>`
    SELECT d.id AS "deviceId", r.ts, r."powerW", r.soc, r."switchOn"
      FROM "Device" d
     CROSS JOIN LATERAL (
       SELECT ts, "powerW", soc, "switchOn"
         FROM "Reading"
        WHERE "deviceId" = d.id AND ts > now() - interval '7 days'
        ORDER BY ts DESC
        LIMIT 1
     ) r`;
  return new Map(rows.map((r) => [r.deviceId, r]));
}

// getAlerts et getEquipmentStates tournent en parallèle sur le tableau de
// bord : on partage la même requête pendant 2 s.
let latestCache: { at: number; p: Promise<Map<string, LatestReading>> } | null = null;
function latestReadings(): Promise<Map<string, LatestReading>> {
  if (!latestCache || Date.now() - latestCache.at > 2_000) {
    const p = fetchLatestReadings();
    latestCache = { at: Date.now(), p };
    p.catch(() => (latestCache = null));
  }
  return latestCache.p;
}

export async function getAlerts(now = new Date()): Promise<DashAlert[]> {
  const [devices, latest, ctrl, health] = await Promise.all([
    prisma.device.findMany({ where: { enabled: true } }),
    latestReadings(),
    prisma.controlState.findUnique({ where: { key: "default" } }),
    prisma.healthAlert.findMany({
      where: { resolvedAt: null },
      include: { device: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
  ]);
  const out: DashAlert[] = [];

  for (const d of devices) {
    const online = (d as { online?: boolean | null }).online;
    const last = latest.get(d.id)?.ts;
    if (online === false) {
      out.push(
        d.role === "BATTERY_AC_SWITCH"
          ? {
              level: "critical",
              title: "Prise AC batterie injoignable",
              detail: `${d.name} est hors ligne : les commandes de charge ne passent pas.`,
            }
          : d.role === "PRODUCTION_METER"
            ? {
                level: "warning",
                title: "Compteur solaire hors ligne",
                detail: `${d.name} ne répond plus : production estimée par bilan.`,
              }
            : {
                level: "warning",
                title: `${d.name} hors ligne`,
                detail: "Appareil déconnecté du cloud Tuya.",
              },
      );
    } else if (
      d.type !== "APSYSTEMS_INVERTER" &&
      (!last || now.getTime() - last.getTime() > STALE_MS)
    ) {
      out.push({
        level: "warning",
        title: `${d.name} : pas de mesure`,
        detail: last
          ? `Dernière mesure ${last.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`
          : "Aucune mesure reçue.",
        at: last,
      });
    }
  }

  const batt = devices.find((d) => d.role === "BATTERY");
  const soc = batt ? (latest.get(batt.id)?.soc ?? null) : null;
  const minSoc = ctrl?.minDischargeSoc ?? 20;
  if (soc !== null && soc <= minSoc) {
    out.push({
      level: "warning",
      title: "Batterie basse",
      detail: `SoC ${Math.round(soc)} %, plancher de décharge ${minSoc} %.`,
    });
  }
  const tomorrow = (ctrl as { tempoColorTomorrow?: string } | null)?.tempoColorTomorrow;
  if (tomorrow === "RED") {
    out.push({
      level: "warning",
      title: "Demain : jour Tempo ROUGE",
      detail: "Heures pleines à 0,73 €/kWh : pensez à charger la batterie cette nuit.",
    });
  } else if (tomorrow === "WHITE") {
    out.push({ level: "info", title: "Demain : jour Tempo BLANC", detail: "Tarif intermédiaire." });
  }
  const forceSoc = (ctrl as { forceChargeSoc?: number | null } | null)?.forceChargeSoc;
  if (forceSoc !== null && forceSoc !== undefined) {
    out.push({
      level: "info",
      title: "Recharge forcée active",
      detail: `Charge de la batterie jusqu'à ${forceSoc} %.`,
    });
  }
  for (const a of health) {
    out.push({
      level: a.severity === "CRITICAL" ? "critical" : a.severity === "WARN" ? "warning" : "info",
      title: a.device.name,
      detail: a.message,
      at: a.startedAt,
    });
  }

  // État remonté par le BMS de la batterie (défauts, température,
  // déséquilibre des cellules, santé). Ignoré si le worker ne répond pas.
  const bms = await fetchBms(2000);
  if (bms?.updatedAt) {
    for (const f of bms.faults) {
      out.push({ level: "critical", title: `Batterie : défaut ${f.source}`, detail: `Code ${f.code} remonté par le BMS.` });
    }
    if (bms.cellTempLevel && bms.cellTempLevel !== "ok") {
      out.push({
        level: bms.cellTempLevel === "bad" ? "critical" : "warning",
        title: "Batterie chaude",
        detail: `Cellules à ${bms.cellTempMax} °C.`,
      });
    }
    if (bms.cellDiffLevel === "bad") {
      out.push({
        level: "warning",
        title: "Cellules batterie déséquilibrées",
        detail: `Écart de ${bms.cellDiffMv} mV entre cellules.`,
      });
    }
    if (bms.sohPct !== null && bms.sohPct < 70) {
      out.push({ level: "info", title: "Batterie usée", detail: `Santé (SoH) ${bms.sohPct} %, ${bms.cycles ?? "?"} cycles.` });
    }
  }

  const rank: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ── État des équipements ────────────────────────────────────────────

export interface EquipmentState {
  id: string;
  name: string;
  network: 1 | 2 | null;
  status: "ok" | "warn" | "bad" | "idle";
  statusLabel: string;
  value: string;
}

const ROLE_NETWORK: Record<string, 1 | 2 | null> = {
  GRID_METER: 1,
  CONSUMPTION_METER: 1,
  PRODUCTION_METER: 1,
  SOLAR_INVERTER: 1,
  POWERSTREAM: 1,
  AUX_NETWORK_METER: 2,
  BATTERY_AC_SWITCH: 2,
  BATTERY: null,
};

export async function getEquipmentStates(now = new Date()): Promise<EquipmentState[]> {
  const [devices, latest] = await Promise.all([
    prisma.device.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } }),
    latestReadings(),
  ]);
  return devices.map((d) => {
    const r = latest.get(d.id);
    const online = (d as { online?: boolean | null }).online;
    const stale = !r || now.getTime() - r.ts.getTime() > STALE_MS;
    const w = r?.powerW ?? null;
    const net =
      d.role === "APPLIANCE" ? (isNetwork2(d.name) ? 2 : 1) : (ROLE_NETWORK[d.role] ?? null);
    let status: EquipmentState["status"] = "ok";
    let statusLabel = "Normal";
    if (online === false) {
      status = "bad";
      statusLabel = "Hors ligne";
    } else if (stale) {
      status = "warn";
      statusLabel = "Pas de mesure";
    } else if (d.role === "BATTERY") {
      statusLabel = w !== null && w > 30 ? "Décharge" : w !== null && w < -30 ? "Charge" : "Veille";
    } else if (d.role === "PRODUCTION_METER" || d.role === "SOLAR_INVERTER") {
      statusLabel = w !== null && w > 10 ? "En production" : "Au repos";
      if (statusLabel === "Au repos") status = "idle";
    } else if (d.type === "TUYA_SWITCH") {
      const on = r?.switchOn !== false && (w ?? 0) > 10;
      statusLabel = r?.switchOn === false ? "Éteint" : on ? "En marche" : "En veille";
      if (!on) status = "idle";
    }
    let value = "—";
    if (d.role === "BATTERY") value = r?.soc !== null && r?.soc !== undefined ? `${Math.round(r.soc)} %` : "—";
    else if (w !== null && !stale) value = Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
    return { id: d.id, name: d.name, network: net, status, statusLabel, value };
  });
}
