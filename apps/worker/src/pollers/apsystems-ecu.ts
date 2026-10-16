// Lecture d'une ECU officielle APSystems (ECU-R / ECU-C, interface
// « Altenergy Power Control Software ») via sa page locale
// /index.php/realtimedata. Alternative à la passerelle DIY ESP + MQTT.
//
// Tableau publié par l'ECU (mis à jour toutes les 5 min) :
//   Inverter ID     | Current Power | DC Voltage | Grid Frequency | Grid Voltage | Temperature | Reporting Time
//   703000197256-1  | 173 W         | 30 V       | 50.0 Hz        | 235 V        | 34 °C       | 2026-10-16 11:15:00
//   703000197256-2  | 204 W         | 29 V       | 235 V                                          (rowspan)
//   703000727363    | -             | -          | -              | -            | -           | 2026-10-16 11:15:00  (hors ligne)
//
// Chaque onduleur vu est créé automatiquement (APSYSTEMS_INVERTER /
// SOLAR_INVERTER), puis chaque relevé passe par ingestInverterMessage
// (SolarPanelReading par panneau + Reading agrégé + health checks).

import type { apsystems as ap } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";
import { ingestInverterMessage } from "./apsystems.js";

interface EcuPanel {
  pW: number | null;
  dcV: number | null;
  acV: number | null;
}
interface EcuInverter {
  sn: string;
  ts: Date;
  acHz: number | null;
  tempC: number | null;
  panels: Map<number, EcuPanel>;
}

const num = (s: string | undefined): number | null => {
  const m = s?.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** "2026-10-16 11:15:00" en heure locale de l'ECU → Date UTC. */
function parseLocalTime(s: string, tz: string): Date | null {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, se);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(asUtc))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const offset =
    Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - asUtc;
  return new Date(asUtc - offset);
}

export function parseEcuRealtime(
  html: string,
  tz = env.HOME_TZ,
): { online: EcuInverter[]; offline: string[] } {
  const clean = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const out = new Map<string, EcuInverter>();
  const offline: string[] = [];
  let current: EcuInverter | null = null;
  for (const row of clean.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((c) =>
      c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
    );
    const id = cells[0]?.match(/^(\d{8,})(?:-(\d+))?$/);
    if (!id) continue;
    const sn = id[1]!;
    const panelNo = id[2] ? Number(id[2]) : null;
    if (panelNo === null) {
      // Onduleur sans données (hors ligne) : rien à ingérer.
      offline.push(sn);
      current = null;
      continue;
    }
    if (cells.length >= 7) {
      // 1re ligne de l'onduleur : toutes les colonnes.
      const ts = parseLocalTime(cells[6]!, tz);
      if (!ts) continue;
      current = { sn, ts, acHz: num(cells[3]), tempC: num(cells[5]), panels: new Map() };
      out.set(sn, current);
      current.panels.set(panelNo - 1, { pW: num(cells[1]), dcV: num(cells[2]), acV: num(cells[4]) });
    } else if (current && current.sn === sn) {
      // Lignes suivantes (rowspan) : puissance, tension DC, tension AC.
      current.panels.set(panelNo - 1, {
        pW: num(cells[1]),
        dcV: num(cells[2]),
        acV: num(cells[cells.length - 1]),
      });
    }
  }
  return { online: [...out.values()], offline };
}

// Onduleur inconnu → créé automatiquement (nom modifiable dans /devices).
const ensureInverter = (sn: string, panels: number) =>
  prisma.device.upsert({
    where: { externalId: sn },
    update: {},
    create: {
      externalId: sn,
      type: "APSYSTEMS_INVERTER",
      role: "SOLAR_INVERTER",
      name: `Onduleur ${sn.slice(-6)}`,
      vendorMeta: { source: "ecu", panels },
    },
  });

function toMessage(inv: EcuInverter, raw: unknown): ap.InverterMessage {
  const panels = [...inv.panels.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, p]) => ({
      panelIndex: i,
      dcV: p.dcV,
      dcA: p.pW !== null && p.dcV ? Math.round((p.pW / p.dcV) * 100) / 100 : null,
      pW: p.pW,
      energyWh: null,
      acV: p.acV,
      acHz: inv.acHz,
      tempC: inv.tempC,
      signalDb: null,
      ts: inv.ts,
    }));
  return {
    sn: inv.sn,
    online: true,
    ts: inv.ts,
    tempC: inv.tempC,
    acV: panels[0]?.acV ?? null,
    acHz: inv.acHz,
    signalDb: null,
    panels,
    raw: raw as ap.InverterMessage["raw"],
  };
}

// Dernier relevé ingéré par onduleur : l'ECU ne change ses valeurs que
// toutes les 5 min, on n'écrit pas deux fois le même relevé.
const lastTs = new Map<string, number>();

export async function pollEcuOnce(baseUrl: string): Promise<number> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/index.php/realtimedata`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ECU HTTP ${res.status}`);
  const { online, offline } = parseEcuRealtime(await res.text());
  // Les onduleurs hors ligne sont déclarés aussi : checkSilentInverters
  // les signale tant que les autres émettent.
  for (const sn of offline) {
    if (!lastTs.has(sn)) {
      await ensureInverter(sn, 2);
      lastTs.set(sn, 0);
    }
  }
  let ingested = 0;
  for (const inv of online) {
    if (lastTs.get(inv.sn) === inv.ts.getTime()) continue;
    const device = await ensureInverter(inv.sn, inv.panels.size);
    if (!device.enabled || device.type !== "APSYSTEMS_INVERTER") continue;
    const already = await prisma.solarPanelReading.findFirst({
      where: { deviceId: device.id, ts: inv.ts },
      select: { id: true },
    });
    if (!already) {
      await ingestInverterMessage(
        toMessage(inv, { source: "ecu", panels: Object.fromEntries(inv.panels) }),
        device,
      );
      ingested++;
    }
    lastTs.set(inv.sn, inv.ts.getTime());
  }
  return ingested;
}

export function startApsystemsEcuPoller(baseUrl: string, intervalSeconds: number) {
  log.info("starting apsystems ECU poller", { baseUrl, intervalSeconds });
  const tick = async () => {
    try {
      const n = await pollEcuOnce(baseUrl);
      if (n > 0) log.info("apsystems ecu ingested", { inverters: n });
    } catch (e) {
      log.warn("apsystems ecu poll failed", { error: (e as Error).message });
    }
  };
  void tick();
  return setInterval(tick, intervalSeconds * 1000);
}
