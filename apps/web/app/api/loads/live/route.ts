// Détection live de l'état ON/OFF de chaque LoadProfile.
//
// Heuristique :
//  - conso_courante = moyenne des derniers ~2 min du compteur conso.
//  - conso_base = médiane des 60 dernières min après suppression des
//    outliers (10e..70e percentile pour rester sur le "plancher").
//    Cette base correspond à la conso permanente (réfrigérateur, box,
//    veille…). Vu qu'on a observé ~650-700 W la nuit chez l'utilisateur,
//    on borne la base entre 200 et 1500 W pour éviter qu'elle dérive
//    quand un gros appareil tourne tout le temps.
//  - delta = current - base. Pour chaque profil, si
//    |delta - expectedW| <= toleranceW → ON. Si plusieurs matchent,
//    on retient celui dont l'écart est le plus petit.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RECENT_MIN = 2;
const BASE_MIN = 60;

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(s.length - 1, Math.floor(s.length * p)));
  return s[i]!;
}

export async function GET() {
  // Conso bilanée : prod + grid (signé). Le Shelly CONSUMPTION_METER
  // mesure souvent un sous-circuit et ignore les gros consommateurs
  // sur d'autres tableaux (PAC, piscine). On reconstruit donc la
  // série conso depuis production_meter + grid_meter, comme le snapshot.
  const [prodDev, gridDev] = await Promise.all([
    prisma.device.findFirst({
      where: { enabled: true, role: "PRODUCTION_METER" as never },
    }),
    prisma.device.findFirst({
      where: { enabled: true, role: "GRID_METER" as never },
    }),
  ]);
  const profiles = await prisma.loadProfile.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });

  if (!prodDev || !gridDev) {
    return NextResponse.json({
      currentW: null,
      baseW: null,
      deltaW: null,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        expectedW: p.expectedPowerW,
        currentlyOn: false,
        confidence: 0,
      })),
    });
  }

  const since = new Date(Date.now() - BASE_MIN * 60_000);
  const [prodRows, gridRows] = await Promise.all([
    prisma.reading.findMany({
      where: { deviceId: prodDev.id, ts: { gte: since }, powerW: { not: null } },
      orderBy: { ts: "asc" },
      select: { ts: true, powerW: true },
    }),
    prisma.reading.findMany({
      where: { deviceId: gridDev.id, ts: { gte: since }, powerW: { not: null } },
      orderBy: { ts: "asc" },
      select: { ts: true, powerW: true },
    }),
  ]);

  // Bucket par minute : moyenne prod, moyenne grid puis conso = prod + grid.
  function bucket(rows: { ts: Date; powerW: number | null }[]) {
    const map = new Map<number, number[]>();
    for (const r of rows) {
      if (r.powerW === null) continue;
      const key = Math.floor(r.ts.getTime() / 60_000);
      const a = map.get(key) ?? [];
      a.push(r.powerW);
      map.set(key, a);
    }
    const out = new Map<number, number>();
    for (const [k, vs] of map) out.set(k, vs.reduce((a, b) => a + b, 0) / vs.length);
    return out;
  }
  const prodB = bucket(prodRows);
  const gridB = bucket(gridRows);
  // Pour chaque minute on calcule conso = prod + grid (les deux signés).
  const consoSeries: { tsMin: number; w: number }[] = [];
  for (const [k, p] of prodB) {
    const g = gridB.get(k);
    if (g === undefined) continue;
    consoSeries.push({ tsMin: k, w: Math.max(0, p + g) });
  }
  consoSeries.sort((a, b) => a.tsMin - b.tsMin);
  const powers = consoSeries.map((x) => x.w).filter((w) => w > 0);

  const recentMinKey = Math.floor((Date.now() - RECENT_MIN * 60_000) / 60_000);
  const recents = consoSeries
    .filter((x) => x.tsMin >= recentMinKey)
    .map((x) => x.w);
  const currentW =
    recents.length > 0 ? recents.reduce((a, b) => a + b, 0) / recents.length : null;

  // 2 baselines apprises sur 7 jours :
  //  - nocturne : mediane 2h-5h du matin (rien ne tourne)
  //  - diurne   : 25e percentile 8h-22h (capture les moments calmes
  //               de journee, hors gros appareils typiquement actifs)
  // On choisit selon l'heure courante : nocturne en [22-6], diurne sinon.
  let baseW: number | null = null;
  const sinceWeek = new Date(Date.now() - 7 * 24 * 3_600_000);
  const [prodWeek, gridWeek] = await Promise.all([
    prisma.reading.findMany({
      where: { deviceId: prodDev.id, ts: { gte: sinceWeek }, powerW: { not: null } },
      select: { ts: true, powerW: true },
    }),
    prisma.reading.findMany({
      where: { deviceId: gridDev.id, ts: { gte: sinceWeek }, powerW: { not: null } },
      select: { ts: true, powerW: true },
    }),
  ]);

  // Buckets par minute, séparés en NIGHT (2-5h) et DAY (8-22h).
  type Bucket = { p: number[]; g: number[] };
  const nightBuckets = new Map<number, Bucket>();
  const dayBuckets = new Map<number, Bucket>();
  const accumulate = (
    map: Map<number, Bucket>,
    rows: typeof prodWeek,
    field: "p" | "g",
    hourFilter: (h: number) => boolean,
  ) => {
    for (const r of rows) {
      if (r.powerW === null) continue;
      if (!hourFilter(r.ts.getHours())) continue;
      const k = Math.floor(r.ts.getTime() / 60_000);
      const b = map.get(k) ?? { p: [], g: [] };
      b[field].push(r.powerW);
      map.set(k, b);
    }
  };
  const isNight = (h: number) => h >= 2 && h < 5;
  const isDay = (h: number) => h >= 8 && h < 22;
  accumulate(nightBuckets, prodWeek, "p", isNight);
  accumulate(nightBuckets, gridWeek, "g", isNight);
  accumulate(dayBuckets, prodWeek, "p", isDay);
  accumulate(dayBuckets, gridWeek, "g", isDay);

  const seriesFromBuckets = (m: Map<number, Bucket>): number[] => {
    const out: number[] = [];
    for (const [, b] of m) {
      if (b.p.length === 0 || b.g.length === 0) continue;
      const p = b.p.reduce((a, x) => a + x, 0) / b.p.length;
      const g = b.g.reduce((a, x) => a + x, 0) / b.g.length;
      out.push(Math.max(0, p + g));
    }
    return out;
  };
  const nightConsos = seriesFromBuckets(nightBuckets);
  const dayConsos = seriesFromBuckets(dayBuckets);
  const nightBase = nightConsos.length >= 30 ? median(nightConsos) : null;
  // p50 (médiane) sur la fenêtre 8-22h : représente le "fond permanent"
  // journée (frigo, box, ordis, multiprises). Ajusté empiriquement sur
  // les données utilisateur qui rapporte 1000-1100 W de base journée.
  const dayBase = dayConsos.length >= 30 ? percentile(dayConsos, 0.5) : null;
  const currentHour = new Date().getHours();
  const useNight = currentHour < 6 || currentHour >= 22;
  const autoBase = useNight ? nightBase ?? dayBase : dayBase ?? nightBase;
  // Override manuel : si l'utilisateur a fixé loadsBaselineW dans
  // ControlState, on l'utilise tel quel (court-circuite la détection auto).
  const ctrl = (await prisma.controlState.findUnique({
    where: { key: "default" },
  })) as { loadsBaselineW?: number | null } | null;
  const override = ctrl?.loadsBaselineW;
  if (typeof override === "number" && override > 0) {
    baseW = override;
  } else if (autoBase !== null) {
    baseW = Math.max(400, Math.min(2000, autoBase));
  } else if (powers.length >= 10) {
    // Pas assez de données apprises → fallback sur la fenêtre courte.
    const lo = percentile(powers, 0.1);
    const hi = percentile(powers, 0.7);
    const filtered = powers.filter((p) => p >= lo && p <= hi);
    baseW = Math.max(400, Math.min(1500, median(filtered)));
  } else {
    baseW = 700;
  }

  const deltaW = currentW !== null && baseW !== null ? currentW - baseW : null;

  const profilesOut = profiles.map((p) => {
    if (deltaW === null) {
      return {
        id: p.id,
        name: p.name,
        expectedW: p.expectedPowerW,
        currentlyOn: false,
        confidence: 0,
      };
    }
    const distance = Math.abs(deltaW - p.expectedPowerW);
    const within = distance <= p.toleranceW;
    // Confiance : 1.0 si en plein dans la cible, 0 au bord, négatif au-delà.
    const confidence = Math.max(0, 1 - distance / Math.max(p.toleranceW, 1));
    return {
      id: p.id,
      name: p.name,
      expectedW: p.expectedPowerW,
      currentlyOn: within,
      confidence,
    };
  });

  return NextResponse.json(
    {
      currentW: currentW !== null ? Math.round(currentW) : null,
      baseW: baseW !== null ? Math.round(baseW) : null,
      deltaW: deltaW !== null ? Math.round(deltaW) : null,
      baselineOverride: typeof override === "number" ? override : null,
      baselineNightW: nightBase !== null ? Math.round(nightBase) : null,
      baselineDayW: dayBase !== null ? Math.round(dayBase) : null,
      baselineUsed: useNight ? "night" : "day",
      profiles: profilesOut,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
