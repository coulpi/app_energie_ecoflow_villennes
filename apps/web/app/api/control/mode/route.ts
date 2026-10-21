// Bascule du mode de pilotage batterie. MANUAL : l'app n'envoie plus
// aucune commande (l'utilisateur pilote via l'app EcoFlow et la prise AC
// depuis /battery) ; un forçage de charge en cours est abandonné.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MODES = ["FOLLOW_LOAD", "RULES", "MANUAL", "OFF"] as const;

export async function POST(req: Request) {
  let body: { mode?: unknown };
  try {
    body = (await req.json()) as { mode?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const mode = body.mode;
  if (typeof mode !== "string" || !(MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: "mode invalide" }, { status: 400 });
  }
  const data: Record<string, unknown> = { mode };
  if (mode === "MANUAL") {
    data.forceChargeSoc = null;
    data.forceChargeStartAt = null;
    data.forceChargeEndAt = null;
  }
  await prisma.controlState.upsert({
    where: { key: "default" },
    create: { key: "default", ...data },
    update: data,
  });
  return NextResponse.json({ ok: true, mode });
}
