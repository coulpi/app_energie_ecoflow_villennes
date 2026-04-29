import { NextResponse } from "next/server";
import { tuya as tuyaNs } from "@app/shared";
import { prisma } from "@/lib/prisma";

const { TuyaClient } = tuyaNs;

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) {
    return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  }

  if (device.type === "TUYA_METER" || device.type === "TUYA_SWITCH") {
    const clientId = process.env.TUYA_CLIENT_ID;
    const clientSecret = process.env.TUYA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: "Tuya non configuré (TUYA_CLIENT_ID/SECRET manquants)" },
        { status: 500 },
      );
    }
    const c = new TuyaClient({
      clientId,
      clientSecret,
      apiBase: process.env.TUYA_API_BASE,
    });
    try {
      const status = await c.getDeviceStatus(device.externalId);
      const signed = device.role === "GRID_METER";
      const powerW = TuyaClient.extractPowerW(status, signed);
      const energyWh = TuyaClient.extractEnergyWh(status);
      const switchOn =
        device.type === "TUYA_SWITCH"
          ? TuyaClient.extractSwitchOn(status)
          : null;
      // Persist le test comme un reading normal pour bénéficier des
      // historiques.
      await prisma.reading.create({
        data: {
          deviceId: device.id,
          ts: new Date(),
          powerW: powerW ?? null,
          energyWh: energyWh ?? null,
          switchOn,
          raw: status as unknown as object,
        },
      });
      return NextResponse.json({
        ok: true,
        powerW,
        energyWh,
        switchOn,
        raw: status,
      });
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 502 },
      );
    }
  }

  if (device.type === "SHELLY_METER") {
    try {
      const url = device.externalId.startsWith("http")
        ? device.externalId
        : `http://${device.externalId}/rpc/Shelly.GetStatus`;
      const r = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) {
        return NextResponse.json(
          { error: `HTTP ${r.status}` },
          { status: 502 },
        );
      }
      const j = (await r.json()) as Record<string, unknown>;
      // EM:0.act_power (3-em) ou switch:0.apower (plug-s)
      const em = j["em:0"] as { act_power?: number } | undefined;
      const sw = j["switch:0"] as { apower?: number; output?: boolean } | undefined;
      const powerW = em?.act_power ?? sw?.apower ?? null;
      const switchOn = sw?.output ?? null;
      return NextResponse.json({ ok: true, powerW, switchOn, raw: j });
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    {
      error: `Type ${device.type} non supporté pour le test (utiliser le poller live).`,
    },
    { status: 400 },
  );
}
