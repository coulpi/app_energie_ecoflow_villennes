import { ecoflow as ecoflowNs } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";

const { EcoFlowClient, connectEcoFlowMqtt } = ecoflowNs;

let restClient: InstanceType<typeof EcoFlowClient> | null = null;

export function getEcoFlowClient() {
  if (!restClient) {
    if (!env.ECOFLOW_ACCESS_KEY || !env.ECOFLOW_SECRET_KEY) {
      throw new Error(
        "ECOFLOW_ACCESS_KEY / ECOFLOW_SECRET_KEY non configurés",
      );
    }
    restClient = new EcoFlowClient({
      accessKey: env.ECOFLOW_ACCESS_KEY,
      secretKey: env.ECOFLOW_SECRET_KEY,
      apiBase: env.ECOFLOW_API_BASE,
    });
  }
  return restClient;
}

/**
 * Extrait des champs usuels du payload quota EcoFlow. Le mapping diffère
 * légèrement par modèle ; on liste les chemins les plus courants.
 */
export function extractEcoFlowMetrics(payload: Record<string, unknown>): {
  soc: number | null;
  inputW: number | null;
  outputW: number | null;
} {
  // Le payload MQTT EcoFlow a la forme :
  //   { id, cmdId, params: { "bmsMaster.soc": 39, "bmsMaster.inputWatts": 0, ... } }
  // ou directement à plat selon le firmware. On regarde dans `params` puis
  // à la racine, et on accepte les clés avec et sans préfixe `bmsMaster.` /
  // `pd.` / `inv.`.
  const sources: Record<string, unknown>[] = [];
  if (payload.params && typeof payload.params === "object") {
    sources.push(payload.params as Record<string, unknown>);
  }
  sources.push(payload);

  const get = (...keys: string[]): unknown => {
    for (const src of sources) {
      for (const k of keys) {
        if (src[k] !== undefined) return src[k];
      }
    }
    return undefined;
  };
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const soc = num(
    get("bmsMaster.soc", "soc", "f32ShowSoc", "bmsBattSoc", "pd.soc"),
  );
  const inputW = num(
    get(
      "bmsMaster.inputWatts",
      "inputWatts",
      "wattsInputSum",
      "pd.wattsInputSum",
      "inv.inputWatts",
    ),
  );
  const outputW = num(
    get(
      "bmsMaster.outputWatts",
      "outputWatts",
      "wattsOutputSum",
      "pd.wattsOutputSum",
      "inv.outputWatts",
    ),
  );

  return { soc, inputW, outputW };
}

export async function startEcoFlowMqtt(): Promise<void> {
  const batteries = await prisma.device.findMany({
    where: { enabled: true, type: "ECOFLOW_BATTERY" },
  });
  if (batteries.length === 0) {
    log.info("no ecoflow battery configured, skipping mqtt");
    return;
  }
  const client = getEcoFlowClient();
  const cert = await client.getMqttCertification();

  connectEcoFlowMqtt({
    cert,
    serialNumbers: batteries.map((b) => b.externalId),
    onMessage: async (sn, payload) => {
      try {
        const device = batteries.find((b) => b.externalId === sn);
        if (!device) return;
        const metrics = extractEcoFlowMetrics(
          payload as Record<string, unknown>,
        );
        // Convention : powerW signé positivement quand la batterie injecte
        // (output), négativement quand elle se charge (input).
        let powerW: number | null = null;
        if (metrics.outputW !== null && metrics.outputW > 0) {
          powerW = metrics.outputW;
        } else if (metrics.inputW !== null && metrics.inputW > 0) {
          powerW = -metrics.inputW;
        } else if (metrics.outputW !== null || metrics.inputW !== null) {
          powerW = 0;
        }
        // Si le message MQTT n'apporte aucune des 3 métriques utiles, on
        // évite d'écrire une ligne vide.
        if (
          metrics.soc === null &&
          metrics.inputW === null &&
          metrics.outputW === null
        ) {
          return;
        }
        await prisma.reading.create({
          data: {
            deviceId: device.id,
            ts: new Date(),
            powerW,
            soc: metrics.soc,
            raw: payload as object,
          },
        });
      } catch (e) {
        log.warn("ecoflow mqtt message handling failed", {
          sn,
          error: (e as Error).message,
        });
      }
    },
    onError: (e) =>
      log.warn("ecoflow mqtt error", { error: (e as Error).message }),
  });

  log.info("ecoflow mqtt subscribed", {
    devices: batteries.map((b) => b.externalId),
  });
}

/**
 * Poll REST de getQuotaAll pour chaque batterie : les MQTT topics
 * EcoFlow ne diffusent fiablement que `bmsMaster.*`. La puissance AC
 * réelle (entrée chargeur + sortie onduleur) est dans `inv.*` / `pd.*`.
 */
export async function pollEcoFlowOnce(): Promise<void> {
  const batteries = await prisma.device.findMany({
    where: { enabled: true, type: "ECOFLOW_BATTERY" },
  });
  if (batteries.length === 0) return;

  const client = getEcoFlowClient();
  await Promise.allSettled(
    batteries.map(async (b) => {
      try {
        const quota = await client.getQuotaAll(b.externalId);
        const metrics = extractEcoFlowMetrics(
          quota as Record<string, unknown>,
        );
        if (
          metrics.soc === null &&
          metrics.inputW === null &&
          metrics.outputW === null
        ) {
          return;
        }
        let powerW: number | null = null;
        if (metrics.outputW !== null && metrics.outputW > 0) {
          powerW = metrics.outputW;
        } else if (metrics.inputW !== null && metrics.inputW > 0) {
          powerW = -metrics.inputW;
        } else if (metrics.outputW !== null || metrics.inputW !== null) {
          powerW = 0;
        }
        await prisma.reading.create({
          data: {
            deviceId: b.id,
            ts: new Date(),
            powerW,
            soc: metrics.soc,
            raw: quota as object,
          },
        });
      } catch (e) {
        log.warn("ecoflow poll failed", {
          sn: b.externalId,
          error: (e as Error).message,
        });
      }
    }),
  );
}

export function startEcoFlowPoller(intervalSeconds: number) {
  log.info("starting ecoflow REST poller", { intervalSeconds });
  const tick = async () => {
    try {
      await pollEcoFlowOnce();
    } catch (e) {
      log.error("ecoflow poll tick error", { error: (e as Error).message });
    }
  };
  void tick();
  return setInterval(tick, intervalSeconds * 1000);
}
