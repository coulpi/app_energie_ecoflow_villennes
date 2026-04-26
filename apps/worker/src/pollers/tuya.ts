import { tuya as tuyaNs } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";

const { TuyaClient } = tuyaNs;

let client: InstanceType<typeof TuyaClient> | null = null;

function getClient() {
  if (!client) {
    if (!env.TUYA_CLIENT_ID || !env.TUYA_CLIENT_SECRET) {
      throw new Error("TUYA_CLIENT_ID / TUYA_CLIENT_SECRET non configurés");
    }
    client = new TuyaClient({
      clientId: env.TUYA_CLIENT_ID,
      clientSecret: env.TUYA_CLIENT_SECRET,
      apiBase: env.TUYA_API_BASE,
    });
  }
  return client;
}

export async function pollTuyaOnce(): Promise<void> {
  const c = getClient();
  const devices = await prisma.device.findMany({
    where: {
      enabled: true,
      type: { in: ["TUYA_METER", "TUYA_SWITCH"] },
    },
  });
  if (devices.length === 0) return;

  await Promise.allSettled(
    devices.map(async (d) => {
      try {
        const status = await c.getDeviceStatus(d.externalId);
        const powerW = TuyaClient.extractPowerW(status);
        const energyWh = TuyaClient.extractEnergyWh(status);
        const switchOn =
          d.type === "TUYA_SWITCH" ? TuyaClient.extractSwitchOn(status) : null;

        await prisma.reading.create({
          data: {
            deviceId: d.id,
            ts: new Date(),
            powerW: powerW ?? null,
            energyWh: energyWh ?? null,
            switchOn,
            raw: status as unknown as object,
          },
        });
      } catch (e) {
        log.warn("tuya poll device failed", {
          deviceId: d.id,
          error: (e as Error).message,
        });
      }
    }),
  );
}

export function startTuyaPoller(intervalSeconds = env.POLL_INTERVAL_SECONDS) {
  log.info("starting tuya poller", { intervalSeconds });
  const tick = async () => {
    try {
      await pollTuyaOnce();
    } catch (e) {
      log.error("tuya poll tick error", { error: (e as Error).message });
    }
  };
  void tick();
  return setInterval(tick, intervalSeconds * 1000);
}
