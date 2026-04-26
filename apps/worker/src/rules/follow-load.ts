// Boucle d'asservissement : quand mode = FOLLOW_LOAD, ajuste en continu la
// puissance d'injection AC de la batterie pour suivre la consommation maison.

import { prisma } from "../db.js";
import { log } from "../log.js";
import { buildSnapshot } from "./engine.js";
import { applyAction } from "./actions.js";

let lastSetW: number | null = null;
const DEAD_BAND_W = 25;

export async function tickFollowLoad(): Promise<void> {
  const ctrl = await prisma.controlState.findUnique({
    where: { key: "default" },
  });
  if (!ctrl || ctrl.mode !== "FOLLOW_LOAD") return;

  const m = await buildSnapshot();
  if (m.consumption_W === null) return;

  // SoC trop bas : on ne décharge pas.
  if (m.battery_soc !== null && m.battery_soc < ctrl.minDischargeSoc) {
    if (lastSetW !== 0) {
      await applyAction(
        { action: "ecoflow.setDischargeWatts", params: { watts: 0 } },
        { snapshot: m },
      );
      lastSetW = 0;
      log.info("follow-load: SoC bas, sortie AC=0");
    }
    return;
  }

  let target = m.consumption_W - ctrl.followLoadOffsetW;
  target = Math.max(ctrl.followLoadMinW, Math.min(ctrl.followLoadMaxW, target));
  target = Math.round(target);

  if (lastSetW !== null && Math.abs(target - lastSetW) < DEAD_BAND_W) return;

  await applyAction(
    { action: "ecoflow.setDischargeWatts", params: { watts: target } },
    { snapshot: m },
  );
  log.info("follow-load: nouvelle cible AC", {
    consumption_W: m.consumption_W,
    target,
  });
  lastSetW = target;
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
