import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDashboardSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

// État courant du forçage de charge + SoC live pour la progression.
export async function GET() {
  const [ctrl, snap] = await Promise.all([
    prisma.controlState.findUnique({ where: { key: "default" } }),
    getDashboardSnapshot(),
  ]);
  const c = ctrl as {
    forceChargeSoc?: number | null;
    forceChargeWatts?: number | null;
    forceChargeStartAt?: Date | null;
    forceChargeEndAt?: Date | null;
  } | null;
  return NextResponse.json({
    forceChargeSoc: c?.forceChargeSoc ?? null,
    forceChargeWatts: c?.forceChargeWatts ?? 1000,
    forceChargeStartAt: c?.forceChargeStartAt
      ? new Date(c.forceChargeStartAt).toISOString()
      : null,
    forceChargeEndAt: c?.forceChargeEndAt
      ? new Date(c.forceChargeEndAt).toISOString()
      : null,
    serverNow: new Date().toISOString(),
    batterySoc: snap.batterySoc,
    switchOn: snap.switchOn,
    batteryPowerW: snap.batteryPowerW,
  });
}

interface Body {
  // null = arrêter le forçage ; nombre = SoC cible (%).
  forceChargeSoc?: number | null;
  forceChargeWatts?: number;
  // Heure de démarrage (ISO). null/absent = démarrage immédiat.
  startAt?: string | null;
  // Durée max en minutes. null/absent/0 = pas de limite de durée.
  durationMin?: number | null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Arrêt / annulation : on remet tout à null.
  if (body.forceChargeSoc === null) {
    const updated = await prisma.controlState.upsert({
      where: { key: "default" },
      create: { key: "default" },
      update: {
        forceChargeSoc: null,
        forceChargeStartAt: null,
        forceChargeEndAt: null,
      } as never,
    });
    return NextResponse.json({ forceChargeSoc: null, stopped: true, key: updated.key });
  }

  const data: Record<string, unknown> = {};
  if (
    typeof body.forceChargeSoc === "number" &&
    Number.isFinite(body.forceChargeSoc)
  ) {
    data.forceChargeSoc = Math.max(5, Math.min(100, Math.round(body.forceChargeSoc)));
  } else {
    return NextResponse.json({ error: "forceChargeSoc_required" }, { status: 400 });
  }
  if (
    typeof body.forceChargeWatts === "number" &&
    Number.isFinite(body.forceChargeWatts)
  ) {
    data.forceChargeWatts = Math.max(100, Math.min(2000, Math.round(body.forceChargeWatts)));
  }

  // Démarrage : immédiat (null) ou programmé (ISO valide dans le futur).
  const now = Date.now();
  let startMs = now;
  if (typeof body.startAt === "string" && body.startAt) {
    const parsed = new Date(body.startAt).getTime();
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: "invalid_startAt" }, { status: 400 });
    }
    // Si l'heure est dans le passé (ou quasi), on démarre tout de suite.
    startMs = parsed > now + 30_000 ? parsed : now;
    data.forceChargeStartAt = startMs > now ? new Date(startMs) : null;
  } else {
    data.forceChargeStartAt = null;
  }

  // Durée max → échéance d'arrêt, calée sur le démarrage (programmé ou non).
  if (
    typeof body.durationMin === "number" &&
    Number.isFinite(body.durationMin) &&
    body.durationMin > 0
  ) {
    const dur = Math.min(24 * 60, Math.round(body.durationMin));
    data.forceChargeEndAt = new Date(startMs + dur * 60_000);
  } else {
    data.forceChargeEndAt = null;
  }

  const updated = await prisma.controlState.upsert({
    where: { key: "default" },
    create: { key: "default", ...data },
    update: data,
  });
  const u = updated as {
    forceChargeSoc?: number | null;
    forceChargeWatts?: number;
    forceChargeStartAt?: Date | null;
    forceChargeEndAt?: Date | null;
  };
  return NextResponse.json({
    forceChargeSoc: u.forceChargeSoc ?? null,
    forceChargeWatts: u.forceChargeWatts ?? 1000,
    forceChargeStartAt: u.forceChargeStartAt
      ? new Date(u.forceChargeStartAt).toISOString()
      : null,
    forceChargeEndAt: u.forceChargeEndAt
      ? new Date(u.forceChargeEndAt).toISOString()
      : null,
  });
}
