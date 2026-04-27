import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Body {
  followLoadMaxW?: number;
  chargeMaxW?: number;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const data: Record<string, number> = {};
  if (typeof body.followLoadMaxW === "number" && Number.isFinite(body.followLoadMaxW)) {
    data.followLoadMaxW = Math.max(0, Math.min(2200, Math.round(body.followLoadMaxW)));
  }
  if (typeof body.chargeMaxW === "number" && Number.isFinite(body.chargeMaxW)) {
    data.chargeMaxW = Math.max(0, Math.min(2200, Math.round(body.chargeMaxW)));
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no_field" }, { status: 400 });
  }

  const updated = await prisma.controlState.upsert({
    where: { key: "default" },
    create: { key: "default", ...data },
    update: data,
  });
  return NextResponse.json({
    followLoadMaxW: updated.followLoadMaxW,
    chargeMaxW: (updated as { chargeMaxW?: number }).chargeMaxW ?? null,
  });
}
