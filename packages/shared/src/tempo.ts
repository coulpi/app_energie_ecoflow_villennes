// Client EDF Tempo via l'API publique communautaire api-couleur-tempo.fr.
// Sans authentification, fiable depuis 2022. Couleurs : BLUE / WHITE / RED.
//
// Endpoints :
//   GET https://www.api-couleur-tempo.fr/api/jourTempo/today
//   GET https://www.api-couleur-tempo.fr/api/jourTempo/tomorrow
// Réponse : { codeJour: 0|1|2|3, dateJour: "YYYY-MM-DD" }
//   0 = inconnu (pas encore publié)
//   1 = bleu, 2 = blanc, 3 = rouge

export type TempoColor = "BLUE" | "WHITE" | "RED" | "UNKNOWN";

const BASE = "https://www.api-couleur-tempo.fr/api/jourTempo";

function decode(code: number | undefined | null): TempoColor {
  switch (code) {
    case 1:
      return "BLUE";
    case 2:
      return "WHITE";
    case 3:
      return "RED";
    default:
      return "UNKNOWN";
  }
}

export async function fetchTempoColors(
  fetchImpl: typeof fetch = fetch,
): Promise<{ today: TempoColor; tomorrow: TempoColor }> {
  const [today, tomorrow] = await Promise.all([
    fetchImpl(`${BASE}/today`, { signal: AbortSignal.timeout(10_000) }).then(
      (r) => (r.ok ? (r.json() as Promise<{ codeJour: number }>) : null),
    ),
    fetchImpl(`${BASE}/tomorrow`, { signal: AbortSignal.timeout(10_000) }).then(
      (r) => (r.ok ? (r.json() as Promise<{ codeJour: number }>) : null),
    ),
  ]);
  return {
    today: decode(today?.codeJour),
    tomorrow: decode(tomorrow?.codeJour),
  };
}

export interface TempoDayColor {
  date: string; // YYYY-MM-DD
  color: Exclude<TempoColor, "UNKNOWN">;
}

/**
 * Saison Tempo contenant `d` (1er septembre → 31 août), au format de
 * l'API : "2026-2027".
 */
export function tempoSeasonOf(d: Date): string {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 8 ? y : y - 1;
  return `${start}-${start + 1}`;
}

/**
 * Historique des couleurs d'une saison Tempo (jours publiés uniquement).
 * GET /api/joursTempo?periode=2026-2027 → [{ dateJour, codeJour }, …]
 */
export async function fetchTempoSeason(
  season: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TempoDayColor[]> {
  const r = await fetchImpl(
    `https://www.api-couleur-tempo.fr/api/joursTempo?periode=${encodeURIComponent(season)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!r.ok) throw new Error(`api-couleur-tempo HTTP ${r.status}`);
  const rows = (await r.json()) as Array<{ dateJour: string; codeJour: number }>;
  const out: TempoDayColor[] = [];
  for (const row of rows) {
    const color = decode(row.codeJour);
    if (color !== "UNKNOWN" && /^\d{4}-\d{2}-\d{2}$/.test(row.dateJour)) {
      out.push({ date: row.dateJour, color });
    }
  }
  return out;
}
