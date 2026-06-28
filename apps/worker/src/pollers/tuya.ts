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
        // GRID_METER : on conserve le signe (+ import / - export).
        const signed = d.role === "GRID_METER";
        const meta = (d.vendorMeta as { invertSign?: boolean } | null) ?? null;
        const invert = meta?.invertSign === true;
        let powerW = TuyaClient.extractPowerW(status, signed);
        if (powerW !== null && invert) powerW = -powerW;
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

        // Pour les prises pilotables (TUYA_SWITCH), on vérifie en plus la
        // connexion cloud Tuya : le /status ci-dessus renvoie un état figé
        // en cache même hors-ligne, donc une prise déconnectée passerait
        // inaperçue alors que toutes nos commandes ON/OFF tombent dans le
        // vide (résultat `false`). On persiste `online` pour l'exposer dans
        // l'UI, et on loggue les transitions.
        if (d.type === "TUYA_SWITCH") {
          try {
            const online = await c.isOnline(d.externalId);
            const prevOnline = (d as { online?: boolean | null }).online ?? null;
            if (prevOnline !== online) {
              if (online) {
                log.info("tuya: prise de retour en ligne", {
                  deviceId: d.id,
                  name: d.name,
                });
              } else {
                log.warn("tuya: prise HORS LIGNE (commandes non délivrées)", {
                  deviceId: d.id,
                  name: d.name,
                });
              }
            }
            await prisma.device.update({
              where: { id: d.id },
              data: { online, onlineAt: new Date() } as never,
            });
          } catch (e) {
            log.warn("tuya online check failed", {
              deviceId: d.id,
              error: (e as Error).message,
            });
          }
        }
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
