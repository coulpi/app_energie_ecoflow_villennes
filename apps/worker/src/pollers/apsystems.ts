import { apsystems as ap } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";

const SILENT_TIMEOUT_MS = 20 * 60_000; // ECU officielle : 1 relevé / 5 min
const AC_MIN_V = 100;
const PEER_IMBALANCE_PCT = 25;
const PEER_MIN_W = 150; // sous ce seuil on ne compare pas (ombre passagère, faible ensoleillement)
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

  // 2. Pas de tension réseau (panneaux alimentés mais onduleur non
  //    raccordé côté AC : disjoncteur, câble de liaison…). La fréquence
  //    remontée est alors fantaisiste, on ne la commente pas.
  if (msg.acV !== null && msg.acV < AC_MIN_V) {
    await raiseAlert({
      deviceId: device.id,
      kind: "GRID_FREQ_OUT",
      severity: "CRITICAL",
      message: `${device.name} : pas de tension réseau AC (${Math.round(msg.acV)} V), n'injecte pas`,
      detail: { acV: msg.acV, acHz: msg.acHz },
    });
  } else if (msg.acHz !== null && (msg.acHz < FREQ_MIN_HZ || msg.acHz > FREQ_MAX_HZ)) {
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
      if (!a || !b || typeof a.pW !== "number" || typeof b.pW !== "number") continue;
      const max = Math.max(a.pW, b.pW);
      const min = Math.min(a.pW, b.pW);
      const gapPct = max > 0 ? ((max - min) / max) * 100 : 0;
      // L'alerte porte le panneau le plus faible : on la lève sur lui et on
      // ferme celle de son jumeau ; sous le seuil de puissance (matin,
      // soir, nuages) ou une fois équilibrés, on ferme les deux.
      const weak = a.pW < b.pW ? a : b;
      const strong = weak === a ? b : a;
      if (max >= PEER_MIN_W && gapPct > PEER_IMBALANCE_PCT) {
        await raiseAlert({
          deviceId: device.id,
          panelIndex: weak.panelIndex,
          kind: "PEER_IMBALANCE",
          severity: "WARN",
          message: `Déséquilibre panneaux ${a.panelIndex + 1}/${b.panelIndex + 1} : ${a.pW} W vs ${b.pW} W (${gapPct.toFixed(0)} %)`,
          detail: { a: a.pW, b: b.pW, gapPct },
        });
        await resolveAlert(device.id, "PEER_IMBALANCE", strong.panelIndex);
      } else {
        await resolveAlert(device.id, "PEER_IMBALANCE", a.panelIndex);
        await resolveAlert(device.id, "PEER_IMBALANCE", b.panelIndex);
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
  const lasts = await Promise.all(
    devices.map((d) =>
      prisma.solarPanelReading.findFirst({
        where: { deviceId: d.id },
        orderBy: { ts: "desc" },
        select: { ts: true },
      }),
    ),
  );
  // Personne n'a émis (nuit, passerelle/ECU coupée) : ce n'est pas un
  // onduleur en particulier qui est muet, on ne lève rien.
  if (!lasts.some((l) => l && l.ts >= since)) return;
  for (const [i, d] of devices.entries()) {
    const last = lasts[i];
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

export interface ApsystemsResolvedConfig {
  url: string | null;
  username: string | undefined;
  password: string | undefined;
  topicPrefix: string;
  espIp: string | null;
  source: "db" | "env" | "none";
}

// Resolution: ControlState (si renseigne) > .env > rien.
export async function resolveApsystemsConfig(): Promise<ApsystemsResolvedConfig> {
  const ctrl = (await prisma.controlState.findUnique({
    where: { key: "default" },
  })) as Record<string, unknown> | null;
  const dbUrl = (ctrl?.apsystemsMqttUrl as string | null | undefined)?.trim() || null;
  const dbUser = (ctrl?.apsystemsMqttUser as string | null | undefined)?.trim() || undefined;
  const dbPwd = (ctrl?.apsystemsMqttPassword as string | null | undefined) || undefined;
  const dbPrefix = (ctrl?.apsystemsTopicPrefix as string | null | undefined)?.trim() || null;
  const dbEspIp = (ctrl?.apsystemsEspIp as string | null | undefined)?.trim() || null;
  if (dbUrl) {
    return {
      url: dbUrl,
      username: dbUser,
      password: dbPwd,
      topicPrefix: dbPrefix ?? env.APSYSTEMS_TOPIC_PREFIX,
      espIp: dbEspIp,
      source: "db",
    };
  }
  if (env.APSYSTEMS_MQTT_URL) {
    return {
      url: env.APSYSTEMS_MQTT_URL,
      username: env.APSYSTEMS_MQTT_USER,
      password: env.APSYSTEMS_MQTT_PASSWORD,
      topicPrefix: env.APSYSTEMS_TOPIC_PREFIX,
      espIp: dbEspIp,
      source: "env",
    };
  }
  return {
    url: null,
    username: undefined,
    password: undefined,
    topicPrefix: env.APSYSTEMS_TOPIC_PREFIX,
    espIp: dbEspIp,
    source: "none",
  };
}

export async function startApsystemsMqtt(): Promise<void> {
  const cfg = await resolveApsystemsConfig();
  if (!cfg.url) return;
  log.info("starting apsystems mqtt", {
    url: cfg.url,
    prefix: cfg.topicPrefix,
    source: cfg.source,
  });

  subscriber = ap.startApsystemsSubscriber(
    {
      url: cfg.url,
      username: cfg.username,
      password: cfg.password,
      topicPrefix: cfg.topicPrefix,
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

// Stop puis re-resolve la config et re-start. Utilise apres un changement
// de ControlState pour appliquer la nouvelle URL/credentials sans relancer
// le worker.
export async function restartApsystemsMqtt(): Promise<ApsystemsResolvedConfig> {
  await stopApsystemsMqtt();
  const cfg = await resolveApsystemsConfig();
  if (cfg.url) {
    await startApsystemsMqtt();
  } else {
    log.info("apsystems mqtt restart: no URL configured, subscriber stays off");
  }
  return cfg;
}
