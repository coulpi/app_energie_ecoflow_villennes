import { shelly as shellyNs } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";

export async function pollShellyOnce(): Promise<void> {
  const devices = await prisma.device.findMany({
    where: { enabled: true, type: "SHELLY_METER" },
  });
  if (devices.length === 0) return;

  await Promise.allSettled(
    devices.map(async (d) => {
      try {
        const reading = await shellyNs.fetchShellyStatus(d.externalId);
        const meta = (d.vendorMeta as { invertSign?: boolean } | null) ?? null;
        const invert = meta?.invertSign === true;
        const powerW =
          reading.powerW === null
            ? null
            : invert
              ? -reading.powerW
              : reading.powerW;
        await prisma.reading.create({
          data: {
            deviceId: d.id,
            ts: new Date(),
            powerW,
            energyWh: reading.energyWh,
            raw: reading.raw as object,
          },
        });
      } catch (e) {
        log.warn("shelly poll failed", {
          deviceId: d.id,
          url: d.externalId,
          error: (e as Error).message,
        });
      }
    }),
  );
}

export function startShellyPoller(intervalSeconds = env.POLL_INTERVAL_SECONDS) {
  log.info("starting shelly poller", { intervalSeconds });
  const tick = async () => {
    try {
      await pollShellyOnce();
    } catch (e) {
      log.error("shelly poll tick error", { error: (e as Error).message });
    }
  };
  void tick();
  return setInterval(tick, intervalSeconds * 1000);
}
