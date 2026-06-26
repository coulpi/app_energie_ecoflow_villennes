// Mode FOLLOW_LOAD : auto-conso bidirectionnelle.
//
// À chaque tick, le worker lit le bilan énergétique et décide :
//   - Surplus suffisant + SoC < maxChargeSoc → prise AC ON, setChargeWatts
//     calé sur (surplus − chargeOffsetW), borné [chargeMinW, chargeMaxW].
//   - Déficit + SoC > minDischargeSoc → prise AC OFF, setDischargeWatts
//     calé sur (consommation − followLoadOffsetW), borné [followLoadMinW,
//     followLoadMaxW].
//   - Sinon → prise AC OFF, charge et décharge à 0.
//
// Hystérésis sur le surplus pour éviter de claquer la prise Tuya en boucle.
// Idempotence : on ne ré-applique pas une commande si la valeur n'a pas
// significativement bougé (dead-band 25 W).

import { prisma } from "../db.js";
import { log } from "../log.js";
import { buildSnapshot } from "./engine.js";
import { applyAction } from "./actions.js";

const POWER_DEAD_BAND_W = 25;
const SURPLUS_HYST_W = 50;
// Rampe : variation max de la puissance de charge entre 2 ticks. À 30 s
// de polling, 100 W/tick ≈ +200 W/min, monte de 0 à 800 W en ~4 min.
const CHARGE_RAMP_W_PER_TICK = 100;
// Détection "batterie pleine" : si la prise est ON depuis plus de
// FULL_BATTERY_GRACE_MS et que le tirage AC reste sous FULL_BATTERY_PLUG_THRESHOLD_W,
// on conclut que le BMS refuse la charge (batterie pleine en réalité,
// même si le SoC affiché est obsolète) et on bascule en mode décharge
// via PowerStream pour valoriser le surplus au lieu de l'exporter.
const FULL_BATTERY_GRACE_MS = 2 * 60_000;
const FULL_BATTERY_PLUG_THRESHOLD_W = 30;
let deficitStartedAtMs: number | null = null;
let lastOffAtMs: number | null = null;
let switchOnAtMs: number | null = null;
// Forçage de charge : true une fois qu'on a relevé le plafond BMS
// (maxChgSoc) pour pouvoir atteindre la cible. On le restaure à la fin.
let forceMaxSocPushed = false;
// Mode "durée prioritaire" : true une fois le plafond SoC (cible) atteint
// ou la batterie pleine détectée. On reste alors armé jusqu'à l'échéance,
// prise OFF, sans réessayer de charger (évite le cyclage du relais Tuya).
let forceChargeCeilingHit = false;
// Suit l'état précédent de la fenêtre tempo : on n'intervient sur la
// priorité PowerStream que sur transition (in→out ou out→in).
let lastInTempoWindow: boolean | null = null;

export function getFollowLoadState(): {
  switchOn: boolean | null;
  chargeW: number | null;
  dischargeW: number | null;
  deficitStartedAtMs: number | null;
  lastOffAtMs: number | null;
} {
  return {
    switchOn: last.switchOn,
    chargeW: last.chargeW,
    dischargeW: last.dischargeW,
    deficitStartedAtMs,
    lastOffAtMs,
  };
}

interface AppliedState {
  switchOn: boolean | null;
  chargeW: number | null;
  dischargeW: number | null;
  acOutputOn: boolean | null;
  /** PowerStream supply priority : 0 = alim maison, 1 = stockage. */
  powerstreamPriority: 0 | 1 | null;
}
const last: AppliedState = {
  switchOn: null,
  chargeW: null,
  dischargeW: null,
  acOutputOn: null,
  powerstreamPriority: null,
};

