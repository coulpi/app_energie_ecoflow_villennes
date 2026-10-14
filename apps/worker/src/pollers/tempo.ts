// Récupère la couleur EDF Tempo du jour et du lendemain depuis l'API
// publique api-couleur-tempo.fr et persiste en BD (ControlState).
// Polling 1x/h ; la couleur du lendemain est typiquement publiée vers 11h.

import { tempo as tempoNs } from "@app/shared";
import { prisma } from "../db.js";
import { log } from "../log.js";

const { fetchTempoColors, fetchTempoSeason, tempoSeasonOf } = tempoNs;

/**
 * Historise les couleurs Tempo (table TempoDay) pour le calcul des coûts.
 * Saison courante à chaque appel ; `withPrevious` ajoute la saison
 * précédente (rattrapage au démarrage). N'écrit que les jours nouveaux ou
 * dont la couleur a changé.
 */
export async function syncTempoHistory(withPrevious = false): Promise<void> {
  const now = new Date();
  const seasons = [tempoSeasonOf(now)];
  if (withPrevious) {
    seasons.unshift(tempoSeasonOf(new Date(now.getTime() - 365 * 86_400_000)));
  }
  for (const season of seasons) {
    try {
      const days = await fetchTempoSeason(season);
      if (days.length === 0) continue;
      const existing = await prisma.tempoDay.findMany({
        where: { date: { in: days.map((d) => d.date) } },
      });
      const known = new Map(existing.map((e) => [e.date, e.color]));
      const changed = days.filter((d) => known.get(d.date) !== d.color);
      for (const d of changed) {
        await prisma.tempoDay.upsert({
          where: { date: d.date },
          create: { date: d.date, color: d.color },
          update: { color: d.color },
        });
      }
      if (changed.length > 0) {
        log.info("tempo: historique synchronisé", { season, written: changed.length });
      }
    } catch (e) {
      log.warn("tempo: échec historique", { season, error: (e as Error).message });
    }
  }
}

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
  void syncTempoHistory(true);
  // 1x/h, suffit largement.
  return setInterval(() => {
    void pollTempoOnce();
    void syncTempoHistory();
  }, 60 * 60_000);
}
