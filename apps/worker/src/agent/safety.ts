// Garde-fous appliqués indépendamment de l'agent LLM. S'exécute à chaque
// cycle de polling. Priorité sur toute autre logique.

import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";
import { applyAction } from "../rules/actions.js";
import { buildSnapshot } from "../rules/engine.js";

let lastForcedOn = 0;

/**
 * Si la batterie EcoFlow est en SoC critique (≤ BATTERY_CRITICAL_SOC) ou
 * que son SoC est inconnu depuis longtemps, on force la prise AC ON pour
 * permettre à la batterie de se réveiller / recharger.
 */
export async function safetyTick(): Promise<void> {
  const snap = await buildSnapshot();
  const battery = await prisma.device.findFirst({
    where: { enabled: true, role: "BATTERY" },
  });
  if (!battery) return;

  const soc = snap.battery_soc;
  const critical = soc !== null && soc <= env.BATTERY_CRITICAL_SOC;
  if (!critical) return;

  // Anti-spam : on n'envoie la commande qu'au plus une fois toutes les 5 min.
  if (Date.now() - lastForcedOn < 5 * 60_000) return;

  if (snap.switch_state === true) return; // déjà allumée

  log.warn("safety: forcing battery AC plug ON (critical SoC)", { soc });
  try {
    await applyAction(
      { action: "tuya.switch.on" },
      { snapshot: snap as never },
    );
    lastForcedOn = Date.now();
  } catch (e) {
    log.error("safety: failed to force plug ON", {
      error: (e as Error).message,
    });
  }
}

export function startSafetyLoop(intervalSeconds: number): NodeJS.Timeout {
  return setInterval(
    () =>
      safetyTick().catch((e) =>
        log.error("safety tick error", { error: (e as Error).message }),
      ),
    intervalSeconds * 1000,
  );
}
