// Client APSystems — lecture des micro-onduleurs DS3 / YC600 / QS1
// via une passerelle Zigbee custom (ESP8266 + CC2530+CC2591) qui parle
// le protocole Zigbee propriétaire APSystems et republie les données
// instantanées en MQTT.
//
// Le firmware de référence côté ESP est :
//   https://github.com/patience4711/read-APSystems-YC600-QS1-DS3
//
// Convention de topics MQTT (l'ESP doit publier ce format) :
//
//   apsystems/<inverterSn>/data    → payload JSON complet (toutes les
//                                    valeurs d'un onduleur, périodique)
//   apsystems/<inverterSn>/status  → "online" | "offline" (LWT)
//
// Format du payload JSON sur `data` (cf. ApsystemsPayloadSchema) :
//
//   {
//     "sn": "406000123456",
//     "ts": 1714291200,           // unix seconds (optionnel)
//     "online": true,
//     "tempC": 42.3,
//     "acV": 233.1,
//     "acHz": 50.02,
//     "signalDb": -65,            // RSSI Zigbee (dBm)
//     "panels": [
//       { "i": 0, "dcV": 35.2, "dcA": 8.1, "pW": 285, "energyWh": 12345 },
//       { "i": 1, "dcV": 35.0, "dcA": 7.9, "pW": 276, "energyWh": 12100 }
//     ]
//   }

import mqtt, { type MqttClient } from "mqtt";
import { z } from "zod";

// ── Schéma des messages ────────────────────────────────────────────

export const ApsystemsPanelSchema = z.object({
  i: z.number().int().min(0).max(7),
  dcV: z.number().nullable().optional(),
  dcA: z.number().nullable().optional(),
  pW: z.number().nullable().optional(),
  energyWh: z.number().nullable().optional(),
});
export type ApsystemsPanel = z.infer<typeof ApsystemsPanelSchema>;

export const ApsystemsPayloadSchema = z.object({
  sn: z.string().min(4),
  ts: z.number().int().optional(),
  online: z.boolean().optional(),
  tempC: z.number().nullable().optional(),
  acV: z.number().nullable().optional(),
  acHz: z.number().nullable().optional(),
  signalDb: z.number().nullable().optional(),
  panels: z.array(ApsystemsPanelSchema).min(1).max(8),
});
export type ApsystemsPayload = z.infer<typeof ApsystemsPayloadSchema>;

// ── Lecture normalisée (côté worker) ───────────────────────────────

export interface PanelReading {
  panelIndex: number;
  dcV: number | null;
  dcA: number | null;
  pW: number | null;
  energyWh: number | null;
  acV: number | null;
  acHz: number | null;
  tempC: number | null;
  signalDb: number | null;
  ts: Date;
}

export interface InverterMessage {
  sn: string;
  online: boolean;
  ts: Date;
  tempC: number | null;
  acV: number | null;
  acHz: number | null;
  signalDb: number | null;
  panels: PanelReading[];
  raw: ApsystemsPayload;
}

export function parseApsystemsPayload(json: unknown): InverterMessage {
  const p = ApsystemsPayloadSchema.parse(json);
  const ts = p.ts ? new Date(p.ts * 1000) : new Date();
  const panels: PanelReading[] = p.panels.map((panel) => ({
    panelIndex: panel.i,
    dcV: panel.dcV ?? null,
    dcA: panel.dcA ?? null,
    pW: panel.pW ?? null,
    energyWh: panel.energyWh ?? null,
    acV: p.acV ?? null,
    acHz: p.acHz ?? null,
    tempC: p.tempC ?? null,
    signalDb: p.signalDb ?? null,
    ts,
  }));
  return {
    sn: p.sn,
    online: p.online ?? true,
    ts,
    tempC: p.tempC ?? null,
    acV: p.acV ?? null,
    acHz: p.acHz ?? null,
    signalDb: p.signalDb ?? null,
    panels,
    raw: p,
  };
}

// ── Subscriber MQTT ────────────────────────────────────────────────

export interface ApsystemsSubscriberOptions {
  url: string;          // ex: "mqtt://192.168.1.10:1883"
  username?: string;
  password?: string;
  topicPrefix?: string; // défaut "apsystems"
}

export type InverterEventHandler = (msg: InverterMessage) => void | Promise<void>;
export type StatusEventHandler = (
  sn: string,
  online: boolean,
) => void | Promise<void>;

export interface ApsystemsSubscriber {
  client: MqttClient;
  stop(): Promise<void>;
}

