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
  let measuredSubtotalW = 0;
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
    if (isOn) measuredSubtotalW += w;
  }
  const measuredProfileIds = new Set(measuredOutputs.map((m) => m.profile.id));
  // Profils restants : combinatoire + filtre fenêtre horaire.
  const profiles = allProfiles
    .filter((p) => !measuredProfileIds.has(p.id))
    .filter((p) => inActiveWindow(p.activeStartHour, p.activeEndHour));

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

  // Pour la détection d'appareils on prend la conso "vue par le compteur"
  // = prod + grid (sans le PowerStream). La baseline est apprise quand le
  // PS n'injecte pas encore, donc l'ajouter fausserait le delta de la
  // valeur d'injection PS et masquerait les appareils détectables.
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
  // p35 sur la fenêtre 8-22h : compromis entre p25 (trop bas, capte
  // surtout les moments creux du matin) et p50 (qui inclut la pompe
  // si elle tourne >50% du temps). Cible empirique : 1000-1100 W.
  // L'utilisateur peut toujours forcer via loadsBaselineW.
  const dayBase = dayConsos.length >= 30 ? percentile(dayConsos, 0.35) : null;
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
  // Delta restant à expliquer après avoir retiré ce qui est déjà
  // attribué aux prises mesurées (jacuzzi, voiture, etc.).
  const deltaResidualW =
    deltaW !== null ? deltaW - measuredSubtotalW : null;

  // Détection combinatoire : on cherche le sous-ensemble de profils
  // dont la somme des expectedPowerW est la plus proche de deltaW.
  // Évite que jacuzzi (1900) + pompe (500) = 2400 fasse aussi matcher
  // la voiture électrique (2400) parce que le code regardait chaque
  // profil indépendamment. N profils → 2^N combinaisons (max ~1024
  // pour 10 profils, négligeable).
  let bestMask = 0;
  let bestDistance = Infinity;
  let bestPopcount = 0;
  if (deltaResidualW !== null && profiles.length > 0 && profiles.length <= 16) {
    const total = 1 << profiles.length;
    // Si le résiduel est clairement non négligeable (>100 W), le subset
    // vide ne doit PAS gagner par défaut : un appareil non mesuré est
    // probablement actif. On commence donc l'énumération à mask=1
    // (sauf si résiduel proche de 0 où le vide est la bonne réponse).
    const skipEmpty = deltaResidualW > 100;
    const startMask = skipEmpty ? 1 : 0;
    for (let mask = startMask; mask < total; mask++) {
      let sum = 0;
      let popcount = 0;
      for (let i = 0; i < profiles.length; i++) {
        if (mask & (1 << i)) {
          sum += profiles[i]!.expectedPowerW;
          popcount++;
        }
      }
      const dist = Math.abs(deltaResidualW - sum);
      // Tiebreaker à distance égale : préfère le sous-ensemble avec
      // PLUS d'appareils. Si {voiture 2400} et {jacuzzi+pompe 2400}
      // matchent tous les deux à dist=0, on retient jacuzzi+pompe :
      // une explication composée est plus probable qu'un appareil
      // unique de même puissance qui ne tourne typiquement pas en
      // même temps (cf. plages horaires différentes).
      if (
        dist < bestDistance ||
        (dist === bestDistance && popcount > bestPopcount)
      ) {
        bestDistance = dist;
        bestMask = mask;
        bestPopcount = popcount;
      }
    }
  }
  // Tolérance globale du sous-ensemble : somme des tolérances des
  // profils retenus, plancher 100 W. Si l'écart dépasse, on considère
  // qu'aucun appareil ne matche bien (delta inexpliqué).
  let bestSubsetTolerance = 100;
  for (let i = 0; i < profiles.length; i++) {
    if (bestMask & (1 << i)) bestSubsetTolerance += profiles[i]!.toleranceW;
  }
  const subsetMatches = bestDistance <= bestSubsetTolerance;

  const heuristicOut = profiles.map((p, i) => {
    if (deltaResidualW === null) {
      return {
        id: p.id,
        name: p.name,
        expectedW: p.expectedPowerW,
        currentlyOn: false,
        confidence: 0,
        source: "heuristic" as const,
      };
    }
    const inSubset = (bestMask & (1 << i)) !== 0 && subsetMatches;
    const distance = Math.abs(deltaResidualW - p.expectedPowerW);
    const confidence = inSubset
      ? Math.max(0, 1 - bestDistance / Math.max(bestSubsetTolerance, 1))
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
      baselineOverride: typeof override === "number" ? override : null,
      baselineNightW: nightBase !== null ? Math.round(nightBase) : null,
      baselineDayW: dayBase !== null ? Math.round(dayBase) : null,
      baselineUsed: useNight ? "night" : "day",
      profiles: profilesOut,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