async function setPowerstreamPriority(
  sn: string,
  priority: 0 | 1,
): Promise<void> {
  if (last.powerstreamPriority === priority) return;
  const { publishPowerStreamCommand } = await import("../pollers/ecoflow.js");
  await publishPowerStreamCommand(sn, { kind: "supplyPriority", priority });
  await prisma.controlState.update({
    where: { key: "default" },
    data: { powerstreamPriority: priority } as never,
  });
  last.powerstreamPriority = priority;
  log.info("follow-load: powerstream priority", {
    priority,
    label: priority === 0 ? "alimentation" : "stockage",
  });
}

async function setAcOutput(on: boolean): Promise<void> {
  if (last.acOutputOn === on) return;
  await applyAction(
    { action: "ecoflow.setOutputMode", params: { acOn: on } },
    { snapshot: await buildSnapshot() },
  );
  last.acOutputOn = on;
  log.info("follow-load: sortie AC batterie", { on });
}

async function setSwitch(on: boolean): Promise<void> {
  if (last.switchOn === on) return;
  await applyAction(
    { action: on ? "tuya.switch.on" : "tuya.switch.off", params: {} },
    { snapshot: await buildSnapshot() },
  );
  if (on) switchOnAtMs = Date.now();
  else {
    lastOffAtMs = Date.now();
    switchOnAtMs = null;
  }
  last.switchOn = on;
  log.info("follow-load: prise AC", { switchOn: on });
}

async function setCharge(watts: number): Promise<void> {
  const w = Math.max(0, Math.round(watts));
  if (last.chargeW !== null && Math.abs(w - last.chargeW) < POWER_DEAD_BAND_W) return;
  await applyAction(
    { action: "ecoflow.setChargeWatts", params: { watts: w } },
    { snapshot: await buildSnapshot() },
  );
  last.chargeW = w;
  log.info("follow-load: charge", { watts: w });
}

async function setDischarge(watts: number): Promise<void> {
  const w = Math.max(0, Math.round(watts));
  if (last.dischargeW !== null && Math.abs(w - last.dischargeW) < POWER_DEAD_BAND_W) return;
  await applyAction(
    { action: "ecoflow.setDischargeWatts", params: { watts: w } },
    { snapshot: await buildSnapshot() },
  );
  last.dischargeW = w;
  log.info("follow-load: décharge", { watts: w });
}

/**
 * Forçage manuel de charge (prioritaire sur tous les modes).
 *
 * Tant que `forceChargeSoc` est défini, on charge la batterie à
 * `forceChargeWatts` (prise AC ON), en tirant sur le réseau si le surplus
 * solaire ne suffit pas, jusqu'à atteindre la cible. On relève au passage
 * le plafond BMS (maxChgSoc) pour que la batterie ne coupe pas avant la
 * cible, puis on le restaure à la fin. Le forçage se termine quand le SoC
 * atteint la cible OU quand on détecte que la batterie est réellement
 * pleine (prise ON > 2 min et tirage AC < 30 W).
 */
async function endForceCharge(maxChargeSoc: number): Promise<void> {
  await setCharge(0);
  await setSwitch(false);
  await setDischarge(0);
  if (forceMaxSocPushed) {
    try {
      await applyAction(
        { action: "ecoflow.setMaxChargeSoc", params: { soc: maxChargeSoc } },
        { snapshot: await buildSnapshot() },
      );
      log.info("force-charge: plafond BMS restauré", { maxChargeSoc });
    } catch (e) {
      log.warn("force-charge: restauration maxChgSoc échouée", {
        error: (e as Error).message,
      });
    }
    forceMaxSocPushed = false;
  }
  forceChargeCeilingHit = false;
  await prisma.controlState.update({
    where: { key: "default" },
    data: {
      forceChargeSoc: null,
      forceChargeStartAt: null,
      forceChargeEndAt: null,
    } as never,
  });
}

/** Maintien "plafond atteint" : prise OFF, on reste armé jusqu'à l'échéance. */
async function holdAtCeiling(): Promise<void> {
  forceChargeCeilingHit = true;
  await setCharge(0);
  await setSwitch(false);
  await setDischarge(0);
}