export function startApsystemsSubscriber(
  opts: ApsystemsSubscriberOptions,
  onMessage: InverterEventHandler,
  onStatus?: StatusEventHandler,
): ApsystemsSubscriber {
  const prefix = opts.topicPrefix ?? "apsystems";
  const dataTopic = `${prefix}/+/data`;
  const statusTopic = `${prefix}/+/status`;

  const client = mqtt.connect(opts.url, {
    username: opts.username,
    password: opts.password,
    reconnectPeriod: 5000,
    keepalive: 30,
  });

  client.on("connect", () => {
    client.subscribe([dataTopic, statusTopic], { qos: 0 }, (err) => {
      if (err) console.error("[apsystems] subscribe error", err);
    });
  });

  client.on("message", (topic, payload) => {
    const parts = topic.split("/");
    const sn = parts[1];
    const kind = parts[2];
    if (!sn) return;

    if (kind === "status") {
      const v = payload.toString().trim().toLowerCase();
      const online = v === "online" || v === "1" || v === "true";
      void onStatus?.(sn, online);
      return;
    }

    if (kind === "data") {
      try {
        const json = JSON.parse(payload.toString());
        const msg = parseApsystemsPayload(json);
        void onMessage(msg);
      } catch (e) {
        console.error(`[apsystems] parse error on ${topic}:`, e);
      }
    }
  });

  client.on("error", (err) => {
    console.error("[apsystems] mqtt error", err);
  });

  return {
    client,
    stop: async () => {
      await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
    },
  };
}

// ── Mock provider (dev sans matos) ─────────────────────────────────

export interface MockInverterConfig {
  sn: string;
  panelCount: number; // typiquement 2 (DS3 DUO)
  basePeakW: number;  // puissance crête théorique en plein soleil par panneau
}

/**
 * Génère un message InverterMessage simulé en fonction de l'heure du jour
 * (courbe solaire grossière) et d'une variation aléatoire par panneau.
 *
 * - Production en cloche entre 7h et 19h (Europe/Paris)
 * - Léger déséquilibre aléatoire entre panneaux jumeaux (~5%)
 * - Température corrélée à la puissance instantanée
 */
export function generateMockInverter(
  cfg: MockInverterConfig,
  now: Date = new Date(),
): InverterMessage {
  const localHour =
    new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getHours() +
    new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getMinutes() / 60;

  // Profil solaire 0..1 centré sur 13h, FWHM ~6h
  let solarRatio = 0;
  if (localHour > 6.5 && localHour < 19.5) {
    solarRatio = Math.cos(((localHour - 13) / 6) * Math.PI * 0.5);
    solarRatio = Math.max(0, solarRatio);
    solarRatio = Math.pow(solarRatio, 1.4);
  }

  // Variation nuageuse
  const cloud = 0.8 + 0.4 * Math.sin(now.getTime() / 600_000);
  const baseRatio = solarRatio * Math.max(0.3, Math.min(1, cloud));

  const panels: PanelReading[] = [];
  for (let i = 0; i < cfg.panelCount; i++) {
    // Petit déséquilibre par panneau (deterministe via SN+i)
    const seed = (cfg.sn.charCodeAt(0) + i * 37) % 100;
    const peerOffset = (seed - 50) / 1000; // ±5%
    const pW = Math.max(0, cfg.basePeakW * baseRatio * (1 + peerOffset));
    const dcV = baseRatio > 0.05 ? 32 + 4 * baseRatio + (seed - 50) / 100 : 0;
    const dcA = dcV > 0 ? pW / dcV : 0;
    panels.push({
      panelIndex: i,
      dcV: Number(dcV.toFixed(2)),
      dcA: Number(dcA.toFixed(2)),
      pW: Math.round(pW),
      energyWh: Math.round(cfg.basePeakW * 4 * (1 + i * 0.1)),
      acV: 232 + Math.random() * 4,
      acHz: 49.98 + Math.random() * 0.05,
      tempC: 22 + 30 * baseRatio + Math.random() * 3,
      signalDb: -55 - Math.round(Math.random() * 10),
      ts: now,
    });
  }

  const tempC = panels[0]?.tempC ?? null;
  const acV = panels[0]?.acV ?? null;
  const acHz = panels[0]?.acHz ?? null;
  const signalDb = panels[0]?.signalDb ?? null;

  const raw: ApsystemsPayload = {
    sn: cfg.sn,
    ts: Math.floor(now.getTime() / 1000),
    online: true,
    tempC,
    acV,
    acHz,
    signalDb,
    panels: panels.map((p) => ({
      i: p.panelIndex,
      dcV: p.dcV,
      dcA: p.dcA,
      pW: p.pW,
      energyWh: p.energyWh,
    })),
  };

  return {
    sn: cfg.sn,
    online: true,
    ts: now,
    tempC,
    acV,
    acHz,
    signalDb,
    panels,
    raw,
  };
}
