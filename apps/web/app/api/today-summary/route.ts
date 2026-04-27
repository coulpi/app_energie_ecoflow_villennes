// Cumuls énergétiques sur les 24 dernières heures, lus depuis ReadingHourly
// (rollup pré-agrégé). Renvoie producedWh, consumedWh, exportedWh, savedEur.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PRICE_PER_KWH = 0.2516; // tarif bleu base ~mai 2026 (€/kWh, à ajuster)

async function rollupSum(
  role: string,
  field: "prodWh" | "consoWh",
  since: Date,
): Promise<number> {
  const dev = await prisma.device.findFirst({
    where: { enabled: true, role: role as never },
  });
  if (!dev) return 0;
  const rows = await prisma.readingHourly.findMany({
    where: { deviceId: dev.id, hourTs: { gte: since } },
    select: { prodWh: true, consoWh: true },
  });
  return rows.reduce((acc, r) => acc + ((r[field] ?? 0) || 0), 0);
}

/** Intègre les Reading bruts (powerW signé) sur la fenêtre, en Wh. */
async function integrateGridExportedWh(since: Date): Promise<number> {
  const dev = await prisma.device.findFirst({
    where: { enabled: true, role: "GRID_METER" as never },
  });
  if (!dev) return 0;
  const rows = await prisma.reading.findMany({
    where: { deviceId: dev.id, ts: { gte: since } },
    orderBy: { ts: "asc" },
    select: { ts: true, powerW: true },
  });
  if (rows.length < 2) return 0;
  let exportedWh = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    if (a.powerW === null || b.powerW === null) continue;
    const dtH = (b.ts.getTime() - a.ts.getTime()) / 3_600_000;
    // Seul l'export compte (powerW < 0). On prend la moyenne du couple.
    const avg = (a.powerW + b.powerW) / 2;
    if (avg < 0) exportedWh += -avg * dtH;
  }
  return exportedWh;
}

export async function GET() {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [producedWh, consumedWh, exportedWh] = await Promise.all([
    rollupSum("PRODUCTION_METER", "prodWh", since),
    rollupSum("CONSUMPTION_METER", "consoWh", since),
    integrateGridExportedWh(since),
  ]);
  // Savings = production auto-consommée × prix kWh.
  // (production - export) = ce qui n'a pas été acheté au réseau.
  const savedKWh = Math.max(0, producedWh - exportedWh) / 1000;
  const savedEur = savedKWh * PRICE_PER_KWH;

  return NextResponse.json(
    {
      producedWh: Math.round(producedWh),
      consumedWh: Math.round(consumedWh),
      exportedWh: Math.round(exportedWh),
      savedEur: Number(savedEur.toFixed(2)),
      pricePerKWh: PRICE_PER_KWH,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
