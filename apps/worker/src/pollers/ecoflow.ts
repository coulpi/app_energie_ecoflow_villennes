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
export function extractEcoFlowMetrics(quota: Record<string, unknown>): {
  soc: number | null;
  inputW: number | null;
  outputW: number | null;
} {
  const get = (k: string): unknown => {
    const direct = quota[k];
    if (direct !== undefined) return direct;
    for (const v of Object.values(quota)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const nested = (v as Record<string, unknown>)[k];
        if (nested !== undefined) return nested;
      }
    }
    return undefined;
  };
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  return {
    soc: num(get("soc") ?? get("f32ShowSoc") ?? get("bmsBattSoc")),
    inputW: num(get("inputWatts") ?? get("wattsInputSum")),
    outputW: num(get("outputWatts") ?? get("wattsOutputSum")),
  };
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
        await prisma.reading.create({
          data: {
            deviceId: device.id,
            ts: new Date(),
            powerW: metrics.outputW ?? metrics.inputW ?? null,
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
