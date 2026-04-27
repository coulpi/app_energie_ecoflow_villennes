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
