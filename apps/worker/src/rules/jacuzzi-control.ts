// Pilotage du chauffage du jacuzzi Intex via le module Wi-Fi local.
//
// La prise Tuya en amont reste alimentee en permanence (le module Wi-Fi
// du jacuzzi est l'actionneur, pas la prise). On envoie seulement
// setHeater(on/off) au module via TCP local.
//
// Logique :
//   - Allumage : surplus solaire (= -gridW) >= jacuzziStartSurplusW
//     pendant jacuzziStartHoldS, ET SoC batterie >= jacuzziMinSocPct,
//     ET hors fenetre Tempo rouge HP si jacuzziTempoBlockRedHp.
//   - Coupure : gridW > jacuzziStopGridW pendant jacuzziStopHoldS.
//   - Override manuel : si jacuzziManualOverride != null, la boucle se
//     contente d'appliquer cet etat fige.
//
// La lib Intex serialise les requetes en interne : getStatus() avant
// chaque setHeater pour ne toggler que si l'etat differe.

import { intexSpa } from "@app/shared";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { env } from "../env.js";
import { buildSnapshot } from "./engine.js";

interface JacuzziLiveState {
  power: boolean | null;
  heaterOn: boolean | null;
  filterOn: boolean | null;
  jetsOn: boolean | null;
  bubblesOn: boolean | null;
  sanitizerOn: boolean | null;
  currentTempC: number | null;
  presetTempC: number | null;
  errorCode: string | null;
  surplusHoldStartedAtMs: number | null;
  gridHoldStartedAtMs: number | null;
  lastTickAtMs: number | null;
  lastError: string | null;
  failureCount: number;
  reachable: boolean;
}

const live: JacuzziLiveState = {
  power: null,
  heaterOn: null,
  filterOn: null,
  jetsOn: null,
  bubblesOn: null,
  sanitizerOn: null,
  currentTempC: null,
  presetTempC: null,
  errorCode: null,
  surplusHoldStartedAtMs: null,
  gridHoldStartedAtMs: null,
  lastTickAtMs: null,
  lastError: null,
  failureCount: 0,
  reachable: false,
};

function syncLiveFromStatus(s: intexSpa.IntexSpaStatus): void {
  live.power = s.power;
  live.heaterOn = s.heater;
  live.filterOn = s.filter;
  live.jetsOn = s.jets;
  live.bubblesOn = s.bubbles;
  live.sanitizerOn = s.sanitizer;
  live.currentTempC = s.currentTemp;
  live.presetTempC = s.presetTemp;
  live.errorCode = s.errorCode;
}

export type IntexFunction = "power" | "heater" | "filter" | "jets" | "bubbles" | "sanitizer";

export async function setJacuzziFunction(fn: IntexFunction, on: boolean): Promise<intexSpa.IntexSpaStatus> {
  const c = getClient();
  if (!c) throw new Error("INTEX_SPA_HOST non defini");
  let s: intexSpa.IntexSpaStatus;
  switch (fn) {
    case "power": s = await c.setPower(on); break;
    case "heater": s = await c.setHeater(on); break;
    case "filter": s = await c.setFilter(on); break;
    case "jets": s = await c.setJets(on); break;
    case "bubbles": s = await c.setBubbles(on); break;
    case "sanitizer": s = await c.setSanitizer(on); break;
  }
  syncLiveFromStatus(s);
  live.reachable = true;
  live.lastError = null;
  live.failureCount = 0;
  return s;
}

export async function setJacuzziPresetTemp(temp: number): Promise<intexSpa.IntexSpaStatus> {
  const c = getClient();
  if (!c) throw new Error("INTEX_SPA_HOST non defini");
  const s = await c.setPresetTemp(temp);
  syncLiveFromStatus(s);
  live.reachable = true;
  live.lastError = null;
  live.failureCount = 0;
  return s;
}

let client: intexSpa.IntexSpaClient | null = null;
// Override manuel applique au tick precedent. Permet de detecter la
// transition manuel -> auto pour reinitialiser l'etat (sinon l'auto
// herite d'un heaterOn=true et reste bloque a cause du cyclage Intex).
let lastManualOverride: boolean | null = null;

