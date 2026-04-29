// Renvoie pour chaque rôle de mesure une série de N points (par défaut 30)
// sur les M dernières minutes (par défaut 60). Utilisé par les KPI cards
// de /flow pour afficher une vraie tendance plutôt qu'un random décoratif.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ROLES = [
  "PRODUCTION_METER",
  "CONSUMPTION_METER",
  "GRID_METER",
  "BATTERY",
] as const;

async function seriesFor(
  role: (typeof ROLES)[number],
  sinceMs: number,
  buckets: number,
): Promise<number[]> {
  const dev = await prisma.device.findFirst({
    where: { enabled: true, role: role as never },
  });
  if (!dev) return [];
  const since = new Date(sinceMs);
  // Pour la batterie on veut le SoC (%), pas la puissance (W) qui n'a
  // rien a voir avec le KPI "NIVEAU BATTERIE".
  const useSoc = role === "BATTERY";
  const rows = await prisma.reading.findMany({
    where: {
      deviceId: dev.id,
      ts: { gte: since },
      ...(useSoc ? { soc: { not: null } } : {}),
    },
    orderBy: { ts: "asc" },
    select: { ts: true, powerW: true, soc: true },
  });
  if (rows.length === 0) return [];

  // Bucketing temporel uniforme : chaque bucket = (now - sinceMs) / buckets.
  const now = Date.now();
  const span = now - sinceMs;
  const bucketMs = span / buckets;
  const sums = new Array<number>(buckets).fill(0);
  const counts = new Array<number>(buckets).fill(0);
  for (const r of rows) {
    const v = useSoc ? r.soc : r.powerW;
    if (v === null || v === undefined) continue;
    const idx = Math.min(
      buckets - 1,
      Math.max(0, Math.floor((r.ts.getTime() - sinceMs) / bucketMs)),
    );
    sums[idx]! += v;
    counts[idx]! += 1;
  }
  // Pour les buckets vides on reprend la dernière valeur connue (forward fill)
  // afin d'éviter les trous visuels.
  let last = 0;
  return sums.map((s, i) => {
    if (counts[i]! > 0) {
      last = s / counts[i]!;
      return last;
    }
    return last;
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const minutes = Math.max(5, Math.min(720, Number(url.searchParams.get("minutes") ?? 60)));
  const buckets = Math.max(8, Math.min(120, Number(url.searchParams.get("buckets") ?? 30)));
  const sinceMs = Date.now() - minutes * 60_000;

  const [production, consumption, grid, battery] = await Promise.all(
    ROLES.map((r) => seriesFor(r, sinceMs, buckets)),
  );

  return NextResponse.json(
    { production, consumption, grid, battery, minutes, buckets },
    { headers: { "Cache-Control": "no-store" } },
  );
}
