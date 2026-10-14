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

        // Connexion cloud Tuya : le /status ci-dessus renvoie un état figé
        // en cache même hors-ligne. Une prise déconnectée ne reçoit plus
        // nos commandes ON/OFF (résultat `false`) ; un compteur déconnecté
        // remonterait sa dernière puissance indéfiniment (vu : 336 W de
        // production toute la nuit). On persiste `online` pour l'UI et on
        // loggue les transitions.
        let online: boolean | null = null;
        try {
          online = await c.isOnline(d.externalId);
          const prevOnline = (d as { online?: boolean | null }).online ?? null;
          if (prevOnline !== online) {
            const what = d.type === "TUYA_SWITCH" ? "prise" : "compteur";
            if (online) {
              log.info(`tuya: ${what} de retour en ligne`, {
                deviceId: d.id,
                name: d.name,
              });
            } else {
              log.warn(
                d.type === "TUYA_SWITCH"
                  ? "tuya: prise HORS LIGNE (commandes non délivrées)"
                  : "tuya: compteur HORS LIGNE (mesure figée ignorée)",
                { deviceId: d.id, name: d.name },
              );
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

        // Compteur hors ligne : la mesure en cache est figée, on enregistre
        // une lecture vide (le snapshot retombe alors sur le bilan via la
        // pince Shelly maison) plutôt qu'une valeur fantôme.
        const stale = d.type === "TUYA_METER" && online === false;

        // GRID_METER : on conserve le signe (+ import / - export).
        const signed = d.role === "GRID_METER";
        const meta = (d.vendorMeta as { invertSign?: boolean } | null) ?? null;
        const invert = meta?.invertSign === true;
        let powerW = stale ? null : TuyaClient.extractPowerW(status, signed);
        if (powerW !== null && invert) powerW = -powerW;
        const energyWh = stale ? null : TuyaClient.extractEnergyWh(status);
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