function getClient(): intexSpa.IntexSpaClient | null {
  if (!env.INTEX_SPA_HOST) return null;
  if (!client) {
    client = intexSpa.createIntexSpaClient({
      host: env.INTEX_SPA_HOST,
      port: env.INTEX_SPA_PORT,
    });
  }
  return client;
}

function resetClient(): void {
  if (client) {
    try { client.close(); } catch { /* ignore */ }
    client = null;
  }
}

export function getJacuzziState() {
  return { ...live };
}

interface JacuzziCtrl {
  jacuzziEnabled: boolean;
  jacuzziStartSurplusW: number;
  jacuzziStopGridW: number;
  jacuzziStartHoldS: number;
  jacuzziStopHoldS: number;
  jacuzziMinSocPct: number;
  jacuzziTempoBlockRedHp: boolean;
  jacuzziManualOverride: boolean | null;
  tempoColor: string;
}

async function readCtrl(): Promise<JacuzziCtrl | null> {
  const ctrl = (await prisma.controlState.findUnique({
    where: { key: "default" },
  })) as Record<string, unknown> | null;
  if (!ctrl) return null;
  return {
    jacuzziEnabled: (ctrl.jacuzziEnabled as boolean | undefined) ?? false,
    jacuzziStartSurplusW: (ctrl.jacuzziStartSurplusW as number | undefined) ?? 1500,
    jacuzziStopGridW: (ctrl.jacuzziStopGridW as number | undefined) ?? 300,
    jacuzziStartHoldS: (ctrl.jacuzziStartHoldS as number | undefined) ?? 120,
    jacuzziStopHoldS: (ctrl.jacuzziStopHoldS as number | undefined) ?? 300,
    jacuzziMinSocPct: (ctrl.jacuzziMinSocPct as number | undefined) ?? 40,
    jacuzziTempoBlockRedHp:
      (ctrl.jacuzziTempoBlockRedHp as boolean | undefined) ?? true,
    jacuzziManualOverride:
      (ctrl.jacuzziManualOverride as boolean | null | undefined) ?? null,
    tempoColor: (ctrl.tempoColor as string | undefined) ?? "UNKNOWN",
  };
}

async function refreshStatus(): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const s = await c.getStatus();
    syncLiveFromStatus(s);
    live.reachable = true;
    live.lastError = null;
    live.failureCount = 0;
    return true;
  } catch (e) {
    live.reachable = false;
    live.lastError = (e as Error).message;
    live.failureCount += 1;
    resetClient();
    return false;
  }
}

async function applyHeater(on: boolean): Promise<void> {
  if (live.heaterOn === on) return;
  try {
    const s = await setJacuzziFunction("heater", on);
    log.info("jacuzzi: heater applied", { on, actual: s.heater, tempC: s.currentTemp });
  } catch (e) {
    live.lastError = (e as Error).message;
    live.failureCount += 1;
    log.warn("jacuzzi: setHeater failed", { error: live.lastError });
    resetClient();
  }
}

function inTempoRedHp(tempoColor: string, now: Date): boolean {
  if (tempoColor !== "RED") return false;
  const h = now.getHours();
  // HP Tempo rouge : 6h - 22h (heures pleines).
  return h >= 6 && h < 22;
}

