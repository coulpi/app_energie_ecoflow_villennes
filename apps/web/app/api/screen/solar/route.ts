// Production panneau par panneau pour l'écran ESPHome tabscreen1 (page 3),
// dans l'ordre physique du schéma (lib/solar-layout). Lue toutes les 60 s.
//   w[i] : puissance du panneau (W entiers, -1 = indisponible)
//   s[i] : 0 indisponible, 1 production, 2 0 W, 3 pas de réseau AC
// Panneaux 0-5 = 1re zone (jardin), 6-11 = 2e zone (abri).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AC_MIN_V, ARRAYS, SOLAR_STALE_MS } from "@/lib/solar-layout";

export const dynamic = "force-dynamic";

export async function GET() {
  const sns = ARRAYS.flatMap((a) => a.sns);
  const devices = await prisma.device.findMany({
    where: { externalId: { in: sns }, type: "APSYSTEMS_INVERTER" },
    select: { id: true, externalId: true },
  });
  const idOf = new Map(devices.map((d) => [d.externalId, d.id]));
  const since = new Date(Date.now() - SOLAR_STALE_MS);

  const w: number[] = [];
  const s: number[] = [];
  for (const sn of sns) {
    const id = idOf.get(sn);
    const rows = id
      ? await prisma.solarPanelReading.findMany({
          where: { deviceId: id, ts: { gte: since } },
          orderBy: { ts: "desc" },
          take: 4,
          select: { panelIndex: true, pW: true, acV: true },
        })
      : [];
    for (const i of [0, 1]) {
      const r = rows.find((x) => x.panelIndex === i);
      if (!r) {
        w.push(-1);
        s.push(0);
        continue;
      }
      const watts = Math.max(0, Math.round(r.pW ?? 0));
      w.push(watts);
      s.push(r.acV !== null && r.acV < AC_MIN_V ? 3 : watts > 0 ? 1 : 2);
    }
  }
  const zone = (k: number) => w.slice(k * 6, k * 6 + 6).reduce((a, v) => a + Math.max(0, v), 0);
  return NextResponse.json(
    { w, s, z0: zone(0), z1: zone(1), on: s.filter((x) => x === 1).length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
