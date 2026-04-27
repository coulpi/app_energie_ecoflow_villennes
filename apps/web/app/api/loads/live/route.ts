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
  const cons = await prisma.device.findFirst({
    where: { enabled: true, role: "CONSUMPTION_METER" as never },
  });
  const profiles = await prisma.loadProfile.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });

  if (!cons) {
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
  const rows = await prisma.reading.findMany({
    where: { deviceId: cons.id, ts: { gte: since }, powerW: { not: null } },
    orderBy: { ts: "asc" },
    select: { ts: true, powerW: true },
  });
  const powers = rows
    .map((r) => Math.max(0, r.powerW ?? 0))
    .filter((p) => p > 0);

  const recentSince = Date.now() - RECENT_MIN * 60_000;
  const recents = rows
    .filter((r) => r.ts.getTime() >= recentSince)
    .map((r) => Math.max(0, r.powerW ?? 0));
  const currentW =
    recents.length > 0 ? recents.reduce((a, b) => a + b, 0) / recents.length : null;

  // Plancher : 10e..70e percentile pour ignorer les gros pics ponctuels.
  let baseW: number | null = null;
  if (powers.length >= 10) {
    const lo = percentile(powers, 0.1);
    const hi = percentile(powers, 0.7);
    const filtered = powers.filter((p) => p >= lo && p <= hi);
    baseW = Math.max(200, Math.min(1500, median(filtered)));
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
      profiles: profilesOut,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
