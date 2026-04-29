// Détection automatique des cycles d'appareils consommateurs récurrents.
//
// Algorithme : détection de **fronts** sur le compteur de conso maison.
//
//   1. Smooth la puissance par moyenne glissante 1-min.
//   2. À chaque pas, calcule delta = avg(t) - avg(t - LAG_MIN).
//   3. Pour chaque profil, un delta ≈ +expectedPowerW (± tolerance) =
//      front montant (l'appareil vient de démarrer). Un delta ≈
//      -expectedPowerW = front descendant (arrêt).
//   4. Apparie chaque front montant avec le front descendant suivant
//      du même profil pour former un LoadEvent.
//   5. Si le profil est en cours (front montant sans descendant), on
//      l'ignore — il sera complété au prochain run.
//
// Ce design détecte correctement les multi-charges qui se cumulent et
// ne dépend pas de la baseline absolue. Il nécessite cependant que le
// signal contienne le démarrage ET l'arrêt de l'appareil pendant la
// fenêtre d'analyse.

import { prisma } from "../db.js";
import { dayOfWeek } from "@app/shared";
import { log } from "../log.js";

interface PowerSample {
  ts: Date;
  w: number;
}

interface Edge {
  ts: Date;
  delta: number; // signé
  profileId: string;
}

const ANALYSIS_HOURS = 48;
const SMOOTH_MIN = 1; // moyenne glissante
const LAG_MIN = 3; // delta entre maintenant et il y a 3 min

export async function detectLoadsOnce(): Promise<void> {
  const since = new Date(Date.now() - ANALYSIS_HOURS * 3_600_000);

  const profiles = await prisma.loadProfile.findMany({
    where: { enabled: true },
  });

  // Source de la série conso : on privilegie un CONSUMPTION_METER dédié,
  // sinon on reconstruit depuis prod + grid (comme /api/loads/live).
  const cons = await prisma.device.findFirst({
    where: { enabled: true, role: "CONSUMPTION_METER" },
  });
  let raw: PowerSample[];
  if (cons) {
    const rows = await prisma.reading.findMany({
      where: {
        deviceId: cons.id,
        ts: { gte: since },
        powerW: { not: null },
      },
      orderBy: { ts: "asc" },
      select: { ts: true, powerW: true },
    });
    if (rows.length < 30) return;
    raw = rows.map((r) => ({
      ts: r.ts,
      w: Math.max(0, r.powerW ?? 0),
    }));
  } else {
    const [prodDev, gridDev] = await Promise.all([
      prisma.device.findFirst({
        where: { enabled: true, role: "PRODUCTION_METER" },
      }),
      prisma.device.findFirst({
        where: { enabled: true, role: "GRID_METER" },
      }),
    ]);
    if (!prodDev || !gridDev) return;
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
    // Joint par minute (bucketise) : conso ≈ prod + grid_signé.
    const bucket = (rows: { ts: Date; powerW: number | null }[]) => {
      const map = new Map<number, number[]>();
      for (const r of rows) {
        if (r.powerW === null) continue;
        const k = Math.floor(r.ts.getTime() / 60_000);
        const a = map.get(k) ?? [];
        a.push(r.powerW);
        map.set(k, a);
      }
      const out = new Map<number, number>();
      for (const [k, vs] of map)
        out.set(k, vs.reduce((a, b) => a + b, 0) / vs.length);
      return out;
    };
    const pB = bucket(prodRows);
    const gB = bucket(gridRows);
    raw = [];
    for (const [k, p] of pB) {
      const g = gB.get(k);
      if (g === undefined) continue;
      raw.push({ ts: new Date(k * 60_000), w: Math.max(0, p + g) });
    }
    raw.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    if (raw.length < 30) return;
  }
  const smooth = movingAverage(raw, SMOOTH_MIN);
  const edges = detectEdges(smooth, profiles, LAG_MIN);

  // Apparie les fronts par profil.
  const newEvents: Array<{
    profileId: string;
    startTs: Date;
    endTs: Date;
    avgPowerW: number;
    durationMin: number;
    matched: boolean;
    energyWh: number;
  }> = [];

  const byProfile = new Map<string, Edge[]>();
  for (const e of edges) {
    const arr = byProfile.get(e.profileId) ?? [];
    arr.push(e);
    byProfile.set(e.profileId, arr);
  }

  for (const [profileId, list] of byProfile) {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) continue;
    list.sort((a, b) => a.ts.getTime() - b.ts.getTime());

    let openStart: Edge | null = null;
    for (const e of list) {
      if (e.delta > 0) {
        if (openStart) continue; // ignore fronts montants doublés
        openStart = e;
      } else if (openStart) {
        const startTs = openStart.ts;
        const endTs = e.ts;
        const durMin = (endTs.getTime() - startTs.getTime()) / 60_000;
        if (durMin >= profile.minDurationMin) {
          // Calcule avg power sur le segment depuis le signal smooth.
          const seg = smooth.filter(
            (s) => s.ts >= startTs && s.ts <= endTs,
          );
          const avg =
            seg.length > 0
              ? seg.reduce((a, b) => a + b.w, 0) / seg.length
              : profile.expectedPowerW;
          newEvents.push({
            profileId: profile.id,
            startTs,
            endTs,
            avgPowerW: profile.expectedPowerW, // évite confusion avec autres charges
            durationMin: Math.round(durMin),
            matched: true,
            energyWh: (profile.expectedPowerW * durMin) / 60,
          });
        }
        openStart = null;
      }
    }
  }

  // Insère les events non chevauchants.
  let inserted = 0;
  for (const ev of newEvents) {
    const existing = await prisma.loadEvent.findFirst({
      where: {
        profileId: ev.profileId,
        startTs: {
          gte: new Date(ev.startTs.getTime() - 5 * 60_000),
          lte: new Date(ev.startTs.getTime() + 5 * 60_000),
        },
      },
    });
    if (existing) continue;
    await prisma.loadEvent.create({ data: ev });
    inserted++;
  }

  // Recalcule planning pour chaque profil.
  for (const p of profiles) {
    const events = await prisma.loadEvent.findMany({
      where: {
        profileId: p.id,
        startTs: { gte: new Date(Date.now() - 28 * 86_400_000) },
      },
      orderBy: { startTs: "asc" },
    });
    if (events.length === 0) {
      await prisma.loadProfile.update({
        where: { id: p.id },
        data: { detectedSchedule: null as never },
      });
      continue;
    }
    const bucket = new Map<string, { count: number; avgDur: number; avgPower: number }>();
    for (const e of events) {
      const dow = dayOfWeek(e.startTs);
      const hour = e.startTs.getHours();
      const k = `${dow}-${hour}`;
      const cur = bucket.get(k) ?? { count: 0, avgDur: 0, avgPower: 0 };
      cur.count += 1;
      cur.avgDur =
        (cur.avgDur * (cur.count - 1) + e.durationMin) / cur.count;
      cur.avgPower =
        (cur.avgPower * (cur.count - 1) + e.avgPowerW) / cur.count;
      bucket.set(k, cur);
    }
    const slots = Array.from(bucket.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([k, v]) => {
        const [dow, hour] = k.split("-").map(Number);
        return {
          dow,
          startHour: hour,
          avgDurationMin: Math.round(v.avgDur),
          avgPowerW: Math.round(v.avgPower),
          occurrences: v.count,
        };
      });

    await prisma.loadProfile.update({
      where: { id: p.id },
      data: {
        detectedSchedule: {
          slots,
          totalEvents: events.length,
          analyzedDays: 28,
        } as unknown as object,
      },
    });
  }

  if (inserted > 0 || edges.length > 0) {
    log.info("load detection", {
      edgesFound: edges.length,
      eventsInserted: inserted,
    });
  }
}

