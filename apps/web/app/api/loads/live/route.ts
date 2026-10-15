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
//  - Les profils du réseau 2 (piscine, jacuzzi, PAC, voiture) sont
//    expliqués par le compteur réseau 2, pas par la conso maison.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isNetwork2 } from "@/lib/networks";

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
  const allProfiles = await prisma.loadProfile.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });
  // Filtre fenêtre horaire : un profil avec activeStartHour/activeEndHour
  // n'est éligible à la détection live que dans sa plage. La voiture
  // configurée 19h-7h n'est pas testée en journée → plus de faux positif
  // quand jacuzzi (1900W) + pompe (500W) somment 2400W = puissance EV.
  const hourNow = new Date().getHours();
  const inActiveWindow = (sH: number | null, eH: number | null) => {
    if (sH === null || eH === null) return true;
    if (eH > sH) return hourNow >= sH && hourNow < eH;
    return hourNow >= sH || hourNow < eH; // traverse minuit
  };
  // Mesure directe : pour chaque LoadProfile lié à une prise (Tuya/
  // Shelly), on lit la dernière mesure de ce device et on en déduit
  // currentlyOn sans heuristique. Plus fiable que la combinatoire
  // sur le delta global.
  const measuredIds = allProfiles
    .map((p) => (p as { measuredDeviceId: string | null }).measuredDeviceId)
    .filter((id): id is string => !!id);
  const measuredReadings = measuredIds.length
    ? await prisma.reading.findMany({
        where: {
          deviceId: { in: measuredIds },
          ts: { gte: new Date(Date.now() - 5 * 60_000) },
        },
        orderBy: { ts: "desc" },
        select: { deviceId: true, powerW: true, switchOn: true, ts: true },
      })
    : [];
  // Premier reading par deviceId (déjà ordonnés desc → on prend le 1er
  // rencontré).
  const lastByDevice = new Map<
    string,
    { powerW: number | null; switchOn: boolean | null }
  >();
  for (const r of measuredReadings) {
    if (!lastByDevice.has(r.deviceId)) {
      lastByDevice.set(r.deviceId, { powerW: r.powerW, switchOn: r.switchOn });
    }
  }
  // Profils mesurés : currentlyOn = switchOn=true OU powerW > seuil.
  // On les met de côté pour ne pas les inclure dans la combinatoire.
  // Leur puissance mesurée est aussi soustraite du delta avant la
  // combinatoire pour ne laisser que les profils "à deviner".
  const measuredOutputs: Array<{
    profile: typeof allProfiles[number];
    on: boolean;
    measuredW: number;
  }> = [];
  // Sous-totaux mesurés par réseau : chaque réseau a son propre compteur,
  // on n'y retranche que les prises qui y sont branchées.
  let measuredR1W = 0;
  let measuredR2W = 0;
  for (const p of allProfiles) {
    const mid = (p as { measuredDeviceId: string | null }).measuredDeviceId;
    if (!mid) continue;
    const r = lastByDevice.get(mid);
    if (!r) {
      measuredOutputs.push({ profile: p, on: false, measuredW: 0 });
      continue;
    }
    const onThr =
      (p as { measuredOnThresholdW: number | null }).measuredOnThresholdW ?? 30;
    const isOn =
      r.switchOn === true || (r.powerW !== null && r.powerW >= onThr);
    const w = r.powerW ?? 0;
    measuredOutputs.push({ profile: p, on: isOn, measuredW: isOn ? w : 0 });
    if (isOn) {
      if (isNetwork2(`${p.id} ${p.name}`)) measuredR2W += w;
      else measuredR1W += w;
    }
  }
  const measuredProfileIds = new Set(measuredOutputs.map((m) => m.profile.id));
  // Profils restants (à deviner) : filtre fenêtre horaire, puis répartis
  // par réseau. Ceux du réseau 2 (pompe piscine, PAC…) s'expliquent par
  // le compteur réseau 2, pas par la conso maison.
  const profiles = allProfiles
    .filter((p) => !measuredProfileIds.has(p.id))
    .filter((p) => inActiveWindow(p.activeStartHour, p.activeEndHour));
  const profilesR1 = profiles.filter((p) => !isNetwork2(`${p.id} ${p.name}`));
  const profilesR2 = profiles.filter((p) => isNetwork2(`${p.id} ${p.name}`));

  // ── Réseau 1 : conso bilanée (prod + grid) vs baseline apprise ──
  const r1 = prodDev && gridDev ? await network1Delta(prodDev.id, gridDev.id) : null;
  const ctrl = (await prisma.controlState.findUnique({
    where: { key: "default" },
  })) as { loadsBaselineW?: number | null } | null;
  const override = ctrl?.loadsBaselineW;
  let baseW: number | null = null;
  if (r1) {
    if (typeof override === "number" && override > 0) baseW = override;
    else if (r1.autoBase !== null) baseW = Math.max(400, Math.min(2000, r1.autoBase));
    else if (r1.powers.length >= 10) {
      // Pas assez de données apprises → fallback sur la fenêtre courte.
      const lo = percentile(r1.powers, 0.1);
      const hi = percentile(r1.powers, 0.7);
      const filtered = r1.powers.filter((p) => p >= lo && p <= hi);
      baseW = Math.max(400, Math.min(1500, median(filtered)));
    } else baseW = 700;
  }
  const currentW = r1?.currentW ?? null;
  const deltaW = currentW !== null && baseW !== null ? currentW - baseW : null;
  // Delta restant à expliquer après les prises mesurées du réseau 1.
  const residualR1 = deltaW !== null ? deltaW - measuredR1W : null;

  // ── Réseau 2 : compteur dédié − plancher − prises mesurées − charge batterie ──
  const residualR2 = profilesR2.length > 0 ? await network2Residual(measuredR2W) : null;

  const heuristicOut = [
    ...explain(profilesR1, residualR1),
    ...explain(profilesR2, residualR2),
  ];
  const measuredOut = measuredOutputs.map((m) => ({
    id: m.profile.id,
    name: m.profile.name,
    expectedW: m.profile.expectedPowerW,
    currentlyOn: m.on,
    confidence: m.on ? 1 : 0,
    source: "measured" as const,
    measuredW: Math.round(m.measuredW),
  }));
  // Profils filtrés hors fenêtre horaire : on les expose en off mais
  // visibles, pour cohérence d'affichage.
  const outOfWindow = allProfiles
    .filter((p) => !measuredProfileIds.has(p.id))
    .filter((p) => !inActiveWindow(p.activeStartHour, p.activeEndHour))
    .map((p) => ({
      id: p.id,
      name: p.name,
      expectedW: p.expectedPowerW,
      currentlyOn: false,
      confidence: 0,
      source: "out-of-window" as const,
    }));
  // Préserve l'ordre createdAt original.
  const indexById = new Map(allProfiles.map((p, i) => [p.id, i]));
  const profilesOut = [...measuredOut, ...heuristicOut, ...outOfWindow].sort(
    (a, b) => (indexById.get(a.id)! - indexById.get(b.id)!),
  );

  return NextResponse.json(
    {
      currentW: currentW !== null ? Math.round(currentW) : null,
      baseW: baseW !== null ? Math.round(baseW) : null,
      deltaW: deltaW !== null ? Math.round(deltaW) : null,
      residualR2W: residualR2 !== null ? Math.round(residualR2) : null,
      baselineOverride: typeof override === "number" ? override : null,
      baselineNightW: r1?.nightBase !== null && r1?.nightBase !== undefined ? Math.round(r1.nightBase) : null,
      baselineDayW: r1?.dayBase !== null && r1?.dayBase !== undefined ? Math.round(r1.dayBase) : null,
      baselineUsed: r1?.useNight ? "night" : "day",
      profiles: profilesOut,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

type Profile = {
  id: string;
  name: string;
  expectedPowerW: number;
  toleranceW: number;
};

/**
 * Détection combinatoire : sous-ensemble de profils dont la somme des
 * expectedPowerW est la plus proche du résiduel. Évite que jacuzzi (1900)
 * + pompe (500) = 2400 fasse aussi matcher la voiture (2400) en regardant
 * chaque profil indépendamment. N profils → 2^N combinaisons (N ≤ 16).
 */
function explain(profiles: Profile[], residual: number | null) {
  let bestMask = 0;
  let bestDistance = Infinity;
  let bestPopcount = 0;
  if (residual !== null && profiles.length > 0 && profiles.length <= 16) {
    const total = 1 << profiles.length;
    // Résiduel clairement non négligeable (>100 W) : le sous-ensemble vide
    // ne doit PAS gagner par défaut, un appareil non mesuré est actif.
    const startMask = residual > 100 ? 1 : 0;
    for (let mask = startMask; mask < total; mask++) {
      let sum = 0;
      let popcount = 0;
      for (let i = 0; i < profiles.length; i++) {
        if (mask & (1 << i)) {
          sum += profiles[i]!.expectedPowerW;
          popcount++;
        }
      }
      const dist = Math.abs(residual - sum);
      // À distance égale, préfère le sous-ensemble avec PLUS d'appareils
      // (une explication composée est plus probable).
      if (dist < bestDistance || (dist === bestDistance && popcount > bestPopcount)) {
        bestDistance = dist;
        bestMask = mask;
        bestPopcount = popcount;
      }
    }
  }
  // Tolérance du sous-ensemble : somme des tolérances, plancher 100 W.
  // Au-delà, aucun appareil ne matche bien (delta inexpliqué).
  let tolerance = 100;
  for (let i = 0; i < profiles.length; i++) {
    if (bestMask & (1 << i)) tolerance += profiles[i]!.toleranceW;
  }
  const matches = bestDistance <= tolerance;
  return profiles.map((p, i) => {
    if (residual === null) {
      return {
        id: p.id,
        name: p.name,
        expectedW: p.expectedPowerW,
        currentlyOn: false,
        confidence: 0,
        source: "heuristic" as const,
      };
    }
    const inSubset = (bestMask & (1 << i)) !== 0 && matches;
    const distance = Math.abs(residual - p.expectedPowerW);
    const confidence = inSubset
      ? Math.max(0, 1 - bestDistance / Math.max(tolerance, 1))
      : Math.max(0, 1 - distance / Math.max(p.toleranceW, 1)) * 0.3;
    return {
      id: p.id,
      name: p.name,
      expectedW: p.expectedPowerW,
      currentlyOn: inSubset,
      confidence,
      source: "heuristic" as const,
    };
  });
}

/**
 * Réseau 1 : conso « vue par le compteur » = prod + grid (sans le
 * PowerStream : la baseline est apprise sans injection), moyenne des
 * 2 dernières minutes, et 2 baselines apprises sur 7 jours :
 *  - nocturne : médiane 2h-5h (rien ne tourne) ;
 *  - diurne   : 35e percentile 8h-22h (compromis entre p25, trop bas, et
 *    p50 qui inclut les appareils qui tournent souvent).
 */
async function network1Delta(prodId: string, gridId: string) {
  const since = new Date(Date.now() - BASE_MIN * 60_000);
  const [prodRows, gridRows] = await Promise.all([
    prisma.reading.findMany({
      where: { deviceId: prodId, ts: { gte: since }, powerW: { not: null } },
      orderBy: { ts: "asc" },
      select: { ts: true, powerW: true },
    }),
    prisma.reading.findMany({
      where: { deviceId: gridId, ts: { gte: since }, powerW: { not: null } },
      orderBy: { ts: "asc" },
      select: { ts: true, powerW: true },
    }),
  ]);
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
  const consoSeries: { tsMin: number; w: number }[] = [];
  for (const [k, p] of prodB) {
    const g = gridB.get(k);
    if (g === undefined) continue;
    consoSeries.push({ tsMin: k, w: Math.max(0, p + g) });
  }
  consoSeries.sort((a, b) => a.tsMin - b.tsMin);
  const powers = consoSeries.map((x) => x.w).filter((w) => w > 0);
  const recentMinKey = Math.floor((Date.now() - RECENT_MIN * 60_000) / 60_000);
  const recents = consoSeries.filter((x) => x.tsMin >= recentMinKey).map((x) => x.w);
  const currentW = recents.length > 0 ? recents.reduce((a, b) => a + b, 0) / recents.length : null;

  const sinceWeek = new Date(Date.now() - 7 * 24 * 3_600_000);
  const [prodWeek, gridWeek] = await Promise.all([
    prisma.reading.findMany({
      where: { deviceId: prodId, ts: { gte: sinceWeek }, powerW: { not: null } },
      select: { ts: true, powerW: true },
    }),
    prisma.reading.findMany({
      where: { deviceId: gridId, ts: { gte: sinceWeek }, powerW: { not: null } },
      select: { ts: true, powerW: true },
    }),
  ]);
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
  const dayBase = dayConsos.length >= 30 ? percentile(dayConsos, 0.35) : null;
  const currentHour = new Date().getHours();
  const useNight = currentHour < 6 || currentHour >= 22;
  const autoBase = useNight ? nightBase ?? dayBase : dayBase ?? nightBase;
  return { currentW, powers, nightBase, dayBase, useNight, autoBase };
}

/**
 * Réseau 2 : puissance actuelle du compteur dédié (moyenne 2 min), moins
 * son plancher (10e percentile sur 24 h, borné à 300 W), les prises
 * mesurées du réseau 2 (jacuzzi, voiture…) et la charge batterie (prise
 * AC IN sur ce réseau). Ce qui reste s'explique par les appareils non
 * mesurés du réseau 2 (pompe piscine, PAC…). null si pas de compteur.
 */
async function network2Residual(measuredR2W: number): Promise<number | null> {
  const devices = await prisma.device.findMany({
    where: {
      enabled: true,
      role: { in: ["AUX_NETWORK_METER", "BATTERY_AC_SWITCH"] as never },
    },
    select: { id: true, role: true },
  });
  const auxIds = devices.filter((d) => d.role === "AUX_NETWORK_METER").map((d) => d.id);
  if (auxIds.length === 0) return null;
  const plugIds = devices.filter((d) => d.role === "BATTERY_AC_SWITCH").map((d) => d.id);
  const since = new Date(Date.now() - 24 * 3_600_000);
  const recentSince = Date.now() - RECENT_MIN * 60_000;
  const rows = await prisma.reading.findMany({
    where: { deviceId: { in: [...auxIds, ...plugIds] }, ts: { gte: since }, powerW: { not: null } },
    select: { deviceId: true, ts: true, powerW: true },
  });
  const auxAll = rows.filter((r) => auxIds.includes(r.deviceId)).map((r) => Math.max(0, r.powerW!));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const auxNow = avg(
    rows.filter((r) => auxIds.includes(r.deviceId) && r.ts.getTime() >= recentSince).map((r) => Math.max(0, r.powerW!)),
  );
  if (auxNow === null) return null;
  const plugNow =
    avg(rows.filter((r) => plugIds.includes(r.deviceId) && r.ts.getTime() >= recentSince).map((r) => Math.max(0, r.powerW!))) ?? 0;
  const floor = Math.min(300, percentile(auxAll, 0.1));
  return auxNow - floor - measuredR2W - plugNow;
}
