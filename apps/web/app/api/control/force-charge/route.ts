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
    forceChargeDailyEnabled?: boolean;
    forceChargeDailyTime?: string;
    forceChargeDailySoc?: number;
    forceChargeDailyWatts?: number;
    forceChargeDailyLastDate?: string | null;
    surplusChargeEnabled?: boolean;
  } | null;
  return NextResponse.json({
    daily: {
      enabled: c?.forceChargeDailyEnabled ?? false,
      time: c?.forceChargeDailyTime ?? "22:00",
      soc: c?.forceChargeDailySoc ?? 90,
      watts: c?.forceChargeDailyWatts ?? 1000,
      lastDate: c?.forceChargeDailyLastDate ?? null,
    },
    surplusChargeEnabled: c?.surplusChargeEnabled ?? false,
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
  // Réglages (sans toucher au forçage en cours) : programme quotidien et
  // charge sur surplus solaire.
  daily?: { enabled?: boolean; time?: string; soc?: number; watts?: number };
  surplusChargeEnabled?: boolean;
}

/** Met à jour le programme quotidien / la charge surplus. null si rien à faire. */
function settingsUpdate(body: Body): Record<string, unknown> | null | "invalid_time" {
  const data: Record<string, unknown> = {};
  if (typeof body.surplusChargeEnabled === "boolean") {
    data.surplusChargeEnabled = body.surplusChargeEnabled;
  }
  const d = body.daily;
  if (d && typeof d === "object") {
    if (typeof d.enabled === "boolean") data.forceChargeDailyEnabled = d.enabled;
    if (typeof d.time === "string") {
      const m = /^(\d{1,2}):(\d{2})$/.exec(d.time.trim());
      const [, hh = "", mm = ""] = m ?? [];
      if (!m || Number(hh) > 23 || Number(mm) > 59) return "invalid_time";
      data.forceChargeDailyTime = `${hh.padStart(2, "0")}:${mm}`;
      // Horaire modifié → autorise un déclenchement dès aujourd'hui.
      data.forceChargeDailyLastDate = null;
    }
    if (typeof d.soc === "number" && Number.isFinite(d.soc)) {
      data.forceChargeDailySoc = Math.max(5, Math.min(100, Math.round(d.soc)));
    }
    if (typeof d.watts === "number" && Number.isFinite(d.watts)) {
      data.forceChargeDailyWatts = Math.max(100, Math.min(2000, Math.round(d.watts)));
    }
  }
  return Object.keys(data).length > 0 ? data : null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Réglages seuls (programme quotidien / charge surplus).
  if (body.daily !== undefined || body.surplusChargeEnabled !== undefined) {
    const data = settingsUpdate(body);
    if (data === "invalid_time") {
      return NextResponse.json({ error: "invalid_time" }, { status: 400 });
    }
    if (data) {
      await prisma.controlState.upsert({
        where: { key: "default" },
        create: { key: "default", ...data },
        update: data,
      });
    }
    return NextResponse.json({ ok: true });
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
