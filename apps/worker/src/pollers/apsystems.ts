import { apsystems as ap } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";

const SILENT_TIMEOUT_MS = 10 * 60_000;
const PEER_IMBALANCE_PCT = 25;
const PEER_MIN_W = 50; // sous ce seuil on ne compare pas (bruit)
const TEMP_HIGH_C = 75;
const FREQ_MIN_HZ = 49.5;
const FREQ_MAX_HZ = 50.5;
const SIGNAL_WEAK_DBM = -85;

interface InverterDevice {
  id: string;
  externalId: string;
  name: string;
}

// ── Persistance d'un message reçu ──────────────────────────────────

export async function ingestInverterMessage(
  msg: ap.InverterMessage,
  device: InverterDevice,
): Promise<void> {
  // Une ligne SolarPanelReading par panneau, avec les valeurs onduleur
  // dupliquées (acV/acHz/tempC/signalDb) pour faciliter les requêtes.
  await prisma.solarPanelReading.createMany({
    data: msg.panels.map((p) => ({
      deviceId: device.id,
      panelIndex: p.panelIndex,
      ts: msg.ts,
      dcV: p.dcV,
      dcA: p.dcA,
      pW: p.pW,
      energyWh: p.energyWh,
      acV: p.acV,
      acHz: p.acHz,
      tempC: p.tempC,
      signalDb: p.signalDb,
    })),
  });

  // Aussi un Reading agrégé : somme des P sur tous les panneaux,
  // pour que cet onduleur puisse remonter dans les agrégats horaires
  // standards (côté Reading / ReadingHourly).
  const totalW = msg.panels.reduce(
    (acc, p) => acc + (typeof p.pW === "number" ? p.pW : 0),
    0,
  );
  await prisma.reading.create({
    data: {
      deviceId: device.id,
      ts: msg.ts,
      powerW: totalW,
      raw: msg.raw as object,
    },
  });

  await runHealthChecks(msg, device);
}

// ── Health checks ──────────────────────────────────────────────────

async function runHealthChecks(
  msg: ap.InverterMessage,
  device: InverterDevice,
): Promise<void> {
  // 1. Surchauffe onduleur
  if (msg.tempC !== null && msg.tempC > TEMP_HIGH_C) {
    await raiseAlert({
      deviceId: device.id,
      kind: "OVER_TEMPERATURE",
      severity: "WARN",
      message: `Onduleur ${device.name} : ${msg.tempC.toFixed(1)} °C`,
      detail: { tempC: msg.tempC },
    });
  } else {
    await resolveAlert(device.id, "OVER_TEMPERATURE", null);
  }

  // 2. Fréquence AC hors plage
  if (msg.acHz !== null && (msg.acHz < FREQ_MIN_HZ || msg.acHz > FREQ_MAX_HZ)) {
    await raiseAlert({
      deviceId: device.id,
      kind: "GRID_FREQ_OUT",
      severity: "CRITICAL",
      message: `Fréquence réseau anormale : ${msg.acHz.toFixed(2)} Hz`,
      detail: { acHz: msg.acHz },
    });
  } else {
    await resolveAlert(device.id, "GRID_FREQ_OUT", null);
  }

  // 3. Signal Zigbee faible
  if (msg.signalDb !== null && msg.signalDb < SIGNAL_WEAK_DBM) {
    await raiseAlert({
      deviceId: device.id,
      kind: "WEAK_SIGNAL",
      severity: "INFO",
      message: `RSSI Zigbee faible : ${msg.signalDb} dBm`,
      detail: { signalDb: msg.signalDb },
    });
  } else {
    await resolveAlert(device.id, "WEAK_SIGNAL", null);
  }

  // 4. Déséquilibre entre panneaux jumeaux (panel 0 vs 1, etc.)
  if (msg.panels.length >= 2) {
    for (let i = 0; i + 1 < msg.panels.length; i += 2) {
      const a = msg.panels[i];
      const b = msg.panels[i + 1];
      if (typeof a.pW === "number" && typeof b.pW === "number") {
        const max = Math.max(a.pW, b.pW);
        const min = Math.min(a.pW, b.pW);
        if (max >= PEER_MIN_W) {
          const gapPct = ((max - min) / max) * 100;
          if (gapPct > PEER_IMBALANCE_PCT) {
            await raiseAlert({
              deviceId: device.id,
              panelIndex: a.pW < b.pW ? a.panelIndex : b.panelIndex,
              kind: "PEER_IMBALANCE",
              severity: "WARN",
              message: `Déséquilibre panneaux ${a.panelIndex}/${b.panelIndex} : ${a.pW} W vs ${b.pW} W (${gapPct.toFixed(0)} %)`,
              detail: { a: a.pW, b: b.pW, gapPct },
            });
          } else {
            await resolveAlert(device.id, "PEER_IMBALANCE", null);
          }
        }
      }
    }
  }
}

// ── Détection des onduleurs silencieux (boucle séparée) ────────────

