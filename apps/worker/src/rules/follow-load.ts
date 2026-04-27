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

interface AppliedState {
  switchOn: boolean | null;
  chargeW: number | null;
  dischargeW: number | null;
}
const last: AppliedState = {
  switchOn: null,
  chargeW: null,
  dischargeW: null,
};

async function setSwitch(on: boolean): Promise<void> {
  if (last.switchOn === on) return;
  await applyAction(
    { action: on ? "tuya.switch.on" : "tuya.switch.off", params: {} },
    { snapshot: await buildSnapshot() },
  );
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
        minDischargeSoc: number;
        maxChargeSoc: number;
      }
    | null;
  if (!ctrl || ctrl.mode !== "FOLLOW_LOAD") return;

  const m = await buildSnapshot();
  if (m.consumption_W === null || m.surplus_W === null) return;

  const chargeMinW = ctrl.chargeMinW ?? 400;
  const chargeMaxW = ctrl.chargeMaxW ?? 800;
  const chargeOffsetW = ctrl.chargeOffsetW ?? 100;
  const soc = m.battery_soc;

  const surplus = m.surplus_W; // > 0 = export, < 0 = import
  const switchOnTriggerW = chargeMinW + SURPLUS_HYST_W;
  const switchOffTriggerW = chargeMinW - SURPLUS_HYST_W;

  // (1) SURPLUS suffisant + capacité d'absorber → CHARGE
  const canCharge =
    surplus >= switchOnTriggerW &&
    (soc === null || soc < ctrl.maxChargeSoc);

  // (2) DÉFICIT + capacité de fournir → DÉCHARGE
  const canDischarge =
    surplus < 0 &&
    Math.abs(surplus) > 30 &&
    (soc === null || soc > ctrl.minDischargeSoc);

  if (canCharge) {
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

  // (3) Idle ou SoC limite : tout à zéro, prise OFF.
  // Surplus dans la zone basse (< chargeMinW − hyst) ou SoC bloquant.
  if (surplus < switchOffTriggerW) {
    await setCharge(0);
    await setSwitch(false);
  }
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
