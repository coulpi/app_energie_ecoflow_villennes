import { ecoflow as ecoflowNs, ecoflowPrivate as ecoflowPrivateNs } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";

const { EcoFlowClient, connectEcoFlowMqtt } = ecoflowNs;
const {
  EcoFlowPrivateClient,
  connectEcoFlowPrivateMqtt,
  publishEcoFlowPrivateCommand,
  publishEcoFlowRaw,
  requestEcoFlowPrivateQuota,
} = ecoflowPrivateNs;

import { ecoflowPowerstream as psNs } from "@app/shared";
const { createPowerStreamCommands, publishPowerStreamPayload } = psNs;
type PsAction =
  | { kind: "permanentWatts"; watts: number }
  | { kind: "supplyPriority"; priority: 0 | 1 }
  | { kind: "batUpper"; percent: number }
  | { kind: "batLower"; percent: number }
  | { kind: "feedProtect"; enabled: boolean };

export async function publishPowerStreamCommand(
  sn: string,
  action: PsAction,
): Promise<void> {
  const ctx = getEcoFlowPrivateMqtt();
  if (!ctx) throw new Error("ecoflow private mqtt non connecté");
  const cmds = createPowerStreamCommands(sn);
  let payload: Uint8Array;
  switch (action.kind) {
    case "permanentWatts":
      payload = cmds.setPermanentWatts(action.watts);
      break;
    case "supplyPriority":
      payload = cmds.setSupplyPriority(action.priority);
      break;
    case "batUpper":
      payload = cmds.setBatUpper(action.percent);
      break;
    case "batLower":
      payload = cmds.setBatLower(action.percent);
      break;
    case "feedProtect":
      payload = cmds.setFeedProtect(action.enabled);
      break;
  }
  await publishPowerStreamPayload(ctx.client, ctx.userId, sn, payload);
}

// Ring buffer des derniers messages reçus (debug commandes).
interface MqttRecv {
  ts: string;
  sn: string;
  payload: unknown;
}
const recvBuffer: MqttRecv[] = [];
function pushRecv(sn: string, payload: unknown) {
  recvBuffer.unshift({ ts: new Date().toISOString(), sn, payload });
  if (recvBuffer.length > 50) recvBuffer.length = 50;
}
export function getRecentEcoFlowMessages(n = 20): MqttRecv[] {
  return recvBuffer.slice(0, n);
}

let restClient: InstanceType<typeof EcoFlowClient> | null = null;

// Singletons pour permettre à actions.ts d'envoyer des commandes via le
// MQTT privé (l'API REST publique répond systématiquement 1006 sur Delta Max).
import type { MqttClient } from "mqtt";
let privateMqttClient: MqttClient | null = null;
let privateMqttUserId: string | null = null;

export function getEcoFlowPrivateMqtt(): {
  client: MqttClient;
  userId: string;
} | null {
  if (!privateMqttClient || !privateMqttUserId) return null;
  return { client: privateMqttClient, userId: privateMqttUserId };
}

export async function publishEcoFlowSet(
  sn: string,
  body: {
    moduleType: number;
    operateType: string;
    params: Record<string, unknown>;
  },
): Promise<void> {
  const ctx = getEcoFlowPrivateMqtt();
  if (!ctx) {
    throw new Error("ecoflow private mqtt non connecté");
  }
  await publishEcoFlowPrivateCommand(ctx.client, ctx.userId, sn, body);
}