/**
 * @param durationMode true si une échéance (forceChargeEndAt) est définie.
 *   Dans ce cas la **durée est prioritaire** : on charge jusqu'à l'échéance
 *   et la cible SoC n'est qu'un **plafond de sécurité** (on s'arrête de
 *   charger en l'atteignant mais on reste armé). Sans durée, la cible est
 *   l'objectif : on termine le forçage en l'atteignant.
 */
async function tickForceCharge(
  ctrl: {
    forceChargeSoc?: number | null;
    forceChargeWatts?: number | null;
    maxChargeSoc: number;
  },
  durationMode: boolean,
): Promise<void> {
  const target = ctrl.forceChargeSoc as number;
  const watts = ctrl.forceChargeWatts ?? 1000;
  const m = await buildSnapshot();
  const soc = m.battery_soc;

  // Resync prise (cf. tickFollowLoad) : si quelqu'un a coupé la prise.
  if (m.switch_state !== null && m.switch_state !== last.switchOn) {
    last.switchOn = m.switch_state;
  }

  // Plafond SoC atteint.
  if (soc !== null && soc >= target) {
    if (durationMode) {
      // Durée prioritaire : on maintient (prise OFF) jusqu'à l'échéance.
      if (!forceChargeCeilingHit) {
        log.info("force-charge: plafond SoC atteint, maintien jusqu'à l'échéance", {
          soc,
          target,
        });
      }
      await holdAtCeiling();
      return;
    }
    log.info("force-charge: cible SoC atteinte, arrêt", { soc, target });
    await endForceCharge(ctrl.maxChargeSoc);
    return;
  }

  // En mode durée, une fois le plafond touché on n'essaie pas de regagner
  // les quelques % perdus (auto-décharge) : on reste en maintien pour ne
  // pas faire cycler le relais Tuya.
  if (durationMode && forceChargeCeilingHit) {
    await holdAtCeiling();
    return;
  }

  // Relève le plafond BMS si la cible est au-dessus de maxChargeSoc,
  // sinon le BMS couperait la charge avant d'atteindre la cible.
  if (!forceMaxSocPushed) {
    const wantMax = Math.max(target, ctrl.maxChargeSoc);
    try {
      await applyAction(
        { action: "ecoflow.setMaxChargeSoc", params: { soc: wantMax } },
        { snapshot: m },
      );
      log.info("force-charge: démarrage", { target, watts, bmsMaxSoc: wantMax });
    } catch (e) {
      log.warn("force-charge: setMaxChargeSoc échoué", {
        error: (e as Error).message,
      });
    }
    forceMaxSocPushed = true;
  }

  // Détection batterie pleine : prise ON > 2 min, tirage AC < 30 W alors
  // qu'on commande une charge → le BMS refuse, la batterie est réellement
  // pleine (cible inatteignable). On arrête le forçage.
  if (
    last.switchOn === true &&
    switchOnAtMs !== null &&
    Date.now() - switchOnAtMs > FULL_BATTERY_GRACE_MS &&
    last.chargeW !== null &&
    last.chargeW > 0
  ) {
    const battery = await prisma.device.findFirst({
      where: { enabled: true, role: "BATTERY_AC_SWITCH" as never },
    });
    if (battery) {
      const plug = await prisma.reading.findFirst({
        where: {
          deviceId: battery.id,
          ts: { gte: new Date(Date.now() - 90_000) },
        },
        orderBy: { ts: "desc" },
        select: { powerW: true },
      });
      if (
        plug &&
        plug.powerW !== null &&
        plug.powerW < FULL_BATTERY_PLUG_THRESHOLD_W
      ) {
        if (durationMode) {
          log.info("force-charge: batterie pleine, maintien jusqu'à l'échéance", {
            plugW: plug.powerW,
            soc,
          });
          await holdAtCeiling();
          return;
        }
        log.info("force-charge: batterie pleine détectée, arrêt forçage", {
          plugW: plug.powerW,
          soc,
        });
        await endForceCharge(ctrl.maxChargeSoc);
        return;
      }
    }
  }

  // Charge forcée : prise ON, charge à puissance fixe (réseau si besoin).
  await setDischarge(0);
  await setSwitch(true);
  await setCharge(watts);
}

