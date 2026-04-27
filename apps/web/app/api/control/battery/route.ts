import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Body {
  followLoadMaxW?: number;
  chargeMaxW?: number;
  chargeMinW?: number;
  chargeOffsetW?: number;
  chargeDeficitTimeoutMin?: number;
  chargeOffToOnLockMin?: number;
  tempoEnabled?: boolean;
  tempoRedDischargeHour?: number;
  tempoOtherDischargeHour?: number;
  tempoDischargeEndHour?: number;
  tempoDischargeTargetW?: number;
  tempoWakeupBeforeMin?: number;
  loadsBaselineW?: number | null;
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
  if (typeof body.chargeMinW === "number" && Number.isFinite(body.chargeMinW)) {
    data.chargeMinW = Math.max(0, Math.min(2200, Math.round(body.chargeMinW)));
  }
  if (typeof body.chargeOffsetW === "number" && Number.isFinite(body.chargeOffsetW)) {
    data.chargeOffsetW = Math.max(0, Math.min(2000, Math.round(body.chargeOffsetW)));
  }
  if (
    typeof body.chargeDeficitTimeoutMin === "number" &&
    Number.isFinite(body.chargeDeficitTimeoutMin)
  ) {
    data.chargeDeficitTimeoutMin = Math.max(
      0,
      Math.min(120, Math.round(body.chargeDeficitTimeoutMin)),
    );
  }
  if (
    typeof body.chargeOffToOnLockMin === "number" &&
    Number.isFinite(body.chargeOffToOnLockMin)
  ) {
    data.chargeOffToOnLockMin = Math.max(
      0,
      Math.min(60, Math.round(body.chargeOffToOnLockMin)),
    );
  }
  if (typeof body.tempoEnabled === "boolean") {
    (data as Record<string, unknown>).tempoEnabled = body.tempoEnabled;
  }
  for (const key of [
    "tempoRedDischargeHour",
    "tempoOtherDischargeHour",
    "tempoDischargeEndHour",
  ] as const) {
    const v = body[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      (data as Record<string, unknown>)[key] = Math.max(
        0,
        Math.min(23, Math.round(v)),
      );
    }
  }
  if (
    typeof body.tempoDischargeTargetW === "number" &&
    Number.isFinite(body.tempoDischargeTargetW)
  ) {
    (data as Record<string, unknown>).tempoDischargeTargetW = Math.max(
      0,
      Math.min(2200, Math.round(body.tempoDischargeTargetW)),
    );
  }
  if (
    typeof body.tempoWakeupBeforeMin === "number" &&
    Number.isFinite(body.tempoWakeupBeforeMin)
  ) {
    (data as Record<string, unknown>).tempoWakeupBeforeMin = Math.max(
      0,
      Math.min(120, Math.round(body.tempoWakeupBeforeMin)),
    );
  }
  if (body.loadsBaselineW === null) {
    (data as Record<string, unknown>).loadsBaselineW = null;
  } else if (
    typeof body.loadsBaselineW === "number" &&
    Number.isFinite(body.loadsBaselineW)
  ) {
    (data as Record<string, unknown>).loadsBaselineW = Math.max(
      0,
      Math.min(5000, Math.round(body.loadsBaselineW)),
    );
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no_field" }, { status: 400 });
  }

  const updated = await prisma.controlState.upsert({
    where: { key: "default" },
    create: { key: "default", ...data },
    update: data,
  });
  const u = updated as {
    chargeMaxW?: number;
    chargeMinW?: number;
    chargeOffsetW?: number;
  };
  return NextResponse.json({
    followLoadMaxW: updated.followLoadMaxW,
    chargeMaxW: u.chargeMaxW ?? null,
    chargeMinW: u.chargeMinW ?? null,
    chargeOffsetW: u.chargeOffsetW ?? null,
  });
}