export async function publishEcoFlowRawTopic(
  topic: string,
  payload: unknown,
): Promise<void> {
  const ctx = getEcoFlowPrivateMqtt();
  if (!ctx) {
    throw new Error("ecoflow private mqtt non connecté");
  }
  await publishEcoFlowRaw(ctx.client, topic, payload);
}

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

  // SoC : préfère f32ShowSoc (float) sinon entier.
  const soc = num(
    get(
      "bms_bmsStatus.f32ShowSoc",
      "f32ShowSoc",
      "pd.soc",
      "bmsMaster.soc",
      "soc",
      "bmsBattSoc",
    ),
  );

  // Puissance AC d'abord (inv.* / pd.*) — précision optimale.
  let inputW = num(
    get(
      "inv.inputWatts",
      "pd.wattsInputSum",
      "wattsInputSum",
      "inputWatts",
      "bmsMaster.inputWatts",
    ),
  );
  let outputW = num(
    get(
      "inv.outputWatts",
      "pd.wattsOutputSum",
      "wattsOutputSum",
      "outputWatts",
      "bmsMaster.outputWatts",
    ),
  );

  // Si pas de mesure AC dispo, on calcule la puissance DC depuis le BMS :
  //   P_DC = volt_V × amp_A = (vol_mV / 1000) × (amp_mA / 1000)
  // amp positif = charge ; amp négatif = décharge.
  if ((inputW === null || inputW === 0) && (outputW === null || outputW === 0)) {
    const ampMa = num(get("bmsMaster.amp", "bms_bmsStatus.amp"));
    const volMv = num(get("bmsMaster.vol", "bms_bmsStatus.vol"));
    if (ampMa !== null && volMv !== null && Math.abs(ampMa) > 50) {
      const dcWatts = (volMv * ampMa) / 1_000_000;
      if (dcWatts > 0) {
        inputW = dcWatts;
      } else {
        outputW = -dcWatts;
      }
    }
  }

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

  // Si email/password sont fournis, on utilise l'API privée (mobile)
  // qui expose tous les quotas (inv.*, pd.*, f32ShowSoc).
  if (env.ECOFLOW_EMAIL && env.ECOFLOW_PASSWORD) {
    try {
      const priv = new EcoFlowPrivateClient({
        email: env.ECOFLOW_EMAIL,
        password: env.ECOFLOW_PASSWORD,
        apiBase: env.ECOFLOW_API_BASE,
      });
      const cert = await priv.getMqttCertification();
      const client = connectEcoFlowPrivateMqtt({
        cert,
        serialNumbers: batteries.map((b) => b.externalId),
        onConnect: () =>
          log.info("ecoflow private mqtt subscribed", {
            devices: batteries.map((b) => b.externalId),
          }),
        onMessage: async (sn, payload) => {
          pushRecv(sn, payload);
          try {
            const device = batteries.find((b) => b.externalId === sn);
            if (!device) return;
            const metrics = extractEcoFlowMetrics(
              payload as Record<string, unknown>,
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
                deviceId: device.id,
                ts: new Date(),
                powerW,
                soc: metrics.soc,
                raw: payload as object,
              },
            });
          } catch (e) {
            log.warn("ecoflow private mqtt msg failed", {
              sn,
              error: (e as Error).message,
            });
          }
        },
        onError: (e) =>
          log.warn("ecoflow private mqtt error", { error: e.message }),
      });
      privateMqttClient = client;
      privateMqttUserId = cert.userId;
      return;
    } catch (e) {
      log.warn("ecoflow private mqtt setup failed, falling back to developer", {
        error: (e as Error).message,
      });
    }
  }

  // Fallback : Developer API (limité aux bmsMaster.* sur Delta Max).
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

/**
 * Force le BMS à diffuser son état courant via MQTT. Le Delta Max gen 1
 * ne broadcaste qu'en bursts (transitions de charge/décharge) et reste
 * silencieux 30-70 min entre. Ce ping périodique tente de coaxer un
 * push d'état pour que SoC / inputW / outputW restent à jour. Si le BMS
 * ignore, no-op silencieux.
 */
export function startEcoFlowQuotaPing(intervalSeconds = 60): NodeJS.Timeout {
  log.info("starting ecoflow quota ping", { intervalSeconds });
  const tick = async () => {
    const ctx = getEcoFlowPrivateMqtt();
    if (!ctx) return;
    try {
      const batteries = await prisma.device.findMany({
        where: { enabled: true, type: "ECOFLOW_BATTERY" },
      });
      for (const b of batteries) {
        await requestEcoFlowPrivateQuota(ctx.client, ctx.userId, b.externalId);
      }
    } catch (e) {
      log.warn("ecoflow quota ping failed", { error: (e as Error).message });
    }
  };
  void tick();
  return setInterval(tick, intervalSeconds * 1000);
}
