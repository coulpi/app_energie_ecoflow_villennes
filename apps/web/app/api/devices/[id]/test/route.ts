import { NextResponse } from "next/server";
import { shelly as shellyNs, tuya as tuyaNs } from "@app/shared";
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
      const parsed = shellyNs.parseShellyExternalId(device.externalId);
      const meta =
        (device.vendorMeta as { channel?: number | null; invertSign?: boolean } | null) ??
        null;
      const channel =
        typeof meta?.channel === "number" ? meta.channel : parsed.channel;
      const reading = await shellyNs.fetchShellyStatus(
        parsed.baseUrl,
        undefined,
        channel,
      );
      const powerW =
        reading.powerW === null
          ? null
          : meta?.invertSign === true
            ? -reading.powerW
            : reading.powerW;
      // Puissance de chaque pince : permet d'identifier quel canal mesure
      // quel circuit (ex. réseau maison vs réseau piscine/jacuzzi).
      const channels = shellyNs.listShellyChannels(reading.raw);
      return NextResponse.json({
        ok: true,
        powerW,
        energyWh: reading.energyWh,
        channel,
        channels,
        raw: reading.raw,
      });
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
