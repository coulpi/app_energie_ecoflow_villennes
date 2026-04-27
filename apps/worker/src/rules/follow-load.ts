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
let deficitStartedAtMs: number | null = null;
let lastOffAtMs: number | null = null;
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
  if (!on) lastOffAtMs = Date.now();
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
      }
    | null;
  if (!ctrl || ctrl.mode !== "FOLLOW_LOAD") return;

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

      if (inWakeupWindow) {
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