export async function checkSilentInverters(): Promise<void> {
  const devices = await prisma.device.findMany({
    where: { enabled: true, type: "APSYSTEMS_INVERTER" },
  });
  const since = new Date(Date.now() - SILENT_TIMEOUT_MS);
  for (const d of devices) {
    const last = await prisma.solarPanelReading.findFirst({
      where: { deviceId: d.id },
      orderBy: { ts: "desc" },
    });
    if (!last || last.ts < since) {
      await raiseAlert({
        deviceId: d.id,
        kind: "INVERTER_SILENT",
        severity: "CRITICAL",
        message: last
          ? `${d.name} silencieux depuis ${formatAgo(last.ts)}`
          : `${d.name} : aucune trame reçue`,
        detail: { lastTs: last?.ts ?? null },
      });
    } else {
      await resolveAlert(d.id, "INVERTER_SILENT", null);
    }
  }
}

function formatAgo(ts: Date): string {
  const ms = Date.now() - ts.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

// ── Helpers d'alerte ───────────────────────────────────────────────

interface AlertSpec {
  deviceId: string;
  panelIndex?: number;
  kind:
    | "INVERTER_SILENT"
    | "PEER_IMBALANCE"
    | "OVER_TEMPERATURE"
    | "GRID_FREQ_OUT"
    | "WEAK_SIGNAL"
    | "PANEL_LOW_DC";
  severity: "INFO" | "WARN" | "CRITICAL";
  message: string;
  detail?: Record<string, unknown>;
}

async function raiseAlert(a: AlertSpec): Promise<void> {
  const existing = await prisma.healthAlert.findFirst({
    where: {
      deviceId: a.deviceId,
      panelIndex: a.panelIndex ?? null,
      kind: a.kind,
      resolvedAt: null,
    },
  });
  if (existing) {
    // Met à jour le message si besoin (latest reading)
    if (existing.message !== a.message) {
      await prisma.healthAlert.update({
        where: { id: existing.id },
        data: { message: a.message, detail: a.detail as object | undefined },
      });
    }
    return;
  }
  await prisma.healthAlert.create({
    data: {
      deviceId: a.deviceId,
      panelIndex: a.panelIndex ?? null,
      kind: a.kind,
      severity: a.severity,
      message: a.message,
      detail: (a.detail ?? null) as object | null,
    },
  });
  log.info("apsystems alert raised", {
    deviceId: a.deviceId,
    kind: a.kind,
    msg: a.message,
  });
}

async function resolveAlert(
  deviceId: string,
  kind: AlertSpec["kind"],
  panelIndex: number | null,
): Promise<void> {
  await prisma.healthAlert.updateMany({
    where: { deviceId, kind, panelIndex, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

// ── Boucle MQTT (réelle) ──────────────────────────────────────────

let subscriber: ap.ApsystemsSubscriber | null = null;

export async function startApsystemsMqtt(): Promise<void> {
  if (!env.APSYSTEMS_MQTT_URL) return;
  log.info("starting apsystems mqtt", {
    url: env.APSYSTEMS_MQTT_URL,
    prefix: env.APSYSTEMS_TOPIC_PREFIX,
  });

  subscriber = ap.startApsystemsSubscriber(
    {
      url: env.APSYSTEMS_MQTT_URL,
      username: env.APSYSTEMS_MQTT_USER,
      password: env.APSYSTEMS_MQTT_PASSWORD,
      topicPrefix: env.APSYSTEMS_TOPIC_PREFIX,
    },
    async (msg) => {
      const device = await prisma.device.findUnique({
        where: { externalId: msg.sn },
      });
      if (!device || device.type !== "APSYSTEMS_INVERTER" || !device.enabled) {
        return;
      }
      try {
        await ingestInverterMessage(msg, device);
      } catch (e) {
        log.warn("apsystems ingest failed", {
          sn: msg.sn,
          error: (e as Error).message,
        });
      }
    },
    async (sn, online) => {
      log.info("apsystems status", { sn, online });
    },
  );
}

// ── Boucle mock (dev sans matos) ──────────────────────────────────

export function startApsystemsMock(intervalSeconds: number): void {
  log.info("starting apsystems MOCK provider", { intervalSeconds });
  const tick = async () => {
    try {
      const devices = await prisma.device.findMany({
        where: { enabled: true, type: "APSYSTEMS_INVERTER" },
      });
      const now = new Date();
      for (const d of devices) {
        const meta =
          (d.vendorMeta as { panels?: number; peakW?: number } | null) ?? null;
        const msg = ap.generateMockInverter(
          {
            sn: d.externalId,
            panelCount: meta?.panels ?? 2,
            basePeakW: meta?.peakW ?? 400,
          },
          now,
        );
        await ingestInverterMessage(msg, d);
      }
    } catch (e) {
      log.error("apsystems mock tick error", { error: (e as Error).message });
    }
  };
  void tick();
  setInterval(tick, intervalSeconds * 1000);
}

// ── Boucle de vérification "silent" ───────────────────────────────

export function startApsystemsHealthLoop(intervalSeconds = 60) {
  const tick = async () => {
    try {
      await checkSilentInverters();
    } catch (e) {
      log.error("apsystems health tick error", {
        error: (e as Error).message,
      });
    }
  };
  void tick();
  return setInterval(tick, intervalSeconds * 1000);
}

export async function stopApsystemsMqtt(): Promise<void> {
  if (subscriber) {
    await subscriber.stop();
    subscriber = null;
  }
}
