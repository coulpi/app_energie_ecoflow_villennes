// Boucle d'asservissement : pousse à la batterie EcoFlow la puissance de
// charge AC max (chargeMaxW) configurée dans ControlState, dès qu'elle
// change. Idempotent : ne ré-applique pas si la valeur n'a pas bougé.

import { prisma } from "../db.js";
import { log } from "../log.js";
import { applyAction } from "./actions.js";
import { buildSnapshot } from "./engine.js";

let lastApplied: number | null = null;

export async function tickChargeLimit(): Promise<void> {
  const ctrl = (await prisma.controlState.findUnique({
    where: { key: "default" },
  })) as { chargeMaxW?: number | null } | null;
  const target = ctrl?.chargeMaxW;
  if (typeof target !== "number") return;
  if (lastApplied === target) return;

  try {
    const snapshot = await buildSnapshot();
    await applyAction(
      { action: "ecoflow.setChargeWatts", params: { watts: target } },
      { snapshot },
    );
    lastApplied = target;
    log.info("charge-limit: appliqué", { chargeMaxW: target });
  } catch (e) {
    log.warn("charge-limit: échec", { error: (e as Error).message });
  }
}

export function startChargeLimitLoop(intervalSeconds: number): NodeJS.Timeout {
  return setInterval(
    () =>
      tickChargeLimit().catch((e) =>
        log.error("charge-limit error", { error: (e as Error).message }),
      ),
    intervalSeconds * 1000,
  );
}
