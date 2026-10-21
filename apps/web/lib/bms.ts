// État de la batterie remonté par le BMS de la Delta Max (champs MQTT
// bmsMaster.* / ems.* / inv.* / pd.* / mppt.* consolidés par le worker,
// GET /battery/bms). Conversion en grandeurs lisibles + niveaux d'alerte.
// Sans dépendance serveur : importable par les composants client.

export interface BmsRaw {
  updatedAt: string | null;
  fields: Record<string, number>;
}

export type Level = "ok" | "warn" | "bad";

export interface BmsSummary {
  updatedAt: string | null;
  socPct: number | null;
  sohPct: number | null;
  cycles: number | null;
  designCapAh: number | null;
  fullCapAh: number | null;
  remainCapAh: number | null;
  packV: number | null;
  /** Courant pack en A : + charge, − décharge. */
  packA: number | null;
  remainWh: number | null;
  fullWh: number | null;
  cellCount: number | null;
  cellMinV: number | null;
  cellMaxV: number | null;
  cellDiffMv: number | null;
  cellDiffLevel: Level | null;
  cellTempMin: number | null;
  cellTempMax: number | null;
  cellTempLevel: Level | null;
  mosTempMax: number | null;
  inverterTemp: number | null;
  inverterInTemp: number | null;
  /** Minutes restantes avant plein (en charge) ou vide (en décharge). */
  remainMin: number | null;
  direction: "charge" | "discharge" | "idle" | null;
  faults: Array<{ source: string; code: number }>;
}

// Codes de défaut / erreur surveillés (0 = rien à signaler).
const FAULT_FIELDS: Array<[string, string]> = [
  ["bmsMaster.bmsFault", "BMS"],
  ["bmsMaster.allBmsFault", "BMS (global)"],
  ["bmsMaster.errCode", "BMS"],
  ["bmsMaster.allErrCode", "BMS (global)"],
  ["inv.errCode", "Onduleur"],
  ["pd.errCode", "Carte de puissance"],
  ["mppt.faultCode", "MPPT"],
];

// Écart entre cellules (mV) : au repos < 50 mV est sain ; il grandit en
// charge / décharge forte. Au-delà de 200 mV, déséquilibre à surveiller.
const CELL_DIFF_WARN_MV = 100;
const CELL_DIFF_BAD_MV = 200;
// Température cellules (°C).
const CELL_TEMP_WARN = 45;
const CELL_TEMP_BAD = 55;

export function summarizeBms(raw: BmsRaw): BmsSummary {
  const f = raw.fields;
  const n = (k: string): number | null => {
    const v = f[k];
    // 0xFFFFFFFF = compteur non supporté par le firmware.
    return typeof v === "number" && Number.isFinite(v) && v !== 4294967295 ? v : null;
  };
  const div = (k: string, d: number) => {
    const v = n(k);
    return v === null ? null : v / d;
  };

  const packV = div("bmsMaster.vol", 1000);
  const packA = div("bmsMaster.amp", 1000);
  const remainCapAh = div("bmsMaster.remainCap", 1000);
  const fullCapAh = div("bmsMaster.fullCap", 1000);
  const cellMin = n("bmsMaster.minCellVol");
  const cellMax = n("bmsMaster.maxCellVol");
  const cellDiffMv =
    n("bmsMaster.maxVolDiff") ?? (cellMin !== null && cellMax !== null ? cellMax - cellMin : null);
  const tMax = n("bmsMaster.maxCellTemp");
  const direction =
    packA === null ? null : packA > 0.5 ? "charge" : packA < -0.5 ? "discharge" : "idle";

  return {
    updatedAt: raw.updatedAt,
    socPct: n("bmsMaster.f32ShowSoc") ?? n("bmsMaster.soc"),
    sohPct: n("bmsMaster.soh"),
    cycles: n("bmsMaster.cycles"),
    designCapAh: div("bmsMaster.designCap", 1000),
    fullCapAh,
    remainCapAh,
    packV,
    packA,
    remainWh: remainCapAh !== null && packV !== null ? remainCapAh * packV : null,
    fullWh: fullCapAh !== null && packV !== null ? fullCapAh * packV : null,
    cellCount: n("bmsMaster.cellSeriesNum"),
    cellMinV: cellMin === null ? null : cellMin / 1000,
    cellMaxV: cellMax === null ? null : cellMax / 1000,
    cellDiffMv,
    cellDiffLevel:
      cellDiffMv === null
        ? null
        : cellDiffMv > CELL_DIFF_BAD_MV
          ? "bad"
          : cellDiffMv > CELL_DIFF_WARN_MV
            ? "warn"
            : "ok",
    cellTempMin: n("bmsMaster.minCellTemp"),
    cellTempMax: tMax,
    cellTempLevel:
      tMax === null ? null : tMax >= CELL_TEMP_BAD ? "bad" : tMax >= CELL_TEMP_WARN ? "warn" : "ok",
    mosTempMax: n("bmsMaster.maxMosTemp"),
    inverterTemp: n("inv.outTemp"),
    inverterInTemp: n("inv.dcInTemp"),
    remainMin:
      direction === "charge"
        ? n("ems.chgRemainTime")
        : direction === "discharge"
          ? n("ems.dsgRemainTime")
          : null,
    direction,
    faults: FAULT_FIELDS.flatMap(([k, source]) => {
      const v = n(k);
      return v ? [{ source, code: v }] : [];
    }),
  };
}

const WORKER = process.env.WORKER_INTERNAL_URL ?? "http://worker:3100";

/** Lecture serveur (routes API, alertes du tableau de bord). */
export async function fetchBms(timeoutMs = 3000): Promise<BmsSummary | null> {
  try {
    const r = await fetch(`${WORKER}/battery/bms`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return summarizeBms((await r.json()) as BmsRaw);
  } catch {
    return null;
  }
}
