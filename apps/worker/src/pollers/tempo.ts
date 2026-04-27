// Récupère la couleur EDF Tempo du jour et du lendemain depuis l'API
// publique api-couleur-tempo.fr et persiste en BD (ControlState).
// Polling 1x/h ; la couleur du lendemain est typiquement publiée vers 11h.

import { tempo as tempoNs } from "@app/shared";
import { prisma } from "../db.js";
import { log } from "../log.js";

const { fetchTempoColors } = tempoNs;

export async function pollTempoOnce(): Promise<void> {
  try {
    const { today, tomorrow } = await fetchTempoColors();
    if (today === "UNKNOWN" && tomorrow === "UNKNOWN") {
      log.warn("tempo: aucune couleur récupérée");
      return;
    }
    await prisma.controlState.upsert({
      where: { key: "default" },
      create: {
        key: "default",
        tempoColor: today,
        tempoColorTomorrow: tomorrow,
        tempoLastFetchAt: new Date(),
      } as never,
      update: {
        tempoColor: today,
        tempoColorTomorrow: tomorrow,
        tempoLastFetchAt: new Date(),
      } as never,
    });
    log.info("tempo: couleurs mises à jour", { today, tomorrow });
  } catch (e) {
    log.warn("tempo: échec récupération", { error: (e as Error).message });
  }
}

export function startTempoPoller(): NodeJS.Timeout {
  void pollTempoOnce();
  // 1x/h, suffit largement.
  return setInterval(() => void pollTempoOnce(), 60 * 60_000);
}