export async function tickJacuzzi(): Promise<void> {
  if (!env.INTEX_SPA_ENABLED || !env.INTEX_SPA_HOST) return;
  const ctrl = await readCtrl();
  if (!ctrl) return;
  live.lastTickAtMs = Date.now();

  // Toujours rafraichir l'etat du module : meme si on ne touche pas
  // l'etat (boucle desactivee), l'UI doit voir l'etat live.
  const ok = await refreshStatus();
  if (!ok) return;

  if (!ctrl.jacuzziEnabled) {
    // Pilotage off : on ne touche a rien.
    live.surplusHoldStartedAtMs = null;
    live.gridHoldStartedAtMs = null;
    return;
  }

  // Override manuel : on applique l'etat fige et on n'arme pas les timers.
  if (ctrl.jacuzziManualOverride !== null) {
    await applyHeater(ctrl.jacuzziManualOverride);
    live.surplusHoldStartedAtMs = null;
    live.gridHoldStartedAtMs = null;
    lastManualOverride = ctrl.jacuzziManualOverride;
    return;
  }

  // Transition override -> auto : on reinitialise depuis une base propre.
  // Sans ca, si l'auto herite d'un heaterOn=true sans surplus suffisant,
  // le cyclage Intex (1900 W <-> 45 W) fait osciller l'import reseau et
  // empeche le timer de coupure de jamais maturer.
  if (lastManualOverride !== null) {
    log.info("jacuzzi: sortie override manuel, reset chauffe avant auto", {
      previous: lastManualOverride,
    });
    await applyHeater(false);
    live.surplusHoldStartedAtMs = null;
    live.gridHoldStartedAtMs = null;
    lastManualOverride = null;
    return;
  }

  const m = await buildSnapshot();
  if (m.surplus_W === null || m.grid_W === null) return;

  const now = Date.now();
  const soc = m.battery_soc;
  const isRedHp = inTempoRedHp(ctrl.tempoColor, m.now);

  // === Conditions de blocage absolu : on coupe la chauffe ===
  if (
    (ctrl.jacuzziTempoBlockRedHp && isRedHp) ||
    (soc !== null && soc < ctrl.jacuzziMinSocPct)
  ) {
    if (live.heaterOn === true) {
      log.info("jacuzzi: blocage absolu, coupure chauffe", {
        redHp: isRedHp, soc, minSoc: ctrl.jacuzziMinSocPct,
      });
    }
    await applyHeater(false);
    live.surplusHoldStartedAtMs = null;
    live.gridHoldStartedAtMs = null;
    return;
  }

  const surplus = m.surplus_W; // > 0 = export
  const gridImport = Math.max(0, m.grid_W); // ne compte que l'import

  if (live.heaterOn === true) {
    // En chauffe : on surveille l'import. On ne reset pas le timer surplus.
    live.surplusHoldStartedAtMs = null;
    if (gridImport > ctrl.jacuzziStopGridW) {
      if (live.gridHoldStartedAtMs === null) {
        live.gridHoldStartedAtMs = now;
        log.info("jacuzzi: import detecte, fenetre coupure armee", {
          gridImport, threshold: ctrl.jacuzziStopGridW, holdS: ctrl.jacuzziStopHoldS,
        });
      } else if (now - live.gridHoldStartedAtMs >= ctrl.jacuzziStopHoldS * 1000) {
        log.info("jacuzzi: import maintenu, coupure chauffe", {
          gridImport, durationMs: now - live.gridHoldStartedAtMs,
        });
        await applyHeater(false);
        live.gridHoldStartedAtMs = null;
      }
    } else {
      live.gridHoldStartedAtMs = null;
    }
    return;
  }

  // Hors chauffe : on surveille le surplus.
  live.gridHoldStartedAtMs = null;
  if (surplus >= ctrl.jacuzziStartSurplusW) {
    if (live.surplusHoldStartedAtMs === null) {
      live.surplusHoldStartedAtMs = now;
      log.info("jacuzzi: surplus detecte, fenetre allumage armee", {
        surplus, threshold: ctrl.jacuzziStartSurplusW, holdS: ctrl.jacuzziStartHoldS,
      });
    } else if (now - live.surplusHoldStartedAtMs >= ctrl.jacuzziStartHoldS * 1000) {
      log.info("jacuzzi: surplus maintenu, allumage chauffe", {
        surplus, durationMs: now - live.surplusHoldStartedAtMs,
      });
      await applyHeater(true);
      live.surplusHoldStartedAtMs = null;
    }
  } else {
    live.surplusHoldStartedAtMs = null;
  }
}

export function startJacuzziLoop(intervalSeconds: number): NodeJS.Timeout {
  return setInterval(
    () =>
      tickJacuzzi().catch((e) =>
        log.error("jacuzzi tick error", { error: (e as Error).message }),
      ),
    intervalSeconds * 1000,
  );
}