export async function tickFollowLoad(): Promise<void> {
  const ctrl = (await prisma.controlState.findUnique({
    where: { key: "default" },
  })) as
    | {
        mode: string;
        followLoadOffsetW: number;
        followLoadMinW: number;
        followLoadMaxW: number;
        chargeMinW?: number | null;
        chargeMaxW?: number | null;
        chargeOffsetW?: number | null;
        chargeDeficitTimeoutMin?: number | null;
        chargeOffToOnLockMin?: number | null;
        tempoEnabled?: boolean | null;
        tempoColor?: string | null;
        tempoRedDischargeHour?: number | null;
        tempoOtherDischargeHour?: number | null;
        tempoDischargeEndHour?: number | null;
        tempoWakeupBeforeMin?: number | null;
        powerstreamSn?: string | null;
        minDischargeSoc: number;
        maxChargeSoc: number;
        forceChargeSoc?: number | null;
        forceChargeWatts?: number | null;
        forceChargeStartAt?: Date | null;
        forceChargeEndAt?: Date | null;
      }
    | null;
  if (!ctrl) return;

  // === Forçage manuel de charge : prioritaire sur tous les modes ===
  if (ctrl.forceChargeSoc != null) {
    const now = Date.now();
    const startAt = ctrl.forceChargeStartAt
      ? new Date(ctrl.forceChargeStartAt).getTime()
      : null;
    const endAt = ctrl.forceChargeEndAt
      ? new Date(ctrl.forceChargeEndAt).getTime()
      : null;

    // Échéance dépassée → arrêt automatique (timer écoulé).
    if (endAt !== null && now >= endAt) {
      log.info("force-charge: durée écoulée, arrêt automatique", {
        soc: (await buildSnapshot()).battery_soc,
      });
      await endForceCharge(ctrl.maxChargeSoc);
      return;
    }

    // Démarrage programmé pas encore atteint → on n'intervient pas, le mode
    // normal continue jusqu'à l'heure de début. Sinon on prend la main.
    const pending = startAt !== null && now < startAt;
    if (!pending) {
      await tickForceCharge(ctrl, endAt !== null);
      return;
    }
    // (armé mais en attente : on retombe dans le flux normal ci-dessous ;
    // le bloc de restauration gère un éventuel plafond BMS resté relevé.)
  }
  // Forçage inactif/en attente alors que le plafond BMS avait été relevé
  // (ex. annulation depuis l'UI) : on restaure le plafond avant de reprendre
  // le cours normal.
  if (forceMaxSocPushed) {
    try {
      await applyAction(
        { action: "ecoflow.setMaxChargeSoc", params: { soc: ctrl.maxChargeSoc } },
        { snapshot: await buildSnapshot() },
      );
      log.info("force-charge: annulé, plafond BMS restauré", {
        maxChargeSoc: ctrl.maxChargeSoc,
      });
    } catch (e) {
      log.warn("force-charge: restauration maxChgSoc échouée", {
        error: (e as Error).message,
      });
    }
    forceMaxSocPushed = false;
  }

  if (ctrl.mode !== "FOLLOW_LOAD") return;

  const m = await buildSnapshot();
  if (m.consumption_W === null || m.surplus_W === null) return;

  // Resync : si l'état Tuya réel ne correspond pas à ce qu'on pense avoir
  // appliqué (quelqu'un — agent, manuel, autre rule — a coupé la prise),
  // on remet last.switchOn au réel pour que la décision suivante envoie
  // bien la commande nécessaire.
  if (m.switch_state !== null && m.switch_state !== last.switchOn) {
    log.info("follow-load: resync prise (état Tuya différent du dernier état appliqué)", {
      lastApplied: last.switchOn,
      actualTuya: m.switch_state,
    });
    last.switchOn = m.switch_state;
  }

  const chargeMinW = ctrl.chargeMinW ?? 400;
  const chargeMaxW = ctrl.chargeMaxW ?? 800;
  const chargeOffsetW = ctrl.chargeOffsetW ?? 100;
  const deficitTimeoutMs = (ctrl.chargeDeficitTimeoutMin ?? 10) * 60_000;
  const offToOnLockMs = (ctrl.chargeOffToOnLockMin ?? 5) * 60_000;
  const soc = m.battery_soc;

  // === Garde-fou SoC bas : on coupe la décharge PowerStream ===
  // Si la batterie tombe au plancher minDischargeSoc, on force le PS
  // en mode stockage (priority=1) pour empêcher toute décharge
  // supplémentaire, même si la fenêtre tempo est active ou si
  // l'utilisateur a manuellement choisi 'alimentation'. Cette garde
  // est prioritaire sur tout le reste.
  if (
    ctrl.powerstreamSn &&
    soc !== null &&
    soc <= ctrl.minDischargeSoc &&
    last.powerstreamPriority !== 1
  ) {
    try {
      await setPowerstreamPriority(ctrl.powerstreamSn, 1);
      log.info("follow-load: SoC plancher atteint, PS forcé en stockage", {
        soc,
        minDischargeSoc: ctrl.minDischargeSoc,
      });
    } catch (e) {
      log.warn("follow-load: PS forced storage failed", {
        error: (e as Error).message,
      });
    }
  }

  // === Décharge programmée (EDF Tempo) + pilotage PowerStream ===
  // On respecte le choix manuel de la priorité PowerStream sauf sur
  // les transitions d'entrée/sortie de fenêtre tempo : à ces transitions
  // on bascule automatiquement en alimentation (entrée) ou en stockage
  // (sortie). Entre les transitions, l'utilisateur garde le contrôle.
  let inWindow = false;
  if (ctrl.tempoEnabled) {
    const hour = new Date().getHours();
    const startHour =
      ctrl.tempoColor === "RED"
        ? (ctrl.tempoRedDischargeHour ?? 17)
        : (ctrl.tempoOtherDischargeHour ?? 22);
    const endHour = ctrl.tempoDischargeEndHour ?? 6;
    // Fenêtre [startHour, endHour). Si endHour <= startHour (ex. 22h → 6h),
    // la fenêtre traverse minuit.
    inWindow =
      endHour > startHour
        ? hour >= startHour && hour < endHour
        : hour >= startHour || hour < endHour;

    // Transitions de fenêtre : on push la priorité PS uniquement quand
    // l'état change, pour ne pas écraser un choix manuel utilisateur.
    if (ctrl.powerstreamSn && inWindow !== lastInTempoWindow) {
      const wantPriority: 0 | 1 = inWindow ? 0 : 1;
      try {
        await setPowerstreamPriority(ctrl.powerstreamSn, wantPriority);
        log.info("follow-load: tempo transition, PS priority pushed", {
          inWindow,
          priority: wantPriority,
        });
      } catch (e) {
        log.warn("follow-load: powerstream priority failed", {
          error: (e as Error).message,
        });
      }
    }
    lastInTempoWindow = inWindow;

    // Pendant la fenêtre tempo, on coupe la prise Tuya pour ne pas
    // charger sur surplus pendant qu'on est censé décharger.
    // Exception : pré-réveil avant la fin de fenêtre. La Delta Max
    // entre en veille profonde après plusieurs heures sans charge AC ;
    // on rallume la prise X minutes avant endHour pour qu'elle soit
    // prête à charger dès que le surplus solaire arrive.
    if (inWindow && (soc === null || soc > ctrl.minDischargeSoc)) {
      const now = new Date();
      const minutesNow = now.getHours() * 60 + now.getMinutes();
      const endMinutes = endHour * 60;
      const wakeupBefore = (ctrl.tempoWakeupBeforeMin ?? 15);
      // Distance jusqu'à la fin (positive si on s'en approche dans la même
      // journée, gestion fenêtre traversant minuit en convertissant tout en
      // minutes since startHour modulo 24h).
      const distanceToEnd = (() => {
        if (endHour > startHour) return endMinutes - minutesNow;
        // Fenêtre traverse minuit : on est soit après startHour soit avant endHour.
        if (minutesNow >= startHour * 60) {
          return 24 * 60 - minutesNow + endMinutes;
        }
        return endMinutes - minutesNow;
      })();
      const inWakeupWindow = distanceToEnd >= 0 && distanceToEnd <= wakeupBefore;

      const batteryAlreadyFull = soc !== null && soc >= ctrl.maxChargeSoc;
      if (inWakeupWindow && !batteryAlreadyFull) {
        log.info("follow-load: tempo wakeup window — réveil batterie", {
          minutesUntilEnd: distanceToEnd,
        });
        await setCharge(0);
        await setSwitch(true); // rallume la prise pour réveil
        await setDischarge(0);
      } else {
        log.info("follow-load: décharge programmée Tempo active", {
          tempoColor: ctrl.tempoColor,
          startHour,
          endHour,
        });
        await setCharge(0);
        await setSwitch(false);
        await setDischarge(0);
      }
      return;
    }
  }


  const surplus = m.surplus_W; // > 0 = export, < 0 = import
  const alreadyCharging = last.switchOn === true;
  const now = Date.now();

  // Démarrage de charge : surplus suffisant pour tenir au-dessus de
  // chargeMinW + marge de sécurité. On ne lance que dans des conditions
  // confortables.
  const switchOnTriggerW = chargeMinW + SURPLUS_HYST_W; // ex. 450 W

  // Fois en charge : on tolère que le surplus descende sous chargeMinW
  // (la batterie chargera au minimum hardware en tirant un peu sur le
  // réseau). On ne coupe que si cet état dure plus de
  // CHARGE_DEFICIT_TIMEOUT_MS — un consommateur temporaire (four, plaque,
  // etc.) qui démarre puis s'arrête ne fait pas claquer la prise.
  // Verrou OFF → ON : refuse de rallumer pendant offToOnLockMs après un OFF.
  const offLockActive =
    lastOffAtMs !== null && now - lastOffAtMs < offToOnLockMs;
  const canStartCharge =
    !offLockActive &&
    surplus >= switchOnTriggerW &&
    (soc === null || soc < ctrl.maxChargeSoc);
  const canKeepCharge =
    alreadyCharging && (soc === null || soc < ctrl.maxChargeSoc);

  // (2) DÉFICIT + capacité de fournir → DÉCHARGE
  const canDischarge =
    !alreadyCharging &&
    surplus < 0 &&
    Math.abs(surplus) > 30 &&
    (soc === null || soc > ctrl.minDischargeSoc);

  if (canStartCharge || canKeepCharge) {
    // Détection batterie pleine : si la prise est ON depuis >2 min et tire
    // <30 W alors qu'on commande une charge non nulle, le BMS refuse — la
    // batterie est en réalité pleine (le SoC affiché peut être obsolète,
    // cf. broadcasts BMS sporadiques). On coupe la prise, on verrouille
    // un offLock pour ne pas réessayer immédiatement, et on bascule le
    // PowerStream en alimentation pour valoriser le surplus.
    if (
      alreadyCharging &&
      switchOnAtMs !== null &&
      now - switchOnAtMs > FULL_BATTERY_GRACE_MS &&
      last.chargeW !== null &&
      last.chargeW > 0
    ) {
      const battery = await prisma.device.findFirst({
        where: { enabled: true, role: "BATTERY_AC_SWITCH" as never },
      });
      if (battery) {
        const plug = await prisma.reading.findFirst({
          where: {
            deviceId: battery.id,
            ts: { gte: new Date(now - 90_000) },
          },
          orderBy: { ts: "desc" },
          select: { powerW: true },
        });
        if (
          plug &&
          plug.powerW !== null &&
          plug.powerW < FULL_BATTERY_PLUG_THRESHOLD_W
        ) {
          log.info(
            "follow-load: batterie pleine detectee (prise ON >2min, tirage <30W)",
            { plugW: plug.powerW, soc, switchOnSinceMs: now - switchOnAtMs },
          );
          await setCharge(0);
          await setSwitch(false);
          await setDischarge(0);
          if (ctrl.powerstreamSn) {
            try {
              await setPowerstreamPriority(ctrl.powerstreamSn, 0);
              log.info("follow-load: PS bascule en alimentation pour valoriser surplus");
            } catch (e) {
              log.warn("follow-load: PS priority alimentation failed", {
                error: (e as Error).message,
              });
            }
          }
          return;
        }
      }
    }

    // Suivi du déficit : tant que surplus < chargeMinW pendant la charge,
    // la batterie consomme du réseau. On laisse 10 min, puis on coupe.
    if (surplus < chargeMinW) {
      if (deficitStartedAtMs === null) {
        deficitStartedAtMs = now;
        log.info("follow-load: déficit charge détecté, tolérance 10 min", {
          surplus_W: surplus,
          chargeMinW,
        });
      } else if (now - deficitStartedAtMs > deficitTimeoutMs) {
        log.info("follow-load: déficit charge > 10 min, coupure prise", {
          surplus_W: surplus,
        });
        await setCharge(0);
        await setSwitch(false);
        await setDischarge(0);
        deficitStartedAtMs = null;
        return;
      }
    } else {
      // Surplus revenu au-dessus du seuil → on remet le timer à zéro.
      deficitStartedAtMs = null;
    }

    const desired = Math.max(
      chargeMinW,
      Math.min(chargeMaxW, surplus - chargeOffsetW),
    );
    // Rampe : on n'autorise qu'une variation de CHARGE_RAMP_W_PER_TICK par
    // tick. Au démarrage (last.chargeW null), on part du chargeMinW.
    const previous = last.chargeW ?? chargeMinW;
    const delta = desired - previous;
    const stepped =
      Math.abs(delta) > CHARGE_RAMP_W_PER_TICK
        ? previous + Math.sign(delta) * CHARGE_RAMP_W_PER_TICK
        : desired;
    const target = Math.max(chargeMinW, Math.min(chargeMaxW, stepped));
    await setDischarge(0);
    await setSwitch(true);
    await setCharge(target);
    return;
  }

  // Sortie de charge (timeout dépassé ou SoC max atteint) : reset timer.
  deficitStartedAtMs = null;

  if (canDischarge) {
    const target = Math.max(
      ctrl.followLoadMinW,
      Math.min(ctrl.followLoadMaxW, m.consumption_W - ctrl.followLoadOffsetW),
    );
    await setCharge(0);
    await setSwitch(false);
    await setDischarge(target);
    return;
  }

  // (3) Idle / SoC limite / hors fenêtre charge et décharge : tout à zéro,
  // prise OFF.
  await setCharge(0);
  await setSwitch(false);
  await setDischarge(0);
}

export function startFollowLoadLoop(intervalSeconds: number): NodeJS.Timeout {
  return setInterval(
    () =>
      tickFollowLoad().catch((e) =>
        log.error("follow-load error", { error: (e as Error).message }),
      ),
    intervalSeconds * 1000,
  );
}
