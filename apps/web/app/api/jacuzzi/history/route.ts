// Consommation du jacuzzi sur 24 h (prise Tuya mesurée, créneaux de
// 15 min) + part du réseau 2 et énergie du jour, pour la page /jacuzzi.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { periodRange } from "@/lib/costs";

export const dynamic = "force-dynamic";

const STEP_MS = 15 * 60_000;

export async function GET() {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3_600_000);
  const devices = await prisma.device.findMany({
    where: {
      enabled: true,
      OR: [
        { role: "APPLIANCE" as never, name: { contains: "acuzzi", mode: "insensitive" } },
        { role: "AUX_NETWORK_METER" as never },
      ],
    },
    select: { id: true, role: true },
  });
  const plug = devices.find((d) => d.role === "APPLIANCE");
  const auxIds = devices.filter((d) => d.role === "AUX_NETWORK_METER").map((d) => d.id);
  const rows = await prisma.reading.findMany({
    where: {
      deviceId: { in: devices.map((d) => d.id) },
      ts: { gte: from },
      powerW: { not: null },
    },
    select: { deviceId: true, ts: true, powerW: true },
  });

  const start = Math.floor(from.getTime() / STEP_MS) * STEP_MS;
  const n = Math.ceil((now.getTime() - start) / STEP_MS);
  const acc = (ids: string[]) => {
    const sum = new Array<number>(n).fill(0);
    const cnt = new Array<number>(n).fill(0);
    for (const r of rows) {
      if (!ids.includes(r.deviceId)) continue;
      const b = Math.floor((r.ts.getTime() - start) / STEP_MS);
      sum[b]! += Math.max(0, r.powerW!);
      cnt[b]!++;
    }
    return sum.map((s, i) => (cnt[i] ? s / cnt[i]! : null));
  };
  const spa = plug ? acc([plug.id]) : new Array<number | null>(n).fill(null);
  const aux = auxIds.length ? acc(auxIds) : new Array<number | null>(n).fill(null);

  // Énergie du jour (depuis minuit local) : intégrale des créneaux.
  const midnight = periodRange("today", now).from.getTime();
  let todayWh = 0;
  spa.forEach((w, i) => {
    if (w !== null && start + i * STEP_MS >= midnight) todayWh += w * (STEP_MS / 3_600_000);
  });

  return NextResponse.json(
    {
      todayWh: Math.round(todayWh),
      points: spa.map((w, i) => ({
        label: new Date(start + i * STEP_MS).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        }),
        spa: w === null ? null : Math.round(w),
        aux: aux[i] === null ? null : Math.round(aux[i]!),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
