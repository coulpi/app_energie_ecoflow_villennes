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
  } | null;
  return NextResponse.json({
    forceChargeSoc: c?.forceChargeSoc ?? null,
    forceChargeWatts: c?.forceChargeWatts ?? 1000,
    batterySoc: snap.batterySoc,
    switchOn: snap.switchOn,
    batteryPowerW: snap.batteryPowerW,
  });
}

interface Body {
  // null = arrêter le forçage ; nombre = SoC cible (%).
  forceChargeSoc?: number | null;
  forceChargeWatts?: number;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.forceChargeSoc === null) {
    data.forceChargeSoc = null;
  } else if (
    typeof body.forceChargeSoc === "number" &&
    Number.isFinite(body.forceChargeSoc)
  ) {
    data.forceChargeSoc = Math.max(5, Math.min(100, Math.round(body.forceChargeSoc)));
  }
  if (
    typeof body.forceChargeWatts === "number" &&
    Number.isFinite(body.forceChargeWatts)
  ) {
    data.forceChargeWatts = Math.max(100, Math.min(2000, Math.round(body.forceChargeWatts)));
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no_field" }, { status: 400 });
  }

  const updated = await prisma.controlState.upsert({
    where: { key: "default" },
    create: { key: "default", ...data },
    update: data,
  });
  const u = updated as { forceChargeSoc?: number | null; forceChargeWatts?: number };
  return NextResponse.json({
    forceChargeSoc: u.forceChargeSoc ?? null,
    forceChargeWatts: u.forceChargeWatts ?? 1000,
  });
}