function movingAverage(samples: PowerSample[], windowMin: number): PowerSample[] {
  const out: PowerSample[] = [];
  let i0 = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i++) {
    const cutoff = samples[i]!.ts.getTime() - windowMin * 60_000;
    sum += samples[i]!.w;
    count += 1;
    while (i0 < i && samples[i0]!.ts.getTime() < cutoff) {
      sum -= samples[i0]!.w;
      count -= 1;
      i0 += 1;
    }
    out.push({ ts: samples[i]!.ts, w: sum / count });
  }
  return out;
}

function detectEdges(
  smooth: PowerSample[],
  profiles: Array<{ id: string; expectedPowerW: number; toleranceW: number }>,
  lagMin: number,
): Edge[] {
  const edges: Edge[] = [];
  const lagMs = lagMin * 60_000;

  for (let i = 1; i < smooth.length; i++) {
    const tNow = smooth[i]!.ts.getTime();
    // Trouve l'échantillon le plus proche de t - lagMs.
    let j = i - 1;
    while (j > 0 && smooth[j]!.ts.getTime() > tNow - lagMs) j--;
    if (j === i - 1) continue; // pas assez de recul
    const delta = smooth[i]!.w - smooth[j]!.w;
    const absDelta = Math.abs(delta);

    // Cherche le profil le mieux matché par cet edge.
    let best: { profileId: string; score: number; sign: number } | null = null;
    for (const p of profiles) {
      const diff = Math.abs(absDelta - p.expectedPowerW);
      if (diff <= p.toleranceW) {
        const score = diff / p.toleranceW;
        if (!best || score < best.score) {
          best = {
            profileId: p.id,
            score,
            sign: delta > 0 ? 1 : -1,
          };
        }
      }
    }
    if (best) {
      edges.push({
        ts: smooth[i]!.ts,
        delta: best.sign * absDelta,
        profileId: best.profileId,
      });
    }
  }

  // Suppression des edges quasi-doublons (même profil, < 60s d'écart, même sens)
  const filtered: Edge[] = [];
  for (const e of edges) {
    const last = filtered[filtered.length - 1];
    if (
      last &&
      last.profileId === e.profileId &&
      Math.sign(last.delta) === Math.sign(e.delta) &&
      e.ts.getTime() - last.ts.getTime() < 60_000
    ) {
      continue;
    }
    filtered.push(e);
  }
  return filtered;
}

export function startLoadDetection(): NodeJS.Timeout {
  return setInterval(
    () =>
      detectLoadsOnce().catch((e) =>
        log.error("load detection error", { error: (e as Error).message }),
      ),
    30 * 60_000,
  );
}
